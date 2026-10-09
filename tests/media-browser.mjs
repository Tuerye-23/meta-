import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '']}));
const base=path.resolve(import.meta.dirname,'..'),artifacts=path.resolve(base,'..','.test-output');await mkdir(artifacts,{recursive:true});
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4XcAAAAASUVORK5CYII=','base64');
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/test-image.png'){res.setHeader('Content-Type','image/png');res.end(pixel);return;}const file=path.resolve(base,'.'+decodeURIComponent(pathname));if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.META_CHROMIUM_PATH?{executablePath:process.env.META_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try {
 for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:320,height:650}]) {
    const ctx=await browser.newContext({viewport,hasTouch:viewport.width<600,timezoneId:'Asia/Shanghai'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const state=()=>page.evaluate(async()=>{const key='meta-companion:state:'+localStorage.getItem('meta-companion:scope');const db=await new Promise(resolve=>{const r=indexedDB.open('st-meta-companion-native',1);r.onsuccess=()=>resolve(r.result);});return new Promise(resolve=>{const r=db.transaction('state','readonly').objectStore('state').get(key);r.onsuccess=()=>{resolve(r.result);db.close();};});});
    const idle=()=>page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));
    const app=async tab=>{await page.locator('.mc-home-button').click();await page.locator(`.mc-app[data-tab="${tab}"]`).click();};
    const openThread=async id=>{await app('chat');await page.locator(`[data-action="chat-open"][data-id="${id}"]`).click();};
    const tool=async key=>{await page.locator('[data-action="chat-plus"]').click();await page.locator(`[data-tool="${key}"]`).click();};
    const upload=async file=>{const chooser=page.waitForEvent('filechooser');await page.locator('[data-action="chat-media-upload"]').click();await (await chooser).setFiles(file);};
    await page.goto(origin+'/tests/fixture.html');
    const font=process.env.META_FONT_FILE?(await readFile(process.env.META_FONT_FILE)).toString('base64'):'';
    const injectFont=async()=>{if(font){await page.addStyleTag({content:`@font-face{font-family:MetaTestCJK;src:url(data:font/woff2;base64,${font})}#mc-root{font-family:MetaTestCJK,system-ui!important}`});await page.evaluate(()=>document.fonts.ready);}};
    await injectFont();await page.locator('#mc-wand-button').click();await page.waitForFunction(()=>document.querySelectorAll('#mc-profile option').length===2);await idle();
    const alpha=(await state()).profiles.find(p=>p.name==='Alpha'),beta=(await state()).profiles.find(p=>p.name==='Beta');
    await app('roles');await page.locator(`[data-action="contact-open"][data-id="${alpha.id}"]`).click();assert.equal(await page.locator('[data-action="delete-chat"]').textContent(),'删除当前聊天');await page.locator('[data-action="contact-chat"]').click();
    await page.locator('#mc-draft').fill('第一句');await page.locator('#mc-draft').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-queued-id]').length===1);
    await page.locator('#mc-draft').fill('第二句');await page.locator('#mc-draft').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-queued-id]').length===2);
    assert.equal(await page.locator('.mc-compose-hint').count(),0);assert.equal(await page.locator('[data-action="chat-stage"]').count(),0);assert.equal(await page.evaluate(()=>window.mockRequests.length),0);assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).messages.length,0);
    await page.locator('[data-queued-id] [data-action="chat-queued-delete"]').first().click();await page.waitForFunction(()=>document.querySelectorAll('[data-queued-id]').length===1);
    await tool('stickers');assert.equal(await page.locator('.mc-chat-tray').count(),0);assert.equal(await page.locator('.mc-emoji-picker').count(),0);
    const ratio=await page.locator('.mc-media-panel').evaluate(el=>el.getBoundingClientRect().height/document.querySelector('.mc-panel').getBoundingClientRect().height);assert.ok(ratio>.4 && ratio<.6,ratio);
    await page.locator('[name="chatMediaName"]').fill('抱抱');
    const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');x.fillStyle='#7db2fa';x.fillRect(10,10,140,70);return c.toDataURL('image/png');});
    await upload({name:'抱抱.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});await page.waitForFunction(()=>document.querySelectorAll('.mc-sticker-item').length===1);
    assert.equal(await page.locator('.mc-sticker-item img').evaluate(el=>el.complete && el.naturalWidth>0),true);assert.equal((await state()).stickers[0].source.startsWith('data:image/png'),true);
    await page.locator('.mc-media-add summary').click();await page.locator('[name="chatMediaName"]').fill('无语');await page.locator('[name="chatMediaUrl"]').fill(origin+'/test-image.png');await page.locator('[data-action="chat-media-link"]').click();await page.waitForFunction(()=>document.querySelectorAll('.mc-sticker-item').length===2);
    await page.locator('.mc-media-add summary').click();await upload({name:'动图.gif',mimeType:'image/gif',buffer:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')});await page.waitForFunction(()=>document.querySelectorAll('.mc-sticker-item').length===3);
    assert.equal((await state()).stickers[2].source.startsWith('data:image/gif'),true);await page.locator('[data-action="chat-sticker-pick"]').first().click();await page.waitForFunction(()=>document.querySelectorAll('[data-queued-id]').length===2);
    await page.screenshot({path:path.join(artifacts,`stickers-v0110-${viewport.width}.png`)});
    await page.locator('[data-action="chat-sticker-delete"]').nth(1).click();await page.waitForFunction(()=>document.querySelectorAll('.mc-sticker-item').length===2);
    await page.locator('[data-action="chat-media-close"]').click();await tool('photo');await page.locator('[name="chatMediaName"]').fill('蓝色图片');await upload({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});await page.waitForFunction(()=>document.querySelectorAll('[data-queued-id]').length===3);
    assert.equal(await page.locator('.mc-media-panel').count(),0);await tool('photo');await page.locator('[name="chatMediaUrl"]').fill(origin+'/test-image.png');await page.locator('[data-action="chat-media-link"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-queued-id]').length===4);
    assert.equal(await page.evaluate(()=>window.mockRequests.length),0);await page.locator('.mc-message-image').last().click();assert.equal(await page.locator('dialog[open] img').count(),1);await page.locator('dialog[open] button').click();
    await app('roles');await page.locator(`[data-action="contact-open"][data-id="${beta.id}"]`).click();await page.locator('[data-action="contact-chat"]').click();assert.equal(await page.locator('[data-queued-id]').count(),0);
    await page.reload();await injectFont();await page.locator('#mc-wand-button').click();await idle();await openThread(alpha.id);assert.equal(await page.locator('[data-queued-id]').count(),4);assert.equal((await state()).stickers.length,2);
    // Use the real host request path with a mocked backend. Picture arrays bypass generateRaw's string macro pass.
    await page.evaluate(()=>{const c=window.mockContext;c.mainApi='openai';c.oai_settings={chat_completion_source:'custom',model:'vision'};c.getChatCompletionModel=()=> 'vision';c.createGenerationParameters=async(settings,model,type,messages)=>({generate_data:{...settings,model,messages}});window.sentMedia=[];const original=window.fetch;window.fetch=async(url,options)=>{if(url!=='/api/backends/chat-completions/generate')return original(url,options);window.sentMedia.push(JSON.parse(options.body));if(window.failMedia){window.failMedia=false;return new Response('failed',{status:500});}return new Response(JSON.stringify({choices:[{message:{content:'Alpha：收到了你这一组消息和图片。'}}]}),{headers:{'Content-Type':'application/json'}});};});
    await page.locator('#mc-draft').fill('第三句');await page.locator('[data-action="send"]').click();await idle();
    const body=await page.evaluate(()=>window.sentMedia[0]),user=body.messages.filter(m=>m.role==='user');assert.equal(await page.evaluate(()=>window.sentMedia.length),1);assert.equal(user.length,5);assert.equal(user[0].content,'第二句');assert.equal(user[1].content,'[表情包：抱抱]');assert.equal(user.at(-1).content,'第三句');assert.equal(user[2].content[1].type,'image_url');assert.ok(user[2].content[1].image_url.url.startsWith('data:image/jpeg'));assert.equal(user[3].content[1].image_url.url,origin+'/test-image.png');
    assert.equal(await page.locator('[data-queued-id]').count(),0);let t=(await state()).threads.find(t=>t.profileId===alpha.id);assert.equal(new Set(t.messages.filter(m=>m.role==='user').map(m=>m.batchId)).size,1);assert.equal(t.messages.filter(m=>m.role==='assistant').length,1);
    assert.equal(await page.locator('[data-action="chat-unread"]').count(),0,'sending from the latest messages keeps the generated reply in view');
    await page.screenshot({path:path.join(artifacts,`media-chat-v0110-${viewport.width}.png`)});assert.equal(await page.locator('.mc-panel').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.evaluate(()=>window.failMedia=true);await page.locator('#mc-draft').fill('失败后也不能丢的消息');await page.locator('[data-action="send"]').click();await idle();assert.ok((await state()).threads.find(t=>t.profileId===alpha.id).messages.some(m=>m.text==='失败后也不能丢的消息'));assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).messages.filter(m=>m.role==='assistant').length,1);
    // Clear only Alpha, even with Beta selected in the background; cancellation leaves history intact.
    await app('roles');await page.locator(`[data-action="contact-open"][data-id="${alpha.id}"]`).click();page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-action="delete-chat"]').click();assert.ok((await state()).threads.find(t=>t.profileId===alpha.id).messages.length);
    page.once('dialog',dialog=>dialog.accept());await page.locator('[data-action="delete-chat"]').click();await page.waitForFunction(()=>document.getElementById('mc-notice').textContent==='当前聊天已删除。');t=(await state()).threads.find(t=>t.profileId===alpha.id);assert.equal(t.messages.length,0);assert.equal(t.outbox.length,0);assert.equal((await state()).profiles.length,2);assert.equal((await state()).stickers.length,2);
    await page.locator('[data-action="contact-chat"]').click();assert.equal(await page.locator('[data-queued-id]').count(),0);assert.equal(await page.locator('.mc-chat-message').count(),0);assert.equal(await page.locator('#mc-draft').inputValue(),'');
    assert.deepEqual(errors,[]);await ctx.close();console.log(`Media ${viewport.width}px: queued batch / no early request / per-contact restart / half-screen stickers / PNG alpha and GIF / hosted images / picture payload / one response / failure preservation / targeted deletion passed`);
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
