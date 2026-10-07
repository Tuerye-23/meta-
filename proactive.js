import { localDay } from './social.js';

const number=(value,min,max,fallback)=>value!=='' && value!==null && value!==undefined && Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
export function proactivePreferences(value={}) {
    return {proactiveEnabled:value.proactiveEnabled===true || value.proactiveEnabled==='on',proactiveHours:number(value.proactiveHours,.5,720,3),proactiveDaily:Math.floor(number(value.proactiveDaily,1,100,3))};
}
export function proactiveSchedule(value={}) {
    const counts=Object.fromEntries(Object.entries(value?.counts || {}).filter(([day,count])=>/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isInteger(count) && count>=0).sort(([a],[b])=>a.localeCompare(b)).slice(-32));
    return {nextAt:number(value?.nextAt,0,Number.MAX_SAFE_INTEGER,0),retryAt:number(value?.retryAt,0,Number.MAX_SAFE_INTEGER,0),counts};
}
export const proactiveInterval=profile=>proactivePreferences(profile).proactiveHours*3600000;
export const proactiveCount=(thread,now=Date.now())=>thread?.proactive?.counts?.[localDay(now)] || 0;
export function reserveProactive(profile,thread,now=Date.now(),reset=false) {
    thread.proactive ||= proactiveSchedule();
    if(!profile.proactiveEnabled) {thread.proactive.nextAt=0;thread.proactive.retryAt=0;return;}
    if(reset || !thread.proactive.nextAt){thread.proactive.nextAt=now+proactiveInterval(profile);thread.proactive.retryAt=0;}
}
export function nextProactiveTask(state,now=Date.now()) {
    return state.profiles.filter(p=>p.proactiveEnabled).map(p=>({p,t:state.threads.find(t=>t.profileId===p.id)}))
        .filter(({p,t})=>t?.proactive?.nextAt>0 && now>=t.proactive.nextAt && now>=t.proactive.retryAt && proactiveCount(t,now)<p.proactiveDaily)
        .sort((a,b)=>a.t.proactive.nextAt-b.t.proactive.nextAt)[0]?.p.id || null;
}
export function finishProactive(profile,thread,now=Date.now()) {
    const slot=thread.proactive ||= proactiveSchedule(),day=localDay(now);
    slot.counts[day]=(slot.counts[day] || 0)+1;
    slot.counts=proactiveSchedule(slot).counts;
    slot.nextAt=now+proactiveInterval(profile);slot.retryAt=0;
}

export class ProactiveController {
    constructor(app){this.app=app;this.checking=false;this.timer=setInterval(()=>void this.tick(),15000);this.startTimer=setTimeout(()=>void this.tick(),1000);}
    async tick(now=Date.now()) {
        const app=this.app;
        if(this.checking || app.disposed || app.busy || app.host.busy || globalThis.navigator?.onLine===false)return;
        this.checking=true;
        const state=app.state;
        let slot,dueAt=0;
        try {
            let initialized=false;
            for(const p of state.profiles.filter(p=>p.proactiveEnabled)) {
                const t=state.threads.find(t=>t.profileId===p.id);
                if(t && !t.proactive?.nextAt){reserveProactive(p,t,now);initialized=true;}
            }
            if(initialized)await app.save();
            if(app.disposed || app.state!==state || app.busy || app.host.busy)return;
            const id=nextProactiveTask(state,now);if(!id)return;
            const {p,t}=app.current(id);slot=t.proactive;dueAt=slot.nextAt;
            // Reserve before requesting so a restart never replays every missed interval.
            slot.nextAt=now+proactiveInterval(p);slot.retryAt=0;await app.save();
            if(app.disposed || app.state!==state)return;
            if(!p.proactiveEnabled || app.busy || app.host.busy){slot.nextAt=p.proactiveEnabled?dueAt:0;await app.save();return;}
            await app.reply('proactive','',null,null,false,id,true);
        } catch(error) {
            if(app.disposed || app.state!==state)return;
            if(slot){slot.nextAt=dueAt;slot.retryAt=Date.now()+5*60000;}
            app.log?.('主动消息未完成：'+(error?.message || String(error)),'error');
            try{await app.save();}catch{}
            if(app.ui.open)app.ui.notice('主动消息未完成，稍后重试：'+(error?.message || String(error)),true);
        } finally {this.checking=false;}
    }
    destroy(){clearInterval(this.timer);clearTimeout(this.startTimer);}
}
