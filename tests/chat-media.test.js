import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, normalizeProfile, newThread, addMessage, buildPrompt, validateBackup } from '../core.js';
import { chatImageSource, normalizeAttachment } from '../chat-media.js';
import { ChatController } from '../chat-controller.js';
import { independentBody } from '../api.js';
import { createHost } from '../host.js';
import { chatScreen } from '../chat-ui.js';

const png='data:image/png;base64,AAAA',gif='data:image/gif;base64,AAAA';
function fixture() {
    const state=freshState();state.profiles=['A','B'].map(name=>normalizeProfile({name}));state.threads=state.profiles.map(p=>newThread(p.id));state.selected=state.profiles[0].id;
    let values={draft:'第一句'},calls=[];const ui={editorId:'',drafts:new Map(),views:new Map(),content:{querySelector:()=>null},values:()=>values,clearDraft:name=>{values[name]='';},notice(){}};
    const app={state,ui,busy:false,current:(id=state.selected)=>({p:state.profiles.find(p=>p.id===id),t:state.threads.find(t=>t.profileId===id)}),save:async()=>{},render(){},reply:async(...args)=>calls.push(args)};
    return {app,controller:new ChatController(app),values,calls};
}
test('staging sentences and stickers makes no model calls, keeps contacts isolated and persists on restart',async()=>{
    const {app,controller,values,calls}=fixture(),t=app.current().t;
    await controller.handle('chat-stage',{});values.draft='第二句';await controller.handle('chat-stage',{});
    app.state.stickers.push({id:'sticker',kind:'sticker',name:'无语',source:gif});await controller.handle('chat-sticker-pick',{id:'sticker'});
    assert.equal(calls.length,0);assert.equal(t.messages.length,0);assert.deepEqual(t.outbox.map(m=>m.text),['第一句','第二句','[表情包：无语]']);
    assert.equal(app.state.threads[1].outbox.length,0);assert.deepEqual(validateBackup(app.state).threads[0].outbox,t.outbox);assert.equal(validateBackup(app.state).stickers[0].source,gif);
    assert.match(chatScreen(app.state,{chatPage:'list'},false),/待发送/);
    const request=buildPrompt(app.state.profiles[0],t,app.state.settings);assert.ok(!request.prompt.some(m=>m.content==='第一句'));
    values.draft='第三句';await controller.handle('send',{});assert.equal(calls.length,1);assert.deepEqual(calls[0][3].map(m=>m.text),['第一句','第二句','[表情包：无语]','第三句']);
});
test('double clicking send makes one request and keeps the captured recipient when selection changes',async()=>{
    const {app,controller,values,calls}=fixture();let finish;
    app.reply=(...args)=>{calls.push(args);return new Promise(resolve=>finish=resolve);};
    const id=app.state.selected,sending=controller.handle('send',{});app.state.selected=app.state.profiles[1].id;values.draft='B的草稿';await controller.handle('send',{});
    assert.equal(calls.length,1);assert.equal(calls[0][5],id);finish();await sending;
});
test('clear chat addresses the contact in details, clears memory/unread/outbox and retains quota and other chats',async()=>{
    const {app,controller}=fixture(),a=app.state.profiles[0],b=app.state.profiles[1],t=app.state.threads[0];
    addMessage(t,'user','A的旧消息');t.memory={text:'旧记忆',throughId:t.messages[0].id};t.outbox=[{id:'pending',role:'user',kind:'chat',text:'尚未发出',createdAt:1}];t.unreadIds=['old'];t.proactive.counts['2026-10-09']=2;
    addMessage(app.state.threads[1],'user','B的旧消息');app.state.selected=b.id;app.ui.editorId=a.id;
    app.ui.drafts.set('chat:'+a.id+':thread::',{draft:'旧草稿'});app.ui.drafts.set('chat:'+b.id+':thread::',{draft:'B草稿'});
    const original=globalThis.confirm;globalThis.confirm=()=>true;try{await controller.handle('delete-chat',{});}finally{globalThis.confirm=original;}
    const clean=app.state.threads[0];assert.equal(clean.messages.length,0);assert.equal(clean.outbox.length,0);assert.equal(clean.memory.text,'');assert.equal(clean.unreadIds.length,0);assert.equal(clean.proactive.counts['2026-10-09'],2);
    assert.equal(app.state.profiles.length,2);assert.equal(app.state.threads[1].messages[0].text,'B的旧消息');assert.equal(app.ui.drafts.size,1);
});
test('clearing a selected chat also removes stale summary editor drafts',async()=>{
    const {app,controller}=fixture();app.ui.editorId=app.state.selected;app.ui.drafts.set('settings:global:::',{memory:'不能恢复的旧记忆',headPrompt:'保留提示词草稿'});
    const original=globalThis.confirm;globalThis.confirm=()=>true;try{await controller.handle('delete-chat',{});}finally{globalThis.confirm=original;}
    assert.deepEqual(app.ui.drafts.get('settings:global:::'),{headPrompt:'保留提示词草稿'});
});
test('image and sticker backup migration validates URLs, retains batch boundaries and never treats GIF as a photo',()=>{
    assert.equal(chatImageSource(gif),'');assert.equal(chatImageSource(gif,true),gif);
    for(const source of ['javascript:alert(1)','data:image/svg+xml;base64,AAAA','https://user:pass@images.test/a'])assert.throws(()=>normalizeAttachment({kind:'image',source}),/无效/);
    const {app}=fixture(),t=app.current().t;for(let i=0;i<7;i++){const m=addMessage(t,'user','句子'+i);m.batchId='batch';}
    t.messages[0].attachment={kind:'image',name:'照片',source:png};app.state.settings.historyMessages=4;
    const restored=validateBackup(app.state);assert.equal(restored.threads[0].messages[0].attachment.source,png);assert.equal(buildPrompt(restored.profiles[0],restored.threads[0],restored.settings).prompt.filter(m=>m.role==='user').length,7);
    const old={...app.state};delete old.stickers;delete old.threads[0].outbox;assert.deepEqual(validateBackup(old).stickers,[]);assert.deepEqual(validateBackup(old).threads[0].outbox,[]);
});
test('pictures reach OpenAI and Claude as image blocks, while sticker meanings remain text and not huge binary strings',()=>{
    const {app}=fixture(),{p,t}=app.current();addMessage(t,'user','看看这张图').attachment={kind:'image',source:png,name:'照片'};addMessage(t,'user','[表情包：抱抱]').attachment={kind:'sticker',source:gif,name:'抱抱'};
    const request=buildPrompt(p,t,app.state.settings);
    for(const provider of ['openai','claude']) {
        const {body}=independentBody(request,{mode:'independent',provider,baseUrl:'https://example.test/v1',model:'vision',maxTokens:'4096'}),photo=body.messages.find(m=>Array.isArray(m.content));
        assert.equal(photo.content[0].text,'看看这张图');assert.equal(photo.content[1].type,provider==='claude'?'image':'image_url');
        assert.equal(body.messages.find(m=>m.content==='[表情包：抱抱]').role,'user');assert.ok(!JSON.stringify(body).includes(gif));
        if(provider==='claude')assert.deepEqual(photo.content[1].source,{type:'base64',media_type:'image/png',data:'AAAA'});else assert.equal(photo.content[1].image_url.url,png);
    }
    const {body}=independentBody({prompt:[{role:'user',content:'图床图片',images:['https://images.test/photo.png']}]},{mode:'independent',provider:'claude',baseUrl:'https://example.test/v1',model:'vision',maxTokens:'4096'});assert.deepEqual(body.messages[0].content[1].source,{type:'url',url:'https://images.test/photo.png'});
});
test('host images use chat-completion parameters for non-streaming requests without passing arrays through generateRaw macros',async()=>{
    let sent,raw=0;const settings={chat_completion_source:'custom',model:'vision',max_tokens:777};
    const context={mainApi:'openai',oai_settings:settings,getChatCompletionModel:()=> 'vision',getRequestHeaders:()=>({}),generateRaw:async()=>{raw++;return 'wrong';},createGenerationParameters:async(copy,model,type,messages)=>({generate_data:{...copy,model,messages}})};
    const root={SillyTavern:{getContext:()=>context},fetch:async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'图片回复'}}]}),{headers:{'Content-Type':'application/json'}});}};
    assert.equal(await createHost(root).generate({systemPrompt:'测试',prompt:[{role:'user',content:'看图 {{getvar::x}}',images:[png]}]},{mode:'host',stream:false}),'图片回复');
    assert.equal(raw,0);assert.equal(sent.stream,false);assert.equal(sent.max_tokens,777);assert.equal(sent.messages[1].content[0].text,'看图 ｛｛getvar::x｝｝');assert.equal(sent.messages[1].content[1].image_url.url,png);assert.deepEqual(settings,{chat_completion_source:'custom',model:'vision',max_tokens:777});
});
test('native Claude retains URL image sources and Gemini receives fetched image data rather than an unparseable URL',async()=>{
    for(const provider of ['claude','makersuite']) {
        let sent,imageFetches=0;const context={mainApi:'openai',oai_settings:{chat_completion_source:provider},getChatCompletionModel:()=> 'vision',getRequestHeaders:()=>({Authorization:'host-key'}),createGenerationParameters:async(copy,model,type,messages)=>({generate_data:{messages}})};
        const root={SillyTavern:{getContext:()=>context},fetch:async(url,options)=>{
            if(url.startsWith('https://images.test')){imageFetches++;assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});}
            sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'看到了'}}]}),{headers:{'Content-Type':'application/json'}});
        }};
        await createHost(root).generate({prompt:[{role:'user',content:'看图',images:['https://images.test/photo.png']}]},{mode:'host',stream:false});
        const photo=sent.messages.at(-1).content[1];if(provider==='claude'){assert.deepEqual(photo.source,{type:'url',url:'https://images.test/photo.png'});assert.equal(imageFetches,0);}else {assert.equal(photo.image_url.url,'data:image/png;base64,AQID');assert.equal(imageFetches,1);}
    }
});
