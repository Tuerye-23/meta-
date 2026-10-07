import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '']}));
const base=path.resolve(import.meta.dirname,'..'),artifacts=path.resolve(base,'..','.test-output');await mkdir(artifacts,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=path.resolve(base,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/tests/fixture.html`;
const browser=await chromium.launch({headless:true,...(process.env.META_CHROMIUM_PATH?{executablePath:process.env.META_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try {
 for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:320,height:650}]) {
    const ctx=await browser.newContext({viewport,timezoneId:'Asia/Shanghai'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Page error',e.message);});
    await page.addInitScript(()=>{
        const RealDate=Date;window.metaNow=Number(localStorage.getItem('meta-test-now')) || new RealDate('2026-10-08T10:00:00+08:00').getTime();
        window.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[window.metaNow]));}static now(){return window.metaNow;}};
        window.sounds=[];const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this.dataset.mcTone && this.dataset.mcTone!=='silent')window.sounds.push({tone:this.dataset.mcTone,volume:this.volume});return play.call(this);};
    });
    const state=()=>page.evaluate(async()=>{const key='meta-companion:state:'+localStorage.getItem('meta-companion:scope');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('st-meta-companion-native',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise((resolve,reject)=>{const r=db.transaction('state','readonly').objectStore('state').get(key);r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);});});
    const idle=()=>page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));
    const advance=async ms=>{await page.evaluate(ms=>{window.metaNow+=ms;localStorage.setItem('meta-test-now',String(window.metaNow));document.dispatchEvent(new Event('visibilitychange'));},ms);await idle();};
    const requests=()=>page.evaluate(()=>window.mockRequests.filter(r=>r.prompt.some(m=>m.content.startsWith('<主动消息>'))).length);
    const now=()=>page.evaluate(()=>Date.now());
    const app=async tab=>{await page.locator('.mc-home-button').click();await page.locator(`.mc-app[data-tab="${tab}"]`).click();};
    const settings=async id=>{await app('roles');await page.locator(`[data-action="contact-open"][data-id="${id}"]`).click();const details=page.locator('.mc-contact-chat-settings');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();};
    const saved=async()=>{await page.locator('[data-action="contact-mode-save"]').click();try{await page.waitForFunction(()=>document.getElementById('mc-notice').textContent.includes('聊天设置已保存'));}catch(e){console.error('Save status',await page.locator('#mc-notice').textContent(),await page.locator('#mc-status').textContent());await page.screenshot({path:path.join(artifacts,'proactive-save-failure.png')});throw e;}};
    const thread=async id=>(await state()).threads.find(t=>t.profileId===id);
    const count=async(id,day)=>(await thread(id)).proactive.counts[day] || 0;
    const received=async(id,day,n)=>{await page.waitForFunction(async({id,day,n})=>{const key='meta-companion:state:'+localStorage.getItem('meta-companion:scope');const db=await new Promise(resolve=>{const r=indexedDB.open('st-meta-companion-native',1);r.onsuccess=()=>resolve(r.result);});const state=await new Promise(resolve=>{const r=db.transaction('state','readonly').objectStore('state').get(key);r.onsuccess=()=>resolve(r.result);});db.close();return state?.threads.find(t=>t.profileId===id)?.proactive.counts[day]===n;},{id,day,n});await idle();};
    const font=process.env.META_FONT_FILE?(await readFile(process.env.META_FONT_FILE)).toString('base64'):'';
    const injectFont=async()=>{if(font){await page.addStyleTag({content:`@font-face{font-family:MetaTestCJK;src:url(data:font/woff2;base64,${font})}#mc-root{font-family:MetaTestCJK,system-ui!important}`});await page.evaluate(()=>document.fonts.ready);}};
    await page.goto(url);await injectFont();await page.locator('#mc-wand-button').click();await page.waitForFunction(()=>document.querySelectorAll('#mc-profile option').length===2);await idle();
    const alpha=(await state()).profiles.find(p=>p.name==='Alpha'),beta=(await state()).profiles.find(p=>p.name==='Beta');
    await settings(alpha.id);assert.equal(await page.locator('.mc-contact-chat-settings summary>span').first().textContent(),'聊天设置');
    assert.equal(await page.locator('[name="proactiveEnabled"]').inputValue(),'off');assert.equal(await page.locator('[data-proactive-options]').isVisible(),false);
    await page.screenshot({path:path.join(artifacts,`chat-settings-off-v0100-${viewport.width}.png`)});
    await page.locator('[name="replyStyle"]').selectOption('short');await page.locator('[name="proactiveEnabled"]').selectOption('on');assert.equal(await page.locator('[data-proactive-options]').isVisible(),true);
    await page.locator('[name="proactiveHours"]').fill('0.5');await page.locator('[name="proactiveDaily"]').fill('2');await saved();
    assert.equal((await thread(alpha.id)).proactive.nextAt,await now()+1800000);assert.equal((await state()).profiles.find(p=>p.id===beta.id).proactiveEnabled,false);
    assert.equal(await page.locator('.mc-contact-chat-settings').evaluate(el=>el.open),true);
    await page.screenshot({path:path.join(artifacts,`chat-settings-on-v0100-${viewport.width}.png`)});assert.equal(await page.locator('.mc-panel').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    // The phone may be closed and the document hidden; the sender does not replace the current contact.
    await settings(beta.id);await page.locator('[data-action="contact-chat"]').click();await page.locator('#mc-draft').fill('Beta的草稿别动');await page.locator('.mc-header [data-action="close"]').click();
    await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true}));await advance(1800000-1);assert.equal(await requests(),0);await advance(1);await received(alpha.id,'2026-10-08',1);
    let t=await thread(alpha.id);assert.equal(t.messages.length,4);assert.equal(new Set(t.messages.map(m=>m.replyId)).size,1);assert.equal(t.unreadIds.length,4);
    await page.waitForFunction(()=>window.sounds.length===1);assert.equal((await state()).selected,beta.id);
    const request=await page.evaluate(()=>window.mockRequests.at(-1));assert.equal(request.prompt.at(-1).role,'user');assert.match(request.prompt.at(-1).content,/主动联系/);assert.match(request.prompt.find(m=>m.content.startsWith('<主动消息>')).content,/Alpha 主动向 测试用户/);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.locator('#mc-wand-button').click();await idle();assert.equal(await page.locator('#mc-draft').inputValue(),'Beta的草稿别动');assert.equal(await page.locator('.mc-chat-message').count(),0);assert.equal(await page.locator('.mc-back .mc-unread-dot').count(),1);
    await app('chat');assert.equal(await page.locator(`[data-id="${alpha.id}"] .mc-unread-dot`).count(),1);
    // Reload retains the precise deadline; several missed intervals make only one request, then quota stops it.
    const deadline=t.proactive.nextAt;await page.reload();await injectFont();await page.locator('#mc-wand-button').click();await idle();assert.equal((await thread(alpha.id)).proactive.nextAt,deadline);assert.equal(await requests(),0);
    await advance(3*3600000);await received(alpha.id,'2026-10-08',2);assert.equal(await requests(),1);assert.equal((await thread(alpha.id)).messages.length,8);
    await advance(3600000);assert.equal(await requests(),1);assert.equal(await count(alpha.id,'2026-10-08'),2);
    await advance(24*3600000);await received(alpha.id,'2026-10-09',1);assert.equal(await requests(),2);
    // Saving a new mode or limit retains today's usage; off/on re-arms time without clearing quota.
    await settings(alpha.id);await page.locator('[name="replyStyle"]').selectOption('long');await page.locator('[name="proactiveEnabled"]').selectOption('off');await saved();assert.equal((await thread(alpha.id)).proactive.nextAt,0);
    await advance(4*3600000);assert.equal(await requests(),2);await page.locator('[name="proactiveEnabled"]').selectOption('on');await page.locator('[name="proactiveHours"]').fill('2');await page.locator('[name="proactiveDaily"]').fill('1');await saved();
    assert.equal((await thread(alpha.id)).proactive.nextAt,await now()+2*3600000);assert.equal(await count(alpha.id,'2026-10-09'),1);await advance(2*3600000);assert.equal(await requests(),2);
    await page.locator('[name="proactiveDaily"]').fill('2');await saved();
    // Failure consumes no daily use, retries after five minutes, and long mode receives one bubble.
    await page.evaluate(()=>window.failOnce=true);await advance(24*3600000);await page.waitForFunction(()=>document.getElementById('mc-notice').textContent.includes('主动消息未完成'));await idle();
    assert.equal(await count(alpha.id,'2026-10-10'),0);assert.equal(await requests(),3);assert.equal((await thread(alpha.id)).proactive.retryAt,await now()+5*60000);
    await advance(5*60000-1);assert.equal(await requests(),3);await advance(1);await received(alpha.id,'2026-10-10',1);assert.equal(await requests(),4);
    const latest=(await thread(alpha.id)).messages.at(-1);assert.equal(latest.replyId,undefined);assert.equal(latest.kind,'proactive');assert.equal((await state()).profiles.find(p=>p.id===alpha.id).replyStyle,'long');
    assert.deepEqual(errors,[]);await ctx.close();console.log(`Proactive ${viewport.width}px: accordion and frequency / real time and local-day quota / closed and background phone / independent recipient and draft / short group and sound / reload and missed slots / off-on / failure backoff / approved prompt passed`);
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
