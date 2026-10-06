import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, normalizeProfile, newThread, addMessage, buildPrompt, validateBackup } from '../core.js';
import { POKE_PROMPT, HEAD_PROMPT, AI_PROMPT } from '../prompts.js';
import { avatarSource, avatarMarkup } from '../images.js';
import { AvatarController } from '../avatars.js';
import { recentConversations, conversationTime, chatScreen } from '../chat-ui.js';

test('recent inbox excludes untouched contacts and sorts latest events without modifying stored histories',()=>{
    const state=freshState();state.profiles=['A','B','C'].map(name=>normalizeProfile({name}));state.threads=state.profiles.map(p=>newThread(p.id));
    addMessage(state.threads[0],'user','较早消息').createdAt=100;addMessage(state.threads[1],'note','戳一戳','poke').createdAt=200;
    const original=JSON.stringify(state.threads);assert.deepEqual(recentConversations(state).map(c=>c.p.name),['B','A']);assert.equal(JSON.stringify(state.threads),original);
    const html=chatScreen(state,{chatPage:'list'},false);assert.match(html,/data-action="chat-open"/);assert.doesNotMatch(html,/id="mc-draft"|mc-messages/);
});

test('inbox times use local calendar days including yesterday and earlier years',()=>{
    const now=new Date(2026,9,7,7,30).getTime();assert.equal(conversationTime(new Date(2026,9,7,6,40).getTime(),now),'06:40');
    assert.equal(conversationTime(new Date(2026,9,6,23,59).getTime(),now),'昨天');assert.match(conversationTime(new Date(2025,1,1).getTime(),now),/2025/);
});

test('poke appends the approved prompt to regular chat definitions and history without changing original message roles',()=>{
    const state=freshState(),p=normalizeProfile({name:'Rick',userName:'恒',avatarImage:'https://images.test/secret.png',description:'Rick原始人设'}),t=newThread(p.id);
    state.social.avatar='data:image/png;base64,AAAA';addMessage(t,'user','刚才的话题');addMessage(t,'assistant','前一次回复');addMessage(t,'note','恒 戳了戳 Rick。','poke');
    const request=buildPrompt(p,t,state.settings,{kind:'poke'});assert.equal(request.systemPrompt,HEAD_PROMPT);assert.equal(request.prompt[0].content,AI_PROMPT);
    assert.equal(request.prompt.at(-1).role,'system');assert.match(request.prompt.at(-1).content,/来自 恒 的「戳一戳」/);assert.match(request.prompt.at(-1).content,/另一个世界的故事仍是你们共同观看/);
    assert.equal(request.prompt.filter(m=>m.role==='user' && m.content==='刚才的话题').length,1);
    assert.doesNotMatch(request.prompt.map(m=>m.content).join('\n'),/images\.test|data:image|avatarImage/);
    assert.ok(!buildPrompt(p,t,state.settings).prompt.some(m=>m.content.startsWith('【戳一戳】')));assert.match(POKE_PROMPT,/不替 {{user}} 补写/);
});

test('avatars accept raster uploads or http image URLs and persist independently of card bindings',()=>{
    for(const value of ['javascript:alert(1)','file:///tmp/a','blob:https://x/y','data:image/svg+xml;base64,AAAA','https://user:pass@images.test/a'])assert.equal(avatarSource(value),'');
    assert.equal(avatarSource(' https://images.test/a.png?size=320 '),'https://images.test/a.png?size=320');assert.equal(avatarSource('data:image/png;base64,AAAA'),'data:image/png;base64,AAAA');
    const state=freshState(),p=normalizeProfile({name:'A',avatarImage:'https://images.test/a',binding:{avatar:'source-card.png'}});state.profiles=[p];state.threads=[newThread(p.id)];state.social.avatar='https://images.test/user';
    const restored=validateBackup(state);assert.equal(restored.profiles[0].avatarImage,p.avatarImage);assert.equal(restored.profiles[0].binding.avatar,'source-card.png');assert.equal(restored.social.avatar,state.social.avatar);
    assert.equal(normalizeProfile({name:'A'},p).avatarImage,p.avatarImage);assert.equal(normalizeProfile({name:'A',avatarImage:''},p).avatarImage,'');
    assert.match(avatarMarkup('A','https://images.test/a?x=1&y=2'),/x=1&amp;y=2/);
});

test('avatar editor changes only the addressed contact or global user and cancellation discards drafts',async()=>{
    const state=freshState();state.profiles=['A','B'].map(name=>normalizeProfile({name}));let saves=0;let values={avatarUrl:'https://images.test/b.png'};
    const ui={tab:'roles',contactPage:'detail',editorId:state.profiles[1].id,chatPage:'list',capture(){},avatarSerial:0,drafts:new Map(),previous:'avatar',values:()=>values,notice(){}};
    const app={state,ui,host:{context:()=>({name1:'恒'})},render(){},save:async()=>{saves++;}};const avatars=new AvatarController(app);
    avatars.open('contact',state.profiles[1].id);await avatars.handle('avatar-preview');assert.equal(state.profiles[1].avatarImage,'');avatars.close();assert.equal(state.profiles[1].avatarImage,'');
    avatars.open('contact',state.profiles[1].id);await avatars.handle('avatar-save');assert.equal(state.profiles[1].avatarImage,'https://images.test/b.png');assert.equal(state.profiles[0].avatarImage,'');
    values={avatarUrl:'https://images.test/me.png'};avatars.open('user');await avatars.handle('avatar-save');assert.equal(state.social.avatar,values.avatarUrl);assert.equal(saves,2);
    avatars.open('user');values={avatarUrl:'javascript:alert(1)'};await assert.rejects(()=>avatars.handle('avatar-save'),/有效的 http/);assert.equal(saves,2);
});
