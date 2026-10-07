import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, normalizeProfile, newThread, buildPrompt, validateBackup, addMessage, removeMessage } from '../core.js';
import { proactivePreferences, proactiveSchedule, proactiveCount, reserveProactive, nextProactiveTask, finishProactive, ProactiveController } from '../proactive.js';
import { ContactsController } from '../contacts-controller.js';
import { localDay } from '../social.js';
import { PROACTIVE_PROMPT } from '../prompts.js';

function fixture(){const state=freshState();state.profiles=['A','B'].map(name=>normalizeProfile({name}));state.threads=state.profiles.map(p=>newThread(p.id));state.selected=state.profiles[1].id;return state;}
test('proactive preferences default off, validate values, and survive inherited persona refresh and backup',()=>{
    assert.deepEqual(proactivePreferences(),{proactiveEnabled:false,proactiveHours:3,proactiveDaily:3});
    assert.deepEqual(proactivePreferences({proactiveEnabled:'false',proactiveHours:'',proactiveDaily:NaN}),proactivePreferences());
    assert.deepEqual(proactivePreferences({proactiveEnabled:'on',proactiveHours:-1,proactiveDaily:2.9}),{proactiveEnabled:true,proactiveHours:.5,proactiveDaily:2});
    const state=fixture(),p=state.profiles[0],t=state.threads[0];Object.assign(p,{proactiveEnabled:true,proactiveHours:2,proactiveDaily:5});
    reserveProactive(p,t,1000);finishProactive(p,t,2000);t.proactive.retryAt=3000;
    assert.equal(normalizeProfile({name:'A',description:'新设定'},p).proactiveEnabled,true);
    assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))).threads[0].proactive,t.proactive);
    delete p.proactiveEnabled;delete t.proactive;const old=validateBackup(state);assert.equal(old.profiles[0].proactiveEnabled,false);assert.equal(old.threads[0].proactive.nextAt,0);
    assert.deepEqual(proactiveSchedule({nextAt:-1,retryAt:'bad',counts:{invalid:20,'2026-10-08':2,'2026-10-09':-3}}),{nextAt:0,retryAt:0,counts:{'2026-10-08':2}});
});
test('wall-clock intervals survive restart, coalesce missed slots, and daily quota counts a group once even after deleting messages',()=>{
    const state=fixture(),p=state.profiles[0],t=state.threads[0],start=new Date(2026,9,8,10).getTime();
    Object.assign(p,{proactiveEnabled:true,proactiveHours:2,proactiveDaily:2});reserveProactive(p,t,start);
    assert.equal(nextProactiveTask(state,start+7200000-1),null);assert.equal(nextProactiveTask(state,start+7200000),p.id);
    const restored=validateBackup(state);assert.equal(nextProactiveTask(restored,start+9*3600000),p.id);
    const rp=restored.profiles[0],rt=restored.threads[0];finishProactive(rp,rt,start+9*3600000);
    assert.equal(nextProactiveTask(restored,start+9*3600000+1),null);assert.equal(rt.proactive.nextAt,start+11*3600000);
    const messages=Array.from({length:5},()=>addMessage(rt,'assistant','短句','proactive'));finishProactive(rp,rt,start+11*3600000);
    assert.equal(proactiveCount(rt,start),2);for(const m of messages)removeMessage(rt,m.id);
    assert.equal(nextProactiveTask(restored,start+13*3600000),null);
    const tomorrow=new Date(2026,9,9,0,1).getTime();assert.equal(nextProactiveTask(restored,tomorrow),p.id);assert.equal(proactiveCount(rt,tomorrow),0);
    finishProactive(rp,rt,tomorrow);assert.equal(rt.proactive.counts[localDay(tomorrow)],1);assert.equal(rt.proactive.counts[localDay(start)],2);
});
test('contact settings toggle resets the interval, preserves daily usage and other contacts, and changing style alone preserves the deadline',async()=>{
    const state=fixture(),p=state.profiles[0],t=state.threads[0];Object.assign(p,{proactiveEnabled:true,proactiveHours:2,proactiveDaily:3});reserveProactive(p,t,Date.now());finishProactive(p,t);
    let values={replyStyle:'short',replyRange:'5-10',proactiveEnabled:'on',proactiveHours:'2',proactiveDaily:'3'};
    const app={state,ui:{editorId:p.id,contactPage:'detail',capture(){},values:()=>values,resetDraft(){},notice(){}},busy:false,async save(){},render(){}};
    const controller=new ContactsController(app),deadline=t.proactive.nextAt;await controller.handle('contact-mode-save',{});
    assert.equal(t.proactive.nextAt,deadline);assert.equal(proactiveCount(t),1);assert.equal(state.selected,state.profiles[1].id);assert.equal(state.profiles[1].replyStyle,'long');
    values={...values,proactiveEnabled:'off'};await controller.handle('contact-mode-save',{});assert.equal(t.proactive.nextAt,0);assert.equal(proactiveCount(t),1);
    values={...values,proactiveEnabled:'on',proactiveHours:'4'};await controller.handle('contact-mode-save',{});assert.ok(t.proactive.nextAt>=Date.now()+4*3600000-100);assert.equal(proactiveCount(t),1);
    values={...values,proactiveDaily:'1.5'};await assert.rejects(controller.handle('contact-mode-save',{}),/整数/);assert.equal(p.proactiveDaily,3);
});
test('automatic controller works with the phone closed and another contact selected, reserves before generation, and prevents overlapping requests',async()=>{
    const state=fixture(),p=state.profiles[0],t=state.threads[0],now=Date.now();Object.assign(p,{proactiveEnabled:true,proactiveHours:1,proactiveDaily:2});reserveProactive(p,t,now-3600000);
    const snapshots=[];let release,calls=0;const done=new Promise(r=>release=r);
    const app={state,ui:{open:false,notice(){}},host:{busy:false},busy:false,disposed:false,current:id=>({p:state.profiles.find(p=>p.id===id),t:state.threads.find(t=>t.profileId===id)}),save:async()=>snapshots.push(t.proactive.nextAt),async reply(...args){assert.equal(args[5],p.id);assert.equal(args[6],true);calls++;await done;finishProactive(p,t,now);}};
    const controller=new ProactiveController(app);
    try{const first=controller.tick(now);await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(snapshots[0],now+3600000);await controller.tick(now+1);assert.equal(calls,1);release();await first;assert.equal(proactiveCount(t,now),1);assert.equal(state.selected,state.profiles[1].id);await controller.tick(now+1);assert.equal(calls,1);}
    finally{release();controller.destroy();}
});
test('automatic requests defer while either generation is busy and failed requests back off without using quota',async()=>{
    const state=fixture(),p=state.profiles[0],t=state.threads[0],now=Date.now();Object.assign(p,{proactiveEnabled:true,proactiveHours:1,proactiveDaily:2});reserveProactive(p,t,now-3600000);let calls=0;
    const app={state,ui:{open:false},host:{busy:false},busy:true,current:()=>({p,t}),async save(){},async reply(){calls++;throw Error('网络失败');}};
    const controller=new ProactiveController(app);try{
        await controller.tick(now);assert.equal(calls,0);app.busy=false;app.host.busy=true;await controller.tick(now);assert.equal(calls,0);app.host.busy=false;
        await controller.tick(now);assert.equal(calls,1);assert.equal(proactiveCount(t,now),0);assert.ok(t.proactive.retryAt>=now+5*60000);await controller.tick(now+60000);assert.equal(calls,1);
    }finally{controller.destroy();}
});
test('proactive prompt keeps the approved wording, actual roles and short-mode counts, with a user event last for native providers',()=>{
    const s=freshState().settings,p=normalizeProfile({name:'Rick',userName:'恒',replyStyle:'short',replyRange:'5-10'}),t=newThread(p.id);
    addMessage(t,'assistant','此前的消息');const r=buildPrompt(p,t,s,{kind:'proactive'});
    assert.equal(r.prompt.at(-1).role,'user');assert.match(r.prompt.at(-1).content,/没有附带 恒 的新发言/);assert.match(r.prompt.at(-1).content,/当前本机时间/);
    const rule=r.prompt.find(m=>m.content.startsWith('<主动消息>'));assert.equal(rule.content,PROACTIVE_PROMPT.replaceAll('{{char}}','Rick').replaceAll('{{user}}','恒'));
    assert.match(r.prompt.find(m=>m.content.startsWith('【短句聊天模式】')).content,/5～10条消息/);assert.ok(r.prompt.findIndex(m=>m===rule)<r.prompt.findIndex(m=>m.content.startsWith('【短句聊天模式】')));
    assert.ok(!buildPrompt(p,t,s).prompt.some(m=>m.content.startsWith('<主动消息>')));assert.equal(t.messages.length,1);
});
test('an imported or disposed state during reservation never sends a stale request or resaves the old state',async()=>{
    for(const mode of ['import','dispose','busy']) {
        const state=fixture(),p=state.profiles[0],t=state.threads[0],now=Date.now();Object.assign(p,{proactiveEnabled:true,proactiveHours:1,proactiveDaily:3});reserveProactive(p,t,now-3600000);
        let calls=0,saves=0,release;const wait=new Promise(r=>release=r);
        const app={state,ui:{open:false},host:{busy:false},busy:false,current:()=>({p,t}),async save(){saves++;if(saves===1)await wait;},async reply(){calls++;}};
        const controller=new ProactiveController(app);try{
            const pending=controller.tick(now);await new Promise(r=>setImmediate(r));
            if(mode==='import')app.state=fixture();else if(mode==='dispose')app.disposed=true;else app.busy=true;
            release();await pending;assert.equal(calls,0);assert.equal(saves,mode==='busy'?2:1);assert.equal(proactiveCount(t,now),0);
            if(mode==='busy')assert.equal(t.proactive.nextAt,now);
        }finally{release();controller.destroy();}
    }
});
