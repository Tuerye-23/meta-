import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, normalizeProfile, newThread, addMessage, buildPrompt, validateBackup } from '../core.js';
import { POKE_PROMPT, HEAD_PROMPT, AI_PROMPT } from '../prompts.js';
import { avatarSource, avatarMarkup } from '../images.js';
import { AvatarController } from '../avatars.js';
import { recentConversations, conversationTime, chatScreen } from '../chat-ui.js';
import { independentBody } from '../api.js';
import { createHost } from '../host.js';

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

const timeLabels=html=>[...html.matchAll(/<div class="mc-chat-timestamp"[^>]*>([\s\S]*?)<\/div>/g)].map(match=>match[1].replace(/<[^>]*>/g,''));
test('a later proactive reply starts a new time section without requiring a user message',()=>{
    const state=freshState(),p=normalizeProfile({name:'Rick'}),t=newThread(p.id);
    state.profiles=[p];state.threads=[t];state.selected=p.id;
    const at=(hour,minute=0)=>{const date=new Date();date.setHours(hour,minute,0,0);return date.getTime();};
    addMessage(t,'user','你好').createdAt=at(8);
    addMessage(t,'assistant','你好').createdAt=at(8,1);
    const later=addMessage(t,'assistant','吃了吗','proactive');later.createdAt=at(10);
    const last=addMessage(t,'assistant','我刚吃完','proactive');last.createdAt=at(10);last.replyId=later.replyId='short-group';
    const html=chatScreen(state,{chatPage:'thread'},false);
    assert.deepEqual(timeLabels(html),['08:00','10:00']);
    assert.ok(html.indexOf('10:00')<html.indexOf('吃了吗'));
    assert.deepEqual(timeLabels(chatScreen(state,{chatPage:'thread',retryHidden:{profileId:p.id,ids:new Set([later.id,last.id])}},true)),['08:00']);
});
test('time sections include five-minute gaps and local midnight, and survive reopening stored history',()=>{
    const state=freshState(),p=normalizeProfile({name:'Rick'}),t=newThread(p.id);
    state.profiles=[p];state.threads=[t];state.selected=p.id;
    const start=new Date(2025,11,31,23,50).getTime();
    for(const [i,minutes] of [0,4,9,10,11].entries())addMessage(t,'assistant','消息'+i).createdAt=start+minutes*60000;
    const labels=timeLabels(chatScreen(validateBackup(state),{chatPage:'thread'},false));
    assert.equal(labels.length,3);
    assert.match(labels[0],/2025.*12.*31.*23:50/);
    assert.match(labels[1],/2025.*12.*31.*23:59/);
    assert.match(labels[2],/1.*1.*00:00/);
});

test('poke appends the approved prompt to regular chat definitions and history without changing original message roles',()=>{
    const state=freshState(),p=normalizeProfile({name:'Rick',userName:'恒',avatarImage:'https://images.test/secret.png',description:'Rick原始人设'}),t=newThread(p.id);
    state.social.avatar='data:image/png;base64,AAAA';addMessage(t,'user','刚才的话题');addMessage(t,'assistant','前一次回复');addMessage(t,'note','恒 戳了戳 Rick。','poke');
    const request=buildPrompt(p,t,state.settings,{kind:'poke'});assert.equal(request.systemPrompt,HEAD_PROMPT);assert.equal(request.prompt[0].content,AI_PROMPT);
    const instruction=request.prompt.find(m=>m.role==='system' && m.content.startsWith('【戳一戳】'));
    assert.match(instruction.content,/来自 恒 的「戳一戳」/);assert.match(instruction.content,/另一个世界的故事仍是你们共同观看/);
    assert.equal(request.prompt.at(-1).role,'user');assert.match(request.prompt.at(-1).content,/恒 戳了戳 Rick。/);
    assert.equal(request.prompt.filter(m=>m.role==='user' && m.content==='刚才的话题').length,1);
    assert.doesNotMatch(request.prompt.map(m=>m.content).join('\n'),/images\.test|data:image|avatarImage/);
    assert.ok(!buildPrompt(p,t,state.settings).prompt.some(m=>m.content.startsWith('【戳一戳】')));assert.match(POKE_PROMPT,/不替 {{user}} 补写/);
});

test('poke ends with the real interaction after provider system extraction for empty, completed and summarized chats',()=>{
    const state=freshState(),p=normalizeProfile({name:'Rick',userName:'恒'});
    for(const scenario of ['empty','completed','summarized']) {
        const t=newThread(p.id);
        if(scenario!=='empty'){addMessage(t,'user','之前的话');addMessage(t,'assistant','之前的回复');}
        if(scenario==='summarized'){t.memory={text:'此前聊过写作。',throughId:t.messages.at(-1).id};}
        const before=JSON.stringify(t),request=buildPrompt(p,t,state.settings,{kind:'poke'});
        for(const provider of ['openai','claude']) {
            const {body}=independentBody(request,{mode:'independent',provider,baseUrl:'https://example.test/v1',model:'test-model',maxTokens:'12000'});
            const dialogue=body.messages.filter(m=>m.role!=='system');
            assert.equal(dialogue.at(-1).role,'user',`${scenario} / ${provider}`);
            assert.match(dialogue.at(-1).content,/\[小手机互动：戳一戳\]/);
            assert.match(dialogue.at(-1).content,/没有附带文字消息/);
        }
        assert.equal(JSON.stringify(t),before,'the wire event does not create another stored message');
    }
});

test('host raw and streaming poke requests survive system extraction without ending in a model turn',async()=>{
    const state=freshState(),p=normalizeProfile({name:'Rick',userName:'恒'}),t=newThread(p.id);addMessage(t,'user','刚才的消息');addMessage(t,'assistant','刚才的回复');
    const request=buildPrompt(p,t,state.settings,{kind:'poke'}),seen=[];
    const validate=messages=>{const dialogue=messages.filter(m=>m.role!=='system');assert.equal(dialogue.at(-1).role,'user');assert.match(dialogue.at(-1).content,/恒 戳了戳 Rick/);seen.push(dialogue);return dialogue;};
    const context={mainApi:'openai',eventTypes:{},getRequestHeaders:()=>({}),oai_settings:{chat_completion_source:'makersuite'},getChatCompletionModel:()=> 'test-gemini',generateRaw:async r=>{validate(r.prompt);return '怎么啦？';},createGenerationParameters:async(settings,model,type,messages)=>({generate_data:{model,messages:validate(messages)}}),getStreamingReply:data=>data.choices?.[0]?.delta?.content || ''};
    const root={SillyTavern:{getContext:()=>context},fetch:async(url,options)=>{assert.equal(JSON.parse(options.body).messages.at(-1).role,'user');return new Response('data: {"choices":[{"delta":{"content":"怎么啦？"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}};
    const host=createHost(root);for(const stream of [false,true])assert.equal(await host.generate(request,{mode:'host',stream}),'怎么啦？');assert.equal(seen.length,2);
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
