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
    const ctx=await browser.newContext({viewport,isMobile:viewport.width<=600,hasTouch:viewport.width<=600});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
        window.sounds=[];window.confirmedSounds=[];
        const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){
            const sound=this.dataset.mcTone && this.dataset.mcTone!=='silent'?{tone:this.dataset.mcTone,volume:this.volume}:null;
            const playback=play.call(this);if(sound){window.sounds.push(sound);Promise.resolve(playback).then(()=>window.confirmedSounds.push(sound),()=>{});}return playback;
        };
        // Exercise the media path used by native hosts without any Web Audio support.
        window.AudioContext=undefined;window.webkitAudioContext=undefined;
        const battery=new EventTarget();battery.level=.63;battery.charging=true;window.mockBattery=battery;
        Object.defineProperty(navigator,'getBattery',{value:async()=>battery,configurable:true});
    });
    const state=()=>page.evaluate(async()=>{const key='meta-companion:state:'+localStorage.getItem('meta-companion:scope');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('st-meta-companion-native',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise((resolve,reject)=>{const r=db.transaction('state','readonly').objectStore('state').get(key);r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);});});
    const idle=()=>page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));
    const app=async tab=>{await page.locator('.mc-home-button').click();await page.locator(`.mc-app[data-tab="${tab}"]`).click();};
    const count=()=>page.evaluate(()=>window.sounds.length);
    const chatSettings=async()=>{const details=page.locator('.mc-contact-chat-settings');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();};
    const font=process.env.META_FONT_FILE?(await readFile(process.env.META_FONT_FILE)).toString('base64'):'';
    const injectFont=async()=>{if(font){await page.addStyleTag({content:`@font-face{font-family:MetaTestCJK;src:url(data:font/woff2;base64,${font})}#mc-root{font-family:MetaTestCJK,system-ui!important}`});await page.evaluate(()=>document.fonts.ready);}};
    await page.goto(url);await injectFont();if(viewport.width<=600)await page.locator('#mc-wand-button').tap();else await page.locator('#mc-wand-button').click();await page.waitForFunction(()=>document.querySelectorAll('#mc-profile option').length===2);await idle();
    assert.match(await page.locator('#mc-status-time').textContent(),/^\d\d:\d\d$/);
    await page.waitForFunction(()=>document.getElementById('mc-battery').getAttribute('aria-label').includes('63%'));
    await page.evaluate(()=>{window.mockBattery.level=.15;window.mockBattery.dispatchEvent(new Event('levelchange'));});assert.match(await page.locator('#mc-battery').getAttribute('aria-label'),/15%/);assert.equal(await page.locator('.mc-battery-low').count(),1);
    const alpha=(await state()).profiles.find(p=>p.name==='Alpha');const beta=(await state()).profiles.find(p=>p.name==='Beta');
    await app('roles');await page.locator(`[data-action="contact-open"][data-id="${alpha.id}"]`).click();await page.locator('[data-action="contact-chat"]').click();
    assert.equal(await page.locator('[data-action="chat-mode-settings"]').count(),0);assert.equal(await page.locator('.mc-chat-preferences').count(),0);
    await page.evaluate(()=>window.mockDelay=550);await page.locator('#mc-draft').fill('切到首页等回复');await page.locator('[data-action="send"]').click();await page.locator('.mc-home-button').click();await idle();
    await page.waitForFunction(()=>window.sounds.length===1);assert.equal(await page.locator('[data-tab="chat"] .mc-unread-dot').count(),1);assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,1);
    await page.locator('[data-tab="chat"]').click();assert.equal(await page.locator(`[data-id="${alpha.id}"] .mc-unread-dot`).count(),1);
    await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);
    // Short replies are one notification even when five separate bubbles arrive.
    await page.locator('#mc-chat-title').click();await chatSettings();await page.locator('[name="replyStyle"]').selectOption('short');await page.locator('[name="replyRange"]').selectOption('5-10');await page.locator('[data-action="contact-mode-save"]').click();await page.locator('.mc-back').click();
    let before=await count();await page.locator('#mc-draft').fill('发一组短句');await page.locator('[data-action="send"]').click();await page.locator('.mc-home-button').click();await idle();assert.equal(await count(),before+1);
    let t=(await state()).threads.find(t=>t.profileId===alpha.id);assert.equal(t.unreadIds.length,5);assert.equal(new Set(t.messages.filter(m=>t.unreadIds.includes(m.id)).map(m=>m.replyId)).size,1);
    // Refresh keeps dots and never replays a stored sound.
    await page.reload();await injectFont();await page.locator('#mc-wand-button').click();await idle();assert.equal(await count(),0);assert.equal(await page.locator('[data-tab="chat"] .mc-unread-dot').count(),1);
    await app('chat');await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);
    // Successful regeneration is a new arrival too, including both of the reported waiting screens.
    await page.evaluate(()=>window.mockDelay=650);
    before=await count();const old=(await state()).threads.find(t=>t.profileId===alpha.id).messages.at(-1);
    await page.locator('[data-action="retry"]').click();await page.locator('.mc-home-button').click();await idle();
    assert.equal(await count(),before+1,'regeneration must sound once while waiting on the phone home');
    t=(await state()).threads.find(t=>t.profileId===alpha.id);assert.equal(t.unreadIds.length,5);assert.notEqual(t.messages.at(-1).id,old.id);
    assert.equal(await page.locator('[data-tab="chat"] .mc-unread-dot').count(),1);
    await page.screenshot({path:path.join(artifacts,`retry-home-unread-v0103-${viewport.width}.png`)});
    await page.locator('[data-tab="chat"]').click();assert.equal(await page.locator(`[data-id="${alpha.id}"] .mc-unread-dot`).count(),1);
    await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);
    before=await count();await page.locator('[data-action="retry"]').click();await page.locator('.mc-home-button').click();await page.locator('.mc-header [data-action="close"]').click();await idle();
    assert.equal(await count(),before+1,'regeneration must sound once while the phone is closed');
    assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,5);
    await page.locator('#mc-wand-button').click();await idle();assert.equal(await page.locator('[data-tab="chat"] .mc-unread-dot').count(),1);
    await page.locator('[data-tab="chat"]').click();assert.equal(await page.locator(`[data-id="${alpha.id}"] .mc-unread-dot`).count(),1);
    await page.screenshot({path:path.join(artifacts,`retry-closed-inbox-v0103-${viewport.width}.png`)});
    await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);
    // Failed regeneration produces no arrival and restores the old group without a false reminder.
    before=await count();const priorGroup=(await state()).threads.find(t=>t.profileId===alpha.id).messages.at(-1).replyId;
    await page.evaluate(()=>window.failOnce=true);await page.locator('[data-action="retry"]').click();await page.locator('.mc-home-button').click();await idle();
    assert.equal(await count(),before);assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);assert.equal(await page.locator('[data-tab="chat"] .mc-unread-dot').count(),0);
    assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).messages.at(-1).replyId,priorGroup);
    await app('chat');await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();
    // A response while the phone is closed is still unread when reopened.
    await page.evaluate(()=>window.mockDelay=550);await page.locator('#mc-draft').fill('收起手机等回复');await page.locator('[data-action="send"]').click();await page.locator('.mc-header [data-action="close"]').click();await idle();assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,5);
    await page.locator('#mc-wand-button').click();await idle();assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);
    // Notification settings preview unsaved values, save only their own fields, and honor silent mode.
    await app('settings');await page.locator('[data-section="notifications"]>summary').click();await page.locator('[name="notificationTone"]').selectOption('bell');
    await page.locator('[name="notificationVolume"]').evaluate(el=>{el.value='23';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('#mc-sound-volume').textContent(),'23%');
    before=await count();await page.locator('[data-action="preview-sound"]').click();await page.waitForFunction(n=>window.sounds.length===n,before+1);
    assert.deepEqual(await page.evaluate(()=>window.sounds.at(-1)),{tone:'bell',volume:.23});
    await page.locator('[data-section="prompts"]>summary').click();await page.locator('[name="headPrompt"]').fill('提示词草稿不要清掉');await page.locator('[data-action="save-notifications"]').click();assert.equal(await page.locator('[name="headPrompt"]').inputValue(),'提示词草稿不要清掉');
    assert.equal((await state()).settings.notificationVolume,.23);assert.equal((await state()).settings.notificationTone,'bell');
    await page.screenshot({path:path.join(artifacts,`notification-settings-v090-${viewport.width}.png`)});
    await page.locator('[name="notificationTone"]').selectOption('none');await page.locator('[data-action="save-notifications"]').click();
    await app('chat');await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();before=await count();await page.locator('#mc-draft').fill('静音消息');await page.locator('[data-action="send"]').click();await idle();assert.equal(await count(),before);
    assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);
    await page.screenshot({path:path.join(artifacts,`chat-v090-${viewport.width}.png`)});assert.equal(await page.locator('.mc-panel').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    // Reading older history keeps the badge through refresh and inbox navigation until the latest reply is read.
    await page.locator('#mc-draft').fill(Array.from({length:70},(_,i)=>'此前消息第'+i+'行').join('\n'));await page.locator('[data-action="send"]').click();
    await page.locator('.mc-messages').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});await idle();
    assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,5);
    assert.equal(await page.locator('[data-action="chat-unread"]').isVisible(),true);
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await idle();
    assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,5,'rendering alone must not clear unread');
    await page.screenshot({path:path.join(artifacts,`unread-while-reading-v0101-${viewport.width}.png`)});
    await page.locator('.mc-back').click();assert.equal(await page.locator(`[data-id="${alpha.id}"] .mc-unread-dot`).count(),1);
    await page.locator(`[data-action="chat-open"][data-id="${alpha.id}"]`).click();assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,5);
    await page.locator('[data-action="chat-unread"]').click();assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);assert.equal(await page.locator('[data-action="chat-unread"]').count(),0);
    // A background document cannot mark an arriving reply read until foregrounded.
    await page.locator('#mc-draft').fill('页面在后台');await page.locator('[data-action="send"]').click();
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await idle();
    assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,5);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>!document.getElementById('mc-status').textContent.includes('正在输入'));assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,0);
    // Switch contacts while waiting: only the sender gets unread; current conversation remains isolated.
    await page.locator('#mc-draft').fill('Alpha待收消息');await page.locator('[data-action="send"]').click();await app('roles');await page.locator(`[data-action="contact-open"][data-id="${beta.id}"]`).click();await page.locator('[data-action="contact-chat"]').click();await idle();
    assert.equal((await state()).threads.find(t=>t.profileId===alpha.id).unreadIds.length,5);assert.equal((await state()).threads.find(t=>t.profileId===beta.id).unreadIds.length,0);assert.equal(await page.locator('.mc-back .mc-unread-dot').count(),1);
    await page.locator('.mc-back').click();assert.equal(await page.locator(`[data-id="${alpha.id}"] .mc-unread-dot`).count(),1);await page.screenshot({path:path.join(artifacts,`unread-inbox-v090-${viewport.width}.png`)});
    await page.waitForFunction(()=>window.confirmedSounds.length===window.sounds.length);assert.deepEqual(await page.evaluate(()=>window.confirmedSounds),await page.evaluate(()=>window.sounds));
    assert.deepEqual(errors,[]);await ctx.close();console.log(`Notifications ${viewport.width}px: real HTML Audio without Web Audio / volume / mute / short-group / successful retry at home and closed phone / failure without reminder / unread and restart / close and cross-contact / status bar passed`);
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
