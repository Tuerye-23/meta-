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
export class MessageSound {
    constructor(scope=globalThis){this.scope=scope;this.context=null;this.disposed=false;this.voices=new Set();}
    unlock() {
        if(this.disposed)return Promise.resolve(false);
        try {
            const Audio=this.scope.AudioContext || this.scope.webkitAudioContext;
            if(!Audio)return Promise.resolve(false);
            this.context ??=new Audio();
            if(this.context.state==='suspended')return this.context.resume().then(()=>this.context?.state==='running').catch(()=>false);
            return Promise.resolve(this.context.state==='running');
        }catch{return Promise.resolve(false);}
    }
    async play(settings) {
        const {notificationTone:tone,notificationVolume:volume}=notificationPreferences(settings);
        if(tone==='none' || volume===0)return true;
        if(!await this.unlock() || this.disposed)return false;
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
    }
    destroy(){this.disposed=true;for(const osc of this.voices){try{osc.stop();}catch{}}this.voices.clear();this.context?.close().catch(()=>{});this.context=null;}
}
