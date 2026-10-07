export const NOTIFICATION_TONES = [['chime','清脆双音'],['soft','轻柔水滴'],['bell','小铃铛'],['none','静音']];
export function notificationPreferences(value={}) {
    const volume=Number(value.notificationVolume);
    return {notificationTone:NOTIFICATION_TONES.some(([id])=>id===value.notificationTone)?value.notificationTone:'chime',notificationVolume:Number.isFinite(volume)?Math.min(1,Math.max(0,volume)):0.5};
}
export const hasUnread = thread => Boolean(thread?.unreadIds?.length);
export function markRead(thread) {
    if(!hasUnread(thread))return false;
    thread.unreadIds=[];return true;
}
export function receiveMessages(thread,messages,viewing=false) {
    const ids=messages.filter(m=>m.role==='assistant').map(m=>m.id);
    if(viewing){markRead(thread);return;}
    thread.unreadIds=[...new Set([...(thread.unreadIds || []),...ids])];
}
const notes={chime:[[880,0,.16],[1174.66,.12,.22]],soft:[[659.25,0,.22],[987.77,.15,.28]],bell:[[1046.5,0,.38],[1569.75,0,.26],[2093,0,.16]]};
// Local PCM WAV works through the same media playback path as the host's message sound.
// No asset download is needed; the native WebView can decode these three short tones.
const toneUrls=new Map();
export function notificationWav(tone='chime') {
    if(toneUrls.has(tone))return toneUrls.get(tone);
    const rate=22050,duration=tone==='silent'?.04:.5,length=Math.ceil(rate*duration);
    const bytes=new Uint8Array(44+length*2),view=new DataView(bytes.buffer);
    const label=(at,text)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
    label(0,'RIFF');view.setUint32(4,bytes.length-8,true);label(8,'WAVE');label(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    label(36,'data');view.setUint32(40,length*2,true);
    for(let i=0;i<length;i++) {
        let sample=0;
        for(const [hz,delay,span] of notes[tone] || []) {
            const t=i/rate-delay;if(t<0 || t>span)continue;
            const envelope=Math.min(1,t/.008)*Math.exp(-6*t/span)*Math.min(1,(span-t)/.012);
            sample+=Math.sin(2*Math.PI*hz*t)*envelope*(tone==='bell'?.26:.6);
        }
        view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,sample))*32767),true);
    }
    let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    const url='data:audio/wav;base64,'+btoa(binary);toneUrls.set(tone,url);return url;
}
export class MessageSound {
    constructor(scope=globalThis){this.scope=scope;this.context=null;this.media=null;this.disposed=false;this.voices=new Set();this.mediaPrimed=false;}
    bind() {
        const doc=this.scope.document;if(!doc || this.gesture)return;
        this.gesture=()=>{void this.unlock();};
        for(const event of ['pointerdown','touchend','keydown'])doc.addEventListener(event,this.gesture,{capture:true,passive:true});
    }
    mediaElement() {
        if(this.media || this.disposed)return this.media;
        try {
            if(!this.scope.Audio)return null;
            const media=new this.scope.Audio();media.preload='auto';media.setAttribute?.('playsinline','');
            media.hidden=true;media.dataset && (media.dataset.mcTone='silent');
            this.scope.document?.body?.append(media);this.media=media;return media;
        }catch{return null;}
    }
    unlock() {
        if(this.disposed)return Promise.resolve(false);
        const media=this.mediaElement();let primed=Promise.resolve(this.mediaPrimed);
        if(media && !this.mediaPrimed && !this.priming) {
            try {
                media.src=notificationWav('silent');media.volume=1;
                this.priming=Promise.resolve(media.play()).then(()=>{this.mediaPrimed=true;return true;}).catch(()=>false).finally(()=>{this.priming=null;});
                primed=this.priming;
            }catch{}
        }else if(this.priming)primed=this.priming;
        const context=this.unlockContext();
        return Promise.all([primed,context]).then(results=>results.some(Boolean));
    }
    unlockContext() {
        try {
            const Audio=this.scope.AudioContext || this.scope.webkitAudioContext;
            if(!Audio || this.disposed)return Promise.resolve(false);
            this.context ??=new Audio();const ctx=this.context;
            const ready=ctx.state==='suspended'?Promise.resolve(ctx.resume()).catch(()=>false):Promise.resolve();
            // Starting a real buffer during the gesture also primes older iOS / Android audio engines.
            if(!this.contextPrimed && ctx.createBuffer && ctx.createBufferSource) {
                const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,1,22050);source.connect(ctx.destination);source.onended=()=>source.disconnect();source.start();this.contextPrimed=true;
            }
            return ready.then(()=>ctx.state==='running');
        }catch{return Promise.resolve(false);}
    }
    async play(settings) {
        const {notificationTone:tone,notificationVolume:volume}=notificationPreferences(settings);
        if(tone==='none' || volume===0)return true;
        if(this.disposed)return false;
        const media=this.mediaElement();
        if(media) {
            try {
                media.pause();media.src=notificationWav(tone);media.volume=volume;media.currentTime=0;
                if(media.dataset)media.dataset.mcTone=tone;
                // Invoke play before awaiting anything so a settings preview keeps the user gesture.
                await media.play();this.mediaPrimed=true;return !this.disposed;
            }catch{/* Some hosts disable media elements; use Web Audio in that case. */}
        }
        if(!await this.unlockContext() || this.disposed)return false;
        try {
            const ctx=this.context,start=ctx.currentTime+.01;
            for(const [frequency,delay,duration] of notes[tone]) {
                const osc=ctx.createOscillator(),gain=ctx.createGain();
                osc.type='sine';osc.frequency.value=frequency;
                const at=start+delay;
                gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume*(tone==='bell'?.12:.22),at+.008);
                gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
                osc.connect(gain);gain.connect(ctx.destination);this.voices.add(osc);
                osc.onended=()=>{osc.disconnect();gain.disconnect();this.voices.delete(osc);};
                osc.start(at);osc.stop(at+duration+.02);
            }
            return true;
        }catch{return false;}
    }
    destroy() {
        this.disposed=true;
        if(this.gesture)for(const event of ['pointerdown','touchend','keydown'])this.scope.document?.removeEventListener(event,this.gesture,true);
        for(const osc of this.voices){try{osc.stop();}catch{}}this.voices.clear();
        this.media?.pause();this.media?.remove();this.media=null;
        try{this.context?.close()?.catch(()=>{});}catch{}this.context=null;
    }
}
