import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const playwrightPath=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '';
let chromium;
try {({chromium}=require('playwright'));}catch{({chromium}=require(require.resolve('playwright',{paths:[playwrightPath]})));}
const base=path.resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{try{const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(base,'.'+relative);if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/tests/fixture.html`;
const browser=await chromium.launch({headless:true, ...(process.env.META_CHROMIUM_PATH ? {executablePath:process.env.META_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']} : {})});
const artifacts=path.resolve(base,'..','.test-output');await mkdir(artifacts,{recursive:true});
try {
  for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:320,height:650}]) {
    const ctx=await browser.newContext({viewport});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.locator('#mc-wand-button').click();
    await page.locator('.mc-nav [data-tab="roles"]').click();await page.locator('[data-action="extract"]').click();
    await page.locator('#mc-profile option').filter({hasText:'Alpha'}).waitFor({state:'attached'});
    await page.waitForFunction(()=>document.querySelector('[name="name"]')?.value==='Alpha');
    assert.equal(await page.locator('#mc-profile option').count(),2);
    await page.locator('.mc-nav [data-tab="chat"]').click();await page.locator('#mc-draft').fill('第一条私人消息');
    await page.locator('[data-action="preview"]').click();await page.locator('.mc-preview').waitFor();assert.match(await page.locator('.mc-preview pre').textContent(),/第一条私人消息/);await page.locator('.mc-preview button').click();
    await page.evaluate(()=>window.mockDelay=350);await page.locator('[data-action="send"]').click();
    await page.locator('#mc-profile').selectOption({label:'Beta'});await page.waitForTimeout(500);
    assert.doesNotMatch(await page.locator('.mc-messages').textContent(),/第一条私人消息/);
    await page.locator('#mc-profile').selectOption({label:'Alpha'});assert.match(await page.locator('.mc-messages').textContent(),/第一条私人消息/);assert.match(await page.locator('.mc-messages').textContent(),/Alpha：收到/);
    await page.evaluate(()=>window.mockDelay=0);await page.locator('.mc-nav [data-tab="story"]').click();
    assert.equal(await page.locator('[name="cutoff"]').count(),0);
    await page.locator('[name="includeTags"]').fill('正文');await page.locator('[name="excludeTags"]').fill('状态栏');await page.locator('[data-action="save-story-settings"]').click();
    await page.waitForFunction(()=>document.getElementById('mc-notice').textContent.includes('读取设置已保存'));
    await page.evaluate(()=>{window.mockContext.chat.push({name:'Alpha',mes:'<正文>浏览器自动同步</正文><状态栏>秘密状态</状态栏>'});window.mockEmit('MESSAGE_RECEIVED');});
    await page.waitForFunction(()=>document.getElementById('mc-content').textContent.includes('浏览器自动同步'));
    assert.doesNotMatch(await page.locator('#mc-content').textContent(),/秘密状态/);
    await page.locator('[data-action="annotate"]').first().click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));assert.match(await page.locator('#mc-content').textContent(),/你们留下的批注/);
    await page.locator('.mc-nav [data-tab="chat"]').click();await page.locator('#mc-draft').fill('当前进度测试');await page.locator('[data-action="send"]').click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));
    const latest=await page.evaluate(()=>window.mockRequests.at(-1));assert.match(latest.systemPrompt,/浏览器自动同步/);
    await page.locator('#mc-draft').fill('失败后重试');await page.evaluate(()=>window.failOnce=true);await page.locator('[data-action="send"]').click();await page.waitForFunction(()=>document.getElementById('mc-notice').textContent.includes('模拟网络失败'));await page.locator('[data-action="retry"]').click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));assert.equal((await page.locator('.mc-user').allTextContents()).filter(t=>t.includes('失败后重试')).length,1);
    await page.reload();await page.locator('#mc-wand-button').click();assert.match(await page.locator('.mc-messages').textContent(),/第一条私人消息/);
    await page.locator('.mc-nav [data-tab="company"]').click();await page.locator('[name="activity"]').fill('一起写东西');await page.locator('[data-action="start-company"]').click();await page.waitForFunction(()=>document.getElementById('mc-notice').textContent.includes('已开始'));
    await page.locator('[data-action="nudge"]').click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));await page.locator('.mc-nav [data-tab="chat"]').click();assert.match(await page.locator('.mc-messages').textContent(),/主动消息/);
    await page.screenshot({path:path.join(artifacts,`chat-${viewport.width}.png`),fullPage:true});
    const overflow=await page.locator('.mc-panel').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,'panel must not overflow horizontally');
    await page.locator('.mc-nav [data-tab="company"]').click();await page.locator('[data-action="stop-company"]').click();
    await page.locator('[name="scene"]').fill('便利店停电了');await page.locator('[data-action="theatre"]').click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));assert.match(await page.locator('.mc-messages').textContent(),/便利店停电了/);
    await page.locator('.mc-nav [data-tab="settings"]').click();const download=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const file=await download;await file.saveAs(path.join(artifacts,`backup-${viewport.width}.json`));
    assert.deepEqual(errors,[]);await ctx.close();console.log(`UI ${viewport.width}px: extraction, isolation, automatic story sync, annotations, retry, restart, companionship, theatre, backup passed`);
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
