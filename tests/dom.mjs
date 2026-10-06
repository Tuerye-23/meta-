import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require=createRequire(import.meta.url);
const dependency=require.resolve('happy-dom',{paths:[process.env.META_TEST_NODE_MODULES || '',path.resolve(import.meta.dirname,'..')]});
const { Window }=await import(pathToFileURL(dependency).href);
const base=path.resolve(import.meta.dirname,'..');
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const window=new Window({url:'http://localhost/tests/fixture.html',width:390,height:844});
const document=window.document;
for(const key of ['window','document','localStorage','navigator','HTMLElement','Element']) Object.defineProperty(globalThis,key,{value:window[key]||window,configurable:true});
globalThis.confirm=()=>true;
const html=await readFile(path.join(base,'tests/fixture.html'),'utf8');
document.write(html);window.eval(document.querySelector('script:not([type])').textContent);
globalThis.SillyTavern=window.SillyTavern;globalThis.STBaiBaiBook=window.STBaiBaiBook;
Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
const errors=[];const oldError=console.error;console.error=(...args)=>{errors.push(String(args[1]?.message||args[0]));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){for(let i=0;i<300;i++){if(fn())return;await sleep(5);}throw Error('Timed out: '+label);}
const $=s=>document.querySelector(s);const click=s=>{assert.ok($(s),'missing '+s);$(s).click();};
const fill=(name,value)=>{assert.ok($(`[name="${name}"]`),name);$(`[name="${name}"]`).value=value;};
const switchRole=name=>{const select=$('#mc-profile');select.value=[...select.options].find(o=>o.textContent===name).value;select.dispatchEvent(new window.Event('change'));};
try {
 await import(pathToFileURL(path.join(base,'index.js')).href);document.dispatchEvent(new window.Event('DOMContentLoaded'));
 await wait(()=>$('#mc-wand-button'),'initialization');assert.equal($('#mc-launcher'),null);click('#mc-wand-button');click('[data-tab="roles"]');click('[data-action="extract"]');
 await wait(()=>$('#mc-profile').options.length===2,'multi character extraction');assert.equal($('[name="name"]').value,'Alpha');
 click('[data-tab="chat"]');fill('draft','我的第一条');window.mockDelay=100;click('[data-action="send"]');switchRole('Beta');
 await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'role-switch generation');assert.ok(!$('.mc-messages').textContent.includes('我的第一条'));
 switchRole('Alpha');assert.ok($('.mc-messages').textContent.includes('我的第一条'));assert.ok($('.mc-messages').textContent.includes('Alpha：收到'));
 window.mockDelay=0;click('[data-tab="story"]');assert.equal($('[name="cutoff"]'),null);
 await wait(()=>$('[name="regexIds"] option'),'enabled regex list');fill('includeTags','正文');fill('excludeTags','状态栏');click('[data-action="save-story-settings"]');await wait(()=>$('#mc-notice').textContent.includes('读取设置已保存'),'story settings');
 window.mockContext.chat.push({name:'Alpha',is_user:false,mes:'<正文>新的自动同步剧情</正文><状态栏>秘密状态</状态栏>'});window.mockEmit('MESSAGE_RECEIVED');
 await wait(()=>$('#mc-content').textContent.includes('新的自动同步剧情'),'automatic main sync');assert.ok(!$('#mc-content').textContent.includes('秘密状态'));
 window.mockContext.chat.at(-1).mes='<正文>修改后的剧情</正文>';window.mockEmit('MESSAGE_EDITED');await wait(()=>$('#mc-content').textContent.includes('修改后的剧情'),'edited main sync');
 click('[data-action="annotate"]');await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'annotation');assert.ok($('#mc-content').textContent.includes('你们留下的批注'));
 fill('includeTags','');const regexSelect=$('[name="regexIds"]');regexSelect.options[0].selected=true;click('[data-action="save-story-settings"]');await wait(()=>$('#mc-notice').textContent.includes('读取设置已保存'),'regex extraction settings');
 fill('memoryBook','测试世界');$('[name="memoryBook"]').dispatchEvent(new window.Event('change',{bubbles:true}));await wait(()=>$('[name="memoryEntry"] option[value="0"]'),'memory entries');fill('memoryEntry','0');fill('storyMemorySource','worldbook');click('[data-action="save-story-settings"]');await wait(()=>$('#mc-notice').textContent.includes('读取设置已保存'),'worldbook memory');
 click('[data-tab="chat"]');fill('draft','现在看到哪了');click('[data-action="send"]');await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'latest story send');assert.match(window.mockRequests.at(-1).systemPrompt,/修改后的剧情|城市背景/);assert.ok(!window.mockRequests.at(-1).systemPrompt.includes('摘要截至'));
 window.failOnce=true;fill('draft','重试的消息');click('[data-action="send"]');await wait(()=>$('#mc-notice').textContent.includes('模拟网络失败'),'API error');click('[data-action="retry"]');await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'retry');assert.equal([...document.querySelectorAll('.mc-user')].filter(n=>n.textContent.includes('重试的消息')).length,1);
 click('[data-tab="company"]');fill('activity','一起写东西');click('[data-action="start-company"]');await wait(()=>$('#mc-notice').textContent.includes('已开始'),'company start');click('[data-action="nudge"]');await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'nudge');click('[data-tab="chat"]');assert.ok($('.mc-messages').textContent.includes('主动消息'));
 click('[data-tab="company"]');click('[data-action="stop-company"]');await wait(()=>$('#mc-notice').textContent.includes('已结束'),'company stop');fill('scene','便利店停电了');click('[data-action="theatre"]');await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'theatre');assert.ok($('.mc-messages').textContent.includes('便利店停电了'));
 click('[data-tab="settings"]');fill('customInstruction','自然一点');click('[data-action="save-settings"]');await wait(()=>$('#mc-notice').textContent.includes('已保存'),'settings');
 const readState=()=>JSON.parse(localStorage.getItem('meta-companion:state:'+localStorage.getItem('meta-companion:scope')));
 $('[name="autoSummary"]').checked=true;fill('summaryEvery','16');fill('summaryKeep','4');fill('summaryInstruction','整理这两人：测试自定义提示词');click('[data-action="save-summary-settings"]');await wait(()=>$('#mc-notice').textContent.includes('总结设置已保存'),'auto summary config');
 click('[data-tab="chat"]');for(let i=0;i<5;i++){fill('draft','自动总结消息'+i);click('[data-action="send"]');await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'auto summary reply');}
 await wait(()=>readState().threads[0].memory.throughId,'automatic summary stored');const summary=window.mockRequests.find(r=>r.systemPrompt==='整理这两人：测试自定义提示词');assert.ok(summary);assert.ok(summary.prompt[0].content.includes('我的第一条'));assert.ok(!summary.prompt[0].content.includes('城市背景'));assert.equal(readState().threads[1].memory.throughId,'');
 const previousMemory=readState().threads[0].memory;const oldGenerate=window.mockContext.generateRaw;let failSummary=true;
 window.mockContext.generateRaw=async request=>{if(failSummary&&request.systemPrompt.startsWith('整理这两人')){failSummary=false;throw Error('模拟总结失败');}return oldGenerate(request);};
 for(let i=0;i<4;i++){fill('draft','总结失败也要保留回复'+i);click('[data-action="send"]');await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'summary failure reply');}
 assert.equal(failSummary,false);assert.deepEqual(readState().threads[0].memory,previousMemory);assert.ok(readState().threads[0].messages.some(m=>m.text==='总结失败也要保留回复3'));
 fill('draft','再次总结');click('[data-action="send"]');await wait(()=>!$('#mc-status').textContent.includes('正在输入'),'summary retry');assert.notEqual(readState().threads[0].memory.throughId,previousMemory.throughId);
 const saved=readState();assert.equal(saved.profiles.length,2);assert.equal(saved.settings.customInstruction,'自然一点');assert.equal(saved.threads[0].story.frozen,false);assert.equal(saved.settings.storyMemorySource,'worldbook');assert.ok(saved.threads[0].messages.some(m=>m.text.includes('便利店停电了')));
 const calls=[];globalThis.quickReplyApi={getSetByName:()=>true,getQrByLabel:()=>false,createSet:async()=>{},createQuickReply:(name,label,props)=>calls.push(props.message),addGlobalSet:()=>{}};
 click('[data-tab="settings"]');click('[data-action="create-qr"]');await wait(()=>$('#mc-notice').textContent.includes('已添加'),'QR');assert.deepEqual(calls,['/meta']);
 globalThis.STMetaCompanion.destroy();await import(pathToFileURL(path.join(base,'index.js')).href+'?reload=1');await wait(()=>$('#mc-wand-button'),'restart');click('#mc-wand-button');assert.ok($('.mc-messages').textContent.includes('我的第一条'));
 assert.deepEqual(errors,['模拟网络失败']);console.log('DOM interaction tests passed: wand, QR, extraction, role isolation, live sync/edit, tag/regex filters, worldbook memory, automatic meta summary, annotations, retry, companionship, restart.');
} finally {globalThis.STMetaCompanion?.destroy();console.error=oldError;await window.happyDOM.close();}
