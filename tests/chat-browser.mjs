import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '']}));
const base=path.resolve(import.meta.dirname,'..');const artifacts=path.resolve(base,'..','.test-output');await mkdir(artifacts,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=path.resolve(base,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/tests/fixture.html`;
const browser=await chromium.launch({headless:true,...(process.env.META_CHROMIUM_PATH?{executablePath:process.env.META_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try {
 for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:320,height:650}]) {
    const ctx=await browser.newContext({viewport});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const state=()=>page.evaluate(async()=>{const key='meta-companion:state:'+localStorage.getItem('meta-companion:scope');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('st-meta-companion-native',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly');const r=tx.objectStore('state').get(key);r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);});});
    const idle=()=>page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));
    const notice=text=>page.waitForFunction(text=>document.getElementById('mc-notice').textContent.includes(text),text);
    const app=async tab=>{await page.locator('.mc-home-button').click();await page.locator(`.mc-app[data-tab="${tab}"]`).click();};
    const start=async name=>{await page.locator('[data-action="chat-new"]').first().click();await page.locator('[data-action="contact-open"]').filter({hasText:name}).click();await page.locator('[data-action="contact-chat"]').click();};
    const font=process.env.META_FONT_FILE?(await readFile(process.env.META_FONT_FILE)).toString('base64'):'';
    const injectFont=async()=>{if(font){await page.addStyleTag({content:`@font-face{font-family:MetaTestCJK;src:url(data:font/woff2;base64,${font})}#mc-root{font-family:MetaTestCJK,system-ui!important}`});await page.evaluate(()=>document.fonts.ready);}};
    await page.goto(url);await injectFont();await page.locator('#mc-wand-button').click();await page.waitForFunction(()=>document.querySelectorAll('#mc-profile option').length===2);await idle();
    await app('chat');assert.equal(await page.locator('#mc-draft').count(),0);assert.equal(await page.locator('.mc-conversation').count(),0);
    await start('Alpha');assert.equal(await page.locator('.mc-top').isVisible(),false);await page.locator('#mc-draft').fill('今天想慢一点。');await page.locator('[data-action="send"]').click();await idle();
    await page.locator('#mc-draft').fill('Alpha专属草稿');await page.locator('[data-action="chat-plus"]').click();assert.equal(await page.locator('[data-action="chat-tool"]').count(),6);
    const calls=await page.evaluate(()=>window.mockRequests.length);await page.locator('[data-tool="photo"]').click();await notice('暂未开放');assert.equal(await page.evaluate(()=>window.mockRequests.length),calls);
    await page.locator('[data-tool="emoji"]').click();await page.locator('[data-action="chat-emoji"][data-value="❤️"]').click();const draft=await page.locator('#mc-draft').inputValue();assert.match(draft,/Alpha专属草稿/);assert.match(draft,/❤️/);
    await page.locator('[data-tool="poke"]').click();await idle();assert.equal(await page.locator('#mc-draft').inputValue(),draft);
    const pokeRequest=await page.evaluate(()=>window.mockRequests.at(-1));assert.equal(pokeRequest.prompt.at(-1).role,'user');assert.match(pokeRequest.prompt.at(-1).content,/测试用户 戳了戳 Alpha/);assert.ok(pokeRequest.prompt.some(m=>m.role==='system' && /来自 测试用户 的「戳一戳」/.test(m.content))); assert.match(pokeRequest.systemPrompt,/Mr. meeseeks/);
    let saved=await state();const alpha=saved.profiles.find(p=>p.name==='Alpha');let thread=saved.threads.find(t=>t.profileId===alpha.id);assert.equal(thread.messages.filter(m=>m.role==='note' && m.kind==='poke').length,1);
    const last=thread.messages.at(-1);await page.evaluate(()=>window.failOnce=true);await page.locator('[data-action="retry"]').click();await notice('模拟网络失败');await idle();
    thread=(await state()).threads.find(t=>t.profileId===alpha.id);assert.equal(thread.messages.at(-1).id,last.id,'failed regeneration preserves the existing reply');
    await page.locator('[data-action="retry"]').click();await idle();thread=(await state()).threads.find(t=>t.profileId===alpha.id);assert.equal(thread.messages.filter(m=>m.kind==='poke' && m.role==='note').length,1);assert.notEqual(thread.messages.at(-1).id,last.id);
    const retried=await page.evaluate(()=>window.mockRequests.at(-1));assert.equal(retried.prompt.at(-1).role,'user');assert.match(retried.prompt.at(-1).content,/小手机互动：戳一戳/);
    // Header and role avatars both lead to this contact's settings and return to the same draft.
    await page.locator('#mc-chat-title').click();await page.locator('[data-action="preview"]').click();assert.match(await page.locator('.mc-preview pre').textContent(),/Alpha专属草稿/);await page.locator('.mc-preview button').click();await page.locator('.mc-back').click();
    assert.equal(await page.locator('#mc-draft').inputValue(),draft);await page.locator('.mc-assistant [data-action="chat-settings"]').first().click();
    await page.locator('[data-action="avatar-settings"][data-target="contact"]').first().click();
    const upload=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=480;c.height=280;const x=c.getContext('2d');x.fillStyle='#89acf1';x.fillRect(0,0,480,280);return c.toDataURL('image/png').split(',')[1];}),'base64');
    await page.route('https://images.test/**',route=>route.fulfill({contentType:'image/png',body:upload}));
    const chooser=page.waitForEvent('filechooser');await page.locator('[data-action="avatar-upload"]').click();await (await chooser).setFiles({name:'avatar.png',mimeType:'image/png',buffer:upload});
    await page.waitForFunction(()=>document.querySelector('.mc-avatar-preview img')?.src.startsWith('data:image/jpeg'));
    await page.locator('[data-action="avatar-save"]').click();await notice('头像已保存');assert.match((await state()).profiles.find(p=>p.id===alpha.id).avatarImage,/^data:image\/jpeg/);
    // The URL path works for both contact and user avatars; local images never enter model prompts.
    await page.locator('[data-action="avatar-settings"][data-target="contact"]').first().click();await page.locator('[name="avatarUrl"]').fill('https://images.test/alpha.png');await page.locator('[data-action="avatar-preview"]').click();await page.locator('[data-action="avatar-save"]').click();await notice('头像已保存');
    await page.locator('[data-action="avatar-settings"][data-target="user"]').click();await page.locator('[name="avatarUrl"]').fill('https://images.test/user.png');await page.locator('[data-action="avatar-save"]').click();await notice('头像已保存');assert.equal((await state()).social.avatar,'https://images.test/user.png');
    await page.locator('.mc-back').click();assert.equal(await page.locator('#mc-draft').inputValue(),draft);assert.equal(await page.locator('.mc-assistant img').first().getAttribute('src'),'https://images.test/alpha.png');assert.equal(await page.locator('.mc-user img').first().getAttribute('src'),'https://images.test/user.png');
    await page.locator('.mc-user [data-action="avatar-settings"]').first().click();const userChooser=page.waitForEvent('filechooser');await page.locator('[data-action="avatar-upload"]').click();await (await userChooser).setFiles({name:'me.png',mimeType:'image/png',buffer:upload});await page.waitForFunction(()=>document.querySelector('.mc-avatar-preview img')?.src.startsWith('data:image/jpeg'));await page.locator('[data-action="avatar-save"]').click();await notice('头像已保存');assert.match((await state()).social.avatar,/^data:image\/jpeg/);
    await page.locator('[data-action="chat-plus"]').click();await page.screenshot({path:path.join(artifacts,`chat-tray-v070-${viewport.width}.png`)});assert.equal(await page.locator('.mc-panel').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.locator('[data-tool="company"]').click();await page.locator('[data-action="nudge"]').waitFor();await app('chat');assert.equal(await page.locator('#mc-draft').count(),0);
    await start('Beta');assert.equal(await page.locator('#mc-draft').inputValue(),'');await page.locator('#mc-draft').fill('Beta独立消息');await page.locator('[data-action="send"]').click();await idle();await page.locator('.mc-back').click();
    assert.match(await page.locator('.mc-conversation').first().textContent(),/Beta/);await page.locator('[name="messageSearch"]').fill('Alpha');assert.equal(await page.locator('.mc-conversation:visible').count(),1);await page.locator('[name="messageSearch"]').fill('');await page.screenshot({path:path.join(artifacts,`inbox-v070-${viewport.width}.png`)});
    await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();assert.equal(await page.locator('#mc-draft').inputValue(),draft);assert.doesNotMatch(await page.locator('.mc-messages').textContent(),/Beta独立消息/);
    await page.locator('#mc-draft').fill('头像不会进入API');await page.locator('[data-action="send"]').click();await idle();assert.doesNotMatch(JSON.stringify(await page.evaluate(()=>window.mockRequests.at(-1))),/images\.test|data:image/);
    await app('moments');assert.match(await page.locator('.mc-moments-identity img').getAttribute('src'),/^data:image\/jpeg/);
    await app('settings');await page.locator('[data-section="backup"]').evaluate(el=>el.open=true);const download=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const file=await download;const filePath=path.join(artifacts,`avatar-backup-${viewport.width}.json`);await (await file).saveAs(filePath);const backup=JSON.parse(await readFile(filePath,'utf8'));assert.match(backup.social.avatar,/^data:image\/jpeg/);assert.equal(backup.profiles.find(p=>p.id===alpha.id).avatarImage,'https://images.test/alpha.png');
    await page.reload();await injectFont();await page.locator('#mc-wand-button').click();await idle();await app('chat');assert.equal(await page.locator('#mc-draft').count(),0);await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();assert.equal(await page.locator('.mc-assistant img').first().getAttribute('src'),'https://images.test/alpha.png');assert.match(await page.locator('.mc-user img').first().getAttribute('src'),/^data:image\/jpeg/);
    assert.deepEqual(errors,[]);await ctx.close();console.log(`Chat ${viewport.width}px: inbox / draft isolation / plus tray / reserved actions / emoji / poke prompt / safe retry / header and avatar settings / local and URL avatars / persistence and backup passed`);
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
