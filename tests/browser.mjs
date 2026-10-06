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
    await page.locator('.mc-nav [data-tab="roles"]').click();
    await page.locator('#mc-profile option').filter({hasText:'Alpha'}).waitFor({state:'attached'});
    await page.waitForFunction(()=>document.querySelector('[name="name"]')?.value==='Alpha');
    assert.equal(await page.locator('#mc-profile option').count(),2);
    await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));
    assert.deepEqual(await page.evaluate(()=>window.qrCalls),['set','/meta','enable']);
    if(viewport.width>600) {
      const before=await page.locator('.mc-panel').boundingBox();const header=await page.locator('.mc-header').boundingBox();
      await page.mouse.move(header.x+80,header.y+20);await page.mouse.down();await page.mouse.move(header.x-180,header.y+45,{steps:8});await page.mouse.up();
      const after=await page.locator('.mc-panel').boundingBox();assert.ok(after.x<before.x-100,'PC phone must move');assert.ok(after.y>=5);
      await page.locator('.mc-header [data-action="close"]').click();await page.locator('#mc-wand-button').click();assert.equal((await page.locator('.mc-panel').boundingBox()).x,after.x);
      await page.setViewportSize({width:390,height:844});const mobile=await page.locator('.mc-panel').boundingBox();assert.ok(mobile.x<10 && mobile.width>370,'mobile layout must reset desktop coordinates');await page.setViewportSize(viewport);
    } else {
      const before=await page.locator('.mc-panel').boundingBox();const header=await page.locator('.mc-header').boundingBox();await page.mouse.move(header.x+50,header.y+20);await page.mouse.down();await page.mouse.move(header.x+100,header.y+60,{steps:4});await page.mouse.up();assert.deepEqual(await page.locator('.mc-panel').boundingBox(),before,'mobile phone does not drag');
    }
    await page.locator('.mc-nav [data-tab="settings"]').click();assert.equal(await page.locator('[data-action="create-qr"]').count(),0);
    const scrollState=await page.evaluate(()=>{const el=document.querySelector('.mc-scroll');el.scrollTop=300;const input=document.querySelector('[name="summaryInstruction"]');input.value='尚未保存的提示词';input.focus({preventScroll:true});input.setSelectionRange(2,5);return {top:el.scrollTop};});
    await page.evaluate(()=>{window.mockEmit('MESSAGE_EDITED');});await page.waitForTimeout(450);
    const preserved=await page.evaluate(()=>({top:document.querySelector('.mc-scroll').scrollTop,value:document.querySelector('[name="summaryInstruction"]').value,focus:document.activeElement.name,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}));
    assert.equal(preserved.top,scrollState.top,'background sync must preserve settings scroll');assert.equal(preserved.value,'尚未保存的提示词');assert.equal(preserved.focus,'summaryInstruction');assert.equal(preserved.start,2);assert.equal(preserved.end,5);
    await page.locator('.mc-nav [data-tab="story"]').click();await page.locator('details summary').first().click();await page.evaluate(()=>window.mockEmit('MESSAGE_EDITED'));await page.waitForTimeout(450);assert.equal(await page.locator('details').first().evaluate(el=>el.open),false,'expanded sections must stay unchanged');

    await page.locator('.mc-nav [data-tab="chat"]').click();await page.locator('#mc-draft').fill('第一条私人消息');
    await page.locator('[data-action="preview"]').click();await page.locator('.mc-preview').waitFor();assert.match(await page.locator('.mc-preview pre').textContent(),/第一条私人消息/);await page.locator('.mc-preview button').click();
    await page.evaluate(()=>window.mockDelay=350);await page.locator('[data-action="send"]').click();
    await page.locator('#mc-profile').selectOption({label:'Beta'});await page.waitForTimeout(500);
    assert.doesNotMatch(await page.locator('.mc-messages').textContent(),/第一条私人消息/);
    await page.locator('#mc-profile').selectOption({label:'Alpha'});assert.match(await page.locator('.mc-messages').textContent(),/第一条私人消息/);assert.match(await page.locator('.mc-messages').textContent(),/Alpha：收到/);
    await page.evaluate(()=>window.mockDelay=0);await page.locator('.mc-nav [data-tab="story"]').click();
    assert.equal(await page.locator('[name="cutoff"]').count(),0);
    if(!await page.locator('details').first().evaluate(el=>el.open))await page.locator('details summary').first().click();
    await page.locator('[name="includeTags"]').fill('正文');await page.locator('[name="excludeTags"]').fill('状态栏');await page.locator('[data-action="save-story-settings"]').click();
    await page.waitForFunction(()=>document.getElementById('mc-notice').textContent.includes('读取设置已保存'));
    await page.evaluate(()=>{window.mockContext.chat.push({name:'Alpha',mes:'<正文>浏览器自动同步</正文><状态栏>秘密状态</状态栏>'});window.mockEmit('MESSAGE_RECEIVED');});
    await page.waitForFunction(()=>document.getElementById('mc-content').textContent.includes('浏览器自动同步'));
    assert.doesNotMatch(await page.locator('#mc-content').textContent(),/秘密状态/);
    await page.locator('[data-action="annotate"]').first().click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));assert.match(await page.locator('#mc-content').textContent(),/你们留下的批注/);
    await page.locator('.mc-nav [data-tab="chat"]').click();await page.locator('#mc-draft').fill('当前进度测试');await page.locator('[data-action="send"]').click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));
    const latest=await page.evaluate(()=>window.mockRequests.at(-1));assert.match(latest.systemPrompt,/浏览器自动同步/);
    await page.locator('#mc-draft').fill('失败后重试');await page.evaluate(()=>window.failOnce=true);await page.locator('[data-action="send"]').click();await page.waitForFunction(()=>document.getElementById('mc-notice').textContent.includes('模拟网络失败'));await page.locator('[data-action="retry"]').click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));assert.equal((await page.locator('.mc-user').allTextContents()).filter(t=>t.includes('失败后重试')).length,1);
    await page.reload();await page.locator('#mc-wand-button').click();await page.waitForTimeout(350);assert.deepEqual(await page.evaluate(()=>window.qrCalls),[]);assert.equal(await page.evaluate(()=>window.mockRequests.filter(r=>r.systemPrompt.includes('人物设定整理器')).length),0);assert.match(await page.locator('.mc-messages').textContent(),/第一条私人消息/);
    await page.locator('.mc-nav [data-tab="company"]').click();await page.locator('[name="activity"]').fill('一起写东西');await page.locator('[data-action="start-company"]').click();await page.waitForFunction(()=>document.getElementById('mc-notice').textContent.includes('已开始'));
    await page.locator('[data-action="nudge"]').click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));await page.locator('.mc-nav [data-tab="chat"]').click();assert.match(await page.locator('.mc-messages').textContent(),/主动消息/);
    await page.screenshot({path:path.join(artifacts,`chat-${viewport.width}.png`),fullPage:true});
    const overflow=await page.locator('.mc-panel').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,'panel must not overflow horizontally');
    await page.locator('.mc-nav [data-tab="company"]').click();await page.locator('[data-action="stop-company"]').click();
    await page.locator('[name="scene"]').fill('便利店停电了');await page.locator('[data-action="theatre"]').click();await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));assert.match(await page.locator('.mc-messages').textContent(),/便利店停电了/);
    await page.locator('.mc-nav [data-tab="settings"]').click();const download=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const file=await download;await file.saveAs(path.join(artifacts,`backup-${viewport.width}.json`));
    assert.deepEqual(errors,[]);
    const rendering=await page.evaluate(async()=>{
      window.STMetaCompanion.destroy();const [{Interface},{createHost},{freshState,normalizeProfile,newThread,addMessage}]=await Promise.all([import('/ui.js'),import('/host.js'),import('/core.js')]);
      const state=freshState();const p=normalizeProfile({name:'滚动测试角色'});const t=newThread(p.id);state.profiles.push(p);state.threads.push(t);state.selected=p.id;
      for(let i=0;i<30;i++)addMessage(t,i%2?'assistant':'user','长消息'+i+'\n'+('正文内容\n'.repeat(15)));
      const ui=new Interface(createHost(),()=>{});ui.show();ui.tab='settings';ui.render(state);
      let scroller=ui.content.querySelector('.mc-scroll');scroller.scrollTop=350;const settingsTop=scroller.scrollTop;const editor=ui.content.querySelector('[name="summaryInstruction"]');editor.value='未保存内容';editor.focus({preventScroll:true});editor.setSelectionRange(1,3);
      ui.render(state,true);const settings={top:ui.content.querySelector('.mc-scroll').scrollTop,value:ui.values().summaryInstruction,focused:document.activeElement.name,start:document.activeElement.selectionStart};
      ui.tab='chat';ui.render(state);scroller=ui.content.querySelector('.mc-messages');scroller.scrollTop=80;const chatTop=scroller.scrollTop;addMessage(t,'assistant','后台到来的新消息');ui.render(state);const readingTop=ui.content.querySelector('.mc-messages').scrollTop;
      scroller=ui.content.querySelector('.mc-messages');scroller.scrollTop=scroller.scrollHeight;addMessage(t,'assistant','末尾新消息');ui.render(state);scroller=ui.content.querySelector('.mc-messages');const bottomGap=scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop;
      ui.destroy();return {settingsTop,settings,chatTop,readingTop,bottomGap};
    });
    assert.ok(rendering.settingsTop>0);assert.equal(rendering.settings.top,rendering.settingsTop,'DOM rebuild must preserve scroll');assert.equal(rendering.settings.value,'未保存内容');assert.equal(rendering.settings.focused,'summaryInstruction');assert.equal(rendering.settings.start,1);assert.equal(rendering.readingTop,rendering.chatTop,'new meta messages must not pull a reader down');assert.ok(rendering.bottomGap<2,'readers already at the bottom must follow new messages');
    await ctx.close();console.log(`UI ${viewport.width}px: automatic extraction / QR, preserved scroll / draft / focus / details, desktop drag, isolation, live sync, retry, restart, companionship, backup passed`);
  }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
