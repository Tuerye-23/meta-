import test from 'node:test';
import assert from 'node:assert/strict';
import { chatPreferences, replyParts, shortReplyParts, lastReplyGroup } from '../chat-mode.js';
import { freshState, normalizeProfile, newThread, addMessage, buildPrompt, validateBackup, summaryBatch, removeMessage } from '../core.js';
import { HEAD_PROMPT, AI_PROMPT, SHORT_CHAT_PROMPT } from '../prompts.js';
import { ContactsController } from '../contacts-controller.js';

const wire=parts=>parts.map(value=>`<消息>${value}</消息>`).join('\n');
const profile=()=>normalizeProfile({name:'Rick',userName:'恒',replyStyle:'short',replyRange:'3-5'});
test('chat preference migration defaults to long and preserves per-contact settings on source refresh and backup',()=>{
    assert.deepEqual(chatPreferences({replyStyle:'bogus',replyRange:'__proto__'}),{replyStyle:'long',replyRange:'3-5'});
    const state=freshState(),p=profile();state.profiles=[p,normalizeProfile({name:'Beta'})];state.threads=state.profiles.map(p=>newThread(p.id));
    assert.equal(normalizeProfile({name:'Rick',description:'新的卡人设'},p).replyStyle,'short');
    const restored=validateBackup(state);assert.equal(restored.profiles[0].replyRange,'3-5');assert.equal(restored.profiles[1].replyStyle,'long');
    const message=addMessage(state.threads[0],'assistant','嗯。');message.replyId='reply-test';assert.equal(validateBackup(state).threads[0].messages[0].replyId,'reply-test');
});
test('long prompt is unchanged and the approved short prompt binds the selected count without changing speaker identities',()=>{
    const s=freshState().settings,p=profile(),t=newThread(p.id);addMessage(t,'user','你今天好帅哦');
    assert.deepEqual(buildPrompt({...p,replyStyle:'long'},t,s),buildPrompt({...p,replyStyle:undefined},t,s));
    for(const range of ['3-5','5-10']) {
        p.replyRange=range;const request=buildPrompt(p,t,s),instruction=request.prompt.find(m=>m.content.startsWith('【短句聊天模式】'));
        assert.equal(request.systemPrompt,HEAD_PROMPT);assert.equal(request.prompt[0].content,AI_PROMPT);assert.equal(instruction.role,'system');
        assert.match(instruction.content,range==='3-5'?/3～5条消息/:/5～10条消息/);assert.doesNotMatch(instruction.content,/〔最少|〔最多|\{\{char\}\}/);
        assert.match(instruction.content,/Rick 的身份与 恒/);assert.equal(request.prompt.find(m=>m.content==='你今天好帅哦').role,'user');
    }
    assert.match(SHORT_CHAT_PROMPT,/不要先写出一段完整长文再按标点切开/);
    for(const kind of ['annotation','theatre'])assert.ok(!buildPrompt(p,t,s,{kind}).prompt.some(m=>m.content.startsWith('【短句聊天模式】')));
    const poke=buildPrompt(p,t,s,{kind:'poke'});assert.equal(poke.prompt.at(-1).role,'user');assert.ok(poke.prompt.findIndex(m=>m.content.startsWith('【短句聊天模式】'))>poke.prompt.findIndex(m=>m.content.startsWith('【戳一戳】')));
});
test('short wire blocks produce independent messages and never infer bubbles from paragraph breaks',()=>{
    const p=profile(),values=['……','你胡说什么呢？','……真是的。拿你没办法。','随便你怎么说吧。'];assert.deepEqual(replyParts(wire(values),p),values);
    assert.deepEqual(replyParts('长段一\n\n长段二',{replyStyle:'long'}),['长段一\n\n长段二']);
    assert.throws(()=>replyParts('……\n你胡说什么呢？\n真是的。',p),/格式不完整/);
    assert.throws(()=>replyParts(wire(values.slice(0,2)),p),/需 3～5/);assert.throws(()=>replyParts(wire(Array(6).fill('嗯。')),p),/需 3～5/);
    assert.throws(()=>replyParts('<消息>第一条</消息><消息>半截',p),/格式不完整/);
    assert.throws(()=>replyParts('开场白'+wire(values),p),/格式不完整/);assert.throws(()=>replyParts(wire(values)+'总结',p),/格式不完整/);
    assert.throws(()=>replyParts('<消息></消息>'+wire(values),p),/格式不完整/);
    assert.deepEqual(replyParts(wire(Array(10).fill('嗯。')),{...p,replyRange:'5-10'}),Array(10).fill('嗯。'));
});
test('stream parser hides tags split at every character and exposes each completed or pending bubble independently',()=>{
    const raw=wire(['……','你胡说什么呢？','真是的。']);
    for(let end=0;end<=raw.length;end++)for(const value of shortReplyParts(raw.slice(0,end),true))assert.doesNotMatch(value,/[<>]/);
    assert.deepEqual(shortReplyParts('<消息>第一条</消息><消',true),['第一条']);
    assert.deepEqual(shortReplyParts('<消息>第一条</消息><消息>正在写</消',true),['第一条','正在写']);
    assert.deepEqual(shortReplyParts(raw,true),['……','你胡说什么呢？','真是的。']);
});
test('retry addresses the contiguous whole reply and summary/history boundaries keep its bubbles together',()=>{
    const p=profile(),t=newThread(p.id),s={...freshState().settings,historyMessages:4,summaryKeep:4};
    const old=addMessage(t,'assistant','旧回复');old.replyId='same';addMessage(t,'user','最新问题');
    const parts=Array.from({length:7},(_,i)=>{const m=addMessage(t,'assistant','短句'+i);m.replyId='same';return m;});
    assert.deepEqual(lastReplyGroup(t).map(m=>m.id),parts.map(m=>m.id));assert.equal(summaryBatch(t,s).length,2);
    assert.equal(buildPrompt(p,t,s).prompt.filter(m=>m.content.startsWith('短句')).length,7);
    removeMessage(t,parts[2].id);assert.equal(lastReplyGroup(t).length,6);
    const restored=validateBackup({...freshState(),profiles:[p],threads:[t]});assert.equal(lastReplyGroup(restored.threads[0]).length,6);
    addMessage(t,'user','新的消息');assert.deepEqual(lastReplyGroup(t),[]);
});
test('chat-mode save modifies only the addressed contact and leaves inherited persona mode untouched',async()=>{
    const a=normalizeProfile({name:'A',personaMode:'inherit',binding:{avatar:'card.png'}}),b=profile(),state={profiles:[a,b],selected:b.id};let saved=0;
    const ui={editorId:a.id,contactPage:'chatMode',chatModeDirect:true,contactReturn:'chat',capture(){},values:()=>({replyStyle:'short',replyRange:'5-10'}),resetDraft(){},notice(){}};
    const app={state,ui,busy:false,save:async()=>saved++,render(){}};await new ContactsController(app).handle('contact-mode-save',{});
    assert.equal(a.replyRange,'5-10');assert.equal(a.personaMode,'inherit');assert.equal(a.manuallyEdited,undefined);assert.equal(b.replyRange,'3-5');assert.equal(state.selected,b.id);assert.equal(saved,1);assert.equal(ui.tab,'chat');
});
