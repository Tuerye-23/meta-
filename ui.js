import { NOTIFICATION_TONES, hasUnread } from './notifications.js';
import { API_PARAMETERS, apiDefaults, normalizeApi } from './api-config.js';
import { HEAD_PROMPT, AI_PROMPT } from './prompts.js';
import { contactsScreen, contactTitle } from './contacts-ui.js';
import { VERSION } from './core.js';
import { storyScreen, storyPage, storyCompanion } from './story-ui.js';
import { chatScreen, chatMessage, chatTimestamp } from './chat-ui.js';
import { avatarScreen } from './avatars.js';
import { homeScreen, momentsScreen, diaryScreen, icon, APPS } from './phone-ui.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const field = (label, name, value, rows = 3) => `<label class="mc-field"><span>${label}</span><textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
const number = (label, name, value, min, max) => `<label class="mc-field"><span>${label}</span><input type="number" name="${name}" value="${esc(value)}" min="${min}" max="${max}"></label>`;

export class Interface {
    constructor(host, action) {
        this.storyMode='reader';this.storySection='prose';this.storyPages=new Map();this.chatPage='list';this.chatTools=false;this.chatMedia='';this.contactReturn='';this.avatarTarget=null;this.avatarSerial=0;
        this.host = host; this.action = action; this.tab = 'home'; this.socialSheet=''; this.commentTarget=''; this.diaryTab='character'; this.momentPhotos=[]; this.open = false; this.previous = ''; this.drafts = new Map(); this.lastFocus = null; this.regexes=[]; this.entries=[]; this.entryBook=''; this.regexError=''; this.views=new Map(); this.viewKey=''; this.lastMarkup=''; this.desktopPosition=null;this.models=[];this.sourceDraft={cards:[],personaBook:"",personaEntries:[]};this.contactPage="list";this.editorId="";this.contactField="";this.contactSource="card";this.contactCandidates=[];this.candidateSelection=[];this.supplementDraft=[];this.pickerSelection=[];this.pickerEntries=[];this.pickerKind="";
        const root = document.createElement('div'); root.id = 'mc-root'; root.hidden = true;
        root.innerHTML = `<div class="mc-backdrop" data-action="close" data-tt-mobile-surface="backdrop"></div>
          <section class="mc-panel" role="dialog" aria-modal="true" aria-label="映间小手机" data-tt-mobile-surface="free-window">
            <div class="mc-statusbar"><time id="mc-status-time"></time><span class="mc-island" aria-hidden="true"></span><div class="mc-status-icons"><span id="mc-network" role="img" aria-label="网络状态"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg></span><span id="mc-battery" role="img" aria-label="电量示意"><svg viewBox="0 0 28 16" aria-hidden="true"><rect x="1" y="2" width="22" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><rect id="mc-battery-fill" x="3" y="4" width="16" height="8" rx="1" fill="currentColor"/><path d="M25 6v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span></div></div>
            <header class="mc-header"><button type="button" class="mc-back" data-action="back" aria-label="返回首页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4-8 8 8 8"/></svg></button><strong id="mc-app-title">映间</strong><button type="button" id="mc-chat-title" data-action="chat-settings" hidden></button><button type="button" id="mc-story-settings-button" data-action="story-settings" aria-label="读取设置" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1v4l2 2-1 3 3 2 3-1 3 1 3-2-1-3 2-2V7l-3-1-1-3H9Z"/><circle cx="12" cy="11" r="3"/></svg></button><button type="button" data-action="close" aria-label="收起小手机"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
            <div class="mc-top"><span class="mc-avatar" aria-hidden="true">映</span><label><select id="mc-profile" aria-label="选择 meta 角色"></select><span id="mc-status"></span></label><span class="mc-meta-mark">META</span></div>
            <div id="mc-notice" role="status" hidden></div><main id="mc-content"></main>
            <button type="button" class="mc-home-button" data-action="tab" data-tab="home" aria-label="返回手机首页"><span></span></button>
          </section>`;
        document.body.append(root); this.root = root; this.content = root.querySelector('#mc-content');
        root.addEventListener('click', event => {
            const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
            action(button.dataset.action, button.dataset);
        });
        root.querySelector('#mc-profile').addEventListener('change', event => action('select', { id: event.target.value }));
        root.addEventListener('change', event => {if(event.target.name==='storyFollow')action('story-follow',{on:event.target.checked});if(event.target.name==='storyMemorySource')this.storyMemoryVisibility();if(['replyStyle','proactiveEnabled'].includes(event.target.name))this.chatModeVisibility();if(['apiMode','apiProvider'].includes(event.target.name)){this.capture();this.apiVisibility();if(event.target.name==='apiProvider'){this.models=[];const list=this.content.querySelector('#mc-api-models');if(list)list.innerHTML='';}}if(event.target.name==='summaryProfile')action('select',{id:event.target.value});if(event.target.name==='memoryBook') action('memory-book',{book:event.target.value});});
        root.addEventListener('input',event=>{if(event.target.name==='contactSearch')this.filterContacts();if(event.target.name==='messageSearch')this.filterMessages();if(event.target.id==='mc-draft')this.sizeComposer();if(event.target.name==='notificationVolume')this.soundVolume();});
        root.addEventListener('error',event=>{if(event.target.matches?.('img[data-mc-avatar]'))event.target.hidden=true;},true);
        root.addEventListener('submit', event => event.preventDefault());
        this.keyHandler = event => {
            if (!this.open) return;
            if (event.key === 'Escape') { action('close'); return; }
            if (event.key === 'Tab') {
                const nodes = [...root.querySelectorAll('button:not(:disabled),select:not(:disabled),textarea:not(:disabled),input:not(:disabled)')].filter(n => n.offsetParent !== null);
                const first = nodes[0], last = nodes[nodes.length-1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
            if(event.key==='Enter' && event.target.id==='mc-draft' && !event.isComposing && event.keyCode!==229 && !event.shiftKey && !event.ctrlKey && !event.metaKey){event.preventDefault();action('chat-stage');return;}
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.id === 'mc-draft') { event.preventDefault(); action('send'); }
        };
        document.addEventListener('keydown', this.keyHandler);
        this.initStatus();this.bindDrag();this.timeTimer=setInterval(()=>this.homeClock(),1000);
    }
    bindDrag() {
        const header=this.root.querySelector('.mc-header'); const panel=this.root.querySelector('.mc-panel');
        header.addEventListener('pointerdown',event=>{
            if(window.innerWidth<=600 || !event.isPrimary || event.button!==0 || event.target.closest('button,input,select,textarea,a'))return;
            const rect=panel.getBoundingClientRect();
            this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,width:rect.width,height:rect.height,moved:false};
            header.setPointerCapture(event.pointerId);
        });
        header.addEventListener('pointermove',event=>{
            const d=this.drag; if(!d || event.pointerId!==d.id)return;
            if(!d.moved && Math.hypot(event.clientX-d.x,event.clientY-d.y)<4)return;
            d.moved=true; panel.classList.add('mc-dragging');
            this.desktopPosition={left:d.left+event.clientX-d.x,top:d.top+event.clientY-d.y,width:d.width,height:d.height};this.placePhone();
        });
        const end=()=>{this.drag=null;panel.classList.remove('mc-dragging');};
        header.addEventListener('pointerup',end);header.addEventListener('pointercancel',end);header.addEventListener('lostpointercapture',end);
        this.resizeHandler=()=>{this.drag=null;panel.classList.remove('mc-dragging');this.placePhone();};
        window.addEventListener('resize',this.resizeHandler);
    }
    placePhone() {
        const panel=this.root.querySelector('.mc-panel');
        if(window.innerWidth<=600){for(const key of ['left','top','right','bottom','width','height','margin'])panel.style[key]='';return;}
        const d=this.desktopPosition;if(!d)return;
        const width=Math.min(d.width,window.innerWidth-10),height=Math.min(d.height,window.innerHeight-10);
        d.left=Math.max(5,Math.min(d.left,window.innerWidth-width-5));d.top=Math.max(5,Math.min(d.top,window.innerHeight-height-5));
        Object.assign(panel.style,{left:d.left+'px',top:d.top+'px',right:'auto',bottom:'auto',width:width+'px',height:height+'px',margin:'0'});
    }
    snapshotView() {
        if(!this.viewKey || !this.open)return;
        const scroll=this.content.querySelector('.mc-scroll,.mc-messages'); const active=document.activeElement;
        const focused=this.content.contains(active) && active?.name ? {name:active.name,start:active.selectionStart,end:active.selectionEnd,scroll:active.scrollTop} : null;
        this.views.set(this.viewKey,{scroll:scroll?.scrollTop || 0,bottom:!scroll || scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<32,details:Object.fromEntries([...this.content.querySelectorAll('details')].map((d,i)=>[d.dataset.view || String(i),d.open])),focused});
    }
    show() { this.lastFocus = document.activeElement; this.open = true; this.root.hidden = false; this.placePhone();const view=this.views.get(this.viewKey),scroll=this.content.querySelector('.mc-scroll,.mc-messages');if(scroll && view)scroll.scrollTop=scroll.classList.contains('mc-messages') && view.bottom?scroll.scrollHeight:view.scroll; this.root.querySelector('[data-action="close"][aria-label]')?.focus(); }
    hide() { this.capture(); this.snapshotView(); this.open = false; this.root.hidden = true; this.lastFocus?.focus?.(); }
    notice(message, error = false) {
        clearTimeout(this.noticeTimer);
        const list=this.content.querySelector('.mc-messages'),follow=this.open && list && list.scrollHeight-list.clientHeight-list.scrollTop<32;
        const el=this.root.querySelector('#mc-notice');el.hidden=!message;el.textContent=message;el.classList.toggle('mc-error',error);
        if(follow)list.scrollTop=list.scrollHeight;
        if(message && !error)this.noticeTimer=setTimeout(()=>{if(!this.root.isConnected)return;el.hidden=true;},8000);
    }
    capture() {
        if (!this.previous) return;
        const values = {};
        for (const n of this.content.querySelectorAll('input[name],textarea[name],select[name]')) {
            if(n.name==='regexIds' && n.type==='checkbox'){values.regexIds ??=[];if(n.checked)values.regexIds.push(n.value);continue;}
            if(n.name==='storyFollow')continue;
            values[n.name] = n.type === 'checkbox' ? n.checked : n.multiple ? [...n.selectedOptions].map(o => o.value) : n.value;
        }

        this.drafts.set(this.previous, {...this.drafts.get(this.previous),...values});
    }
    resetOtherDraftFields(names) {for(const [key,draft] of this.drafts)if(key!==this.previous)for(const name of names)delete draft[name];}
    clearDraft(name) { const key = this.previous; const d = this.drafts.get(key) || {}; d[name] = ''; this.drafts.set(key,d); const n=[...this.content.querySelectorAll("[name]")].find(el=>el.name===name); if(n)n.value=''; }
    resetDraft(names=null) {
        if(names){this.capture();const draft=this.drafts.get(this.previous) || {};for(const name of names)delete draft[name];this.drafts.set(this.previous,draft);this.lastMarkup='';}
        else this.drafts.delete(this.previous);
        this.previous='';
    }
    apiValues() {
        const v=this.values();const api={};for(const key of Object.keys(normalizeApi()))api[key]=v['api'+key[0].toUpperCase()+key.slice(1)];return normalizeApi(api);
    }
    applyApiDefaults() {
        const api=apiDefaults(this.apiValues());
        for(const [key,value] of Object.entries(api)) {const input=this.content.querySelector(`[name="api${key[0].toUpperCase()+key.slice(1)}"]`);if(input){if(input.type==='checkbox')input.checked=value;else input.value=value;}}
        this.capture();this.apiVisibility();
    }
    apiVisibility() {
        const mode=this.content.querySelector('[name="apiMode"]')?.value;
        const fields=this.content.querySelector('[data-mc-api-fields]');if(fields)fields.hidden=mode!=='independent';
        const claude=this.content.querySelector('[name="apiProvider"]')?.value==='claude';
        for(const el of this.content.querySelectorAll('[data-mc-provider]'))el.hidden=el.dataset.mcProvider!==(claude?'claude':'openai');
        for(const [key] of API_PARAMETERS.slice(2)) {const input=this.content.querySelector(`[name="api${key[0].toUpperCase()+key.slice(1)}"]`);if(input){input.closest('label').hidden=claude;input.disabled=claude;}}
        const temperature=this.content.querySelector('[name="apiTemperature"]');if(temperature)temperature.max=claude?'1':'2';
    }
    filterContacts() {const query=(this.content.querySelector('[name="contactSearch"]')?.value || '').toLowerCase();for(const row of this.content.querySelectorAll('[data-contact-name]'))row.hidden=!row.dataset.contactName.includes(query);}
    filterMessages() {const query=(this.content.querySelector('[name="messageSearch"]')?.value || '').toLowerCase();for(const row of this.content.querySelectorAll('[data-message-search]'))row.hidden=!row.dataset.messageSearch.includes(query);}
    sizeComposer() {const el=this.content.querySelector('#mc-draft');if(el){el.style.height='44px';el.style.height=Math.max(44,Math.min(112,el.scrollHeight))+'px';}}
    chatModeVisibility() {const field=this.content.querySelector('[data-short-options]');if(field)field.hidden=this.content.querySelector('[name="replyStyle"]')?.value!=='short';const proactive=this.content.querySelector('[data-proactive-options]');if(proactive)proactive.hidden=this.content.querySelector('[name="proactiveEnabled"]')?.value!=='on';}
    streamText(profileId,content) {
        if(this.tab!=='chat' || this.chatPage!=='thread' || this.avatarTarget || this.chatProfile!==profileId)return;
        const list=this.content.querySelector('.mc-messages');if(!list)return;
        const follow=list.scrollHeight-list.clientHeight-list.scrollTop<32;
        const parts=Array.isArray(content)?content:[content];
        let bubbles=[...list.querySelectorAll('.mc-streaming')];
        while(bubbles.length>parts.length)bubbles.pop().remove();
        const createdAt=this.pendingReply?.createdAt ?? Date.now();
        if(!bubbles.length){
            list.querySelector('.mc-stream-timestamp')?.remove();
            if(parts.length){
                const hidden=this.retryHidden?.profileId===profileId?this.retryHidden.ids:new Set();
                const previous=this.renderState.threads.find(t=>t.profileId===profileId)?.messages.filter(m=>!hidden.has(m.id)).at(-1);
                const holder=document.createElement('div');holder.innerHTML=chatTimestamp({createdAt},previous);
                if(holder.firstElementChild){holder.firstElementChild.classList.add('mc-stream-timestamp');list.append(holder.firstElementChild);}
            }
        }
        for(const [index,part] of parts.entries()) {
            let bubble=bubbles[index];
            if(!bubble){list.querySelector('.mc-empty')?.remove();const holder=document.createElement('div');holder.innerHTML=chatMessage({id:'stream-'+index,role:'assistant',text:'',createdAt},this.renderState.profiles.find(p=>p.id===profileId),this.renderState);bubble=holder.firstElementChild;bubble.classList.add('mc-streaming');bubble.querySelector('[data-action="delete-message"]')?.remove();list.append(bubble);bubbles.push(bubble);}
            bubble.querySelector('.mc-message-text').textContent=part;
        }
        if(follow)list.scrollTop=list.scrollHeight;
    }
    storySettingsKey() {return `story:global:settings`; }
    storyMemoryVisibility() {const el=this.content.querySelector('[data-story-worldbook]');if(el)el.hidden=this.content.querySelector('[name="storyMemorySource"]')?.value!=='worldbook';}
    values() { this.capture(); return this.drafts.get(this.previous) || {}; }
    chatDraft(profileId) {return this.drafts.get(`chat:${profileId}:thread::`)?.draft || '';}
    render(state, busy = false, session = null) {
        this.renderState=state;
        this.capture(); this.snapshotView();
        const reader=this.tab==='story'?storyPage(this,state):null;
        const oldKey=this.viewKey; const newKey=this.tab==='story'?this.storyMode==='settings'?this.storySettingsKey(state.selected):`story:${state.selected}:${reader?.cursor.key}:${this.storySection}:${this.storySection==='prose'?reader?.floor?.index ?? 'empty':''}`:this.avatarTarget?`avatar:${this.avatarTarget.kind}:${this.avatarTarget.id}:${this.avatarSerial}`:`${this.tab}:${['home','moments','diary','settings','roles'].includes(this.tab) || this.tab==='chat' && this.chatPage==='list'?'global':state.selected}:${this.tab==='diary'?this.diaryTab:this.tab==='chat'?this.chatPage:''}:${['moments','diary'].includes(this.tab)?this.socialSheet:''}:${this.tab==='roles'?this.contactPage+':'+this.editorId+':'+this.contactField+':'+this.pickerKind:''}`; let markup='';
        const p = state.profiles.find(p => p.id === state.selected); const t = state.threads.find(t => t.profileId === p?.id);
        const select = this.root.querySelector('#mc-profile');
        select.innerHTML = state.profiles.length ? state.profiles.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('') : '<option value="">先添加一个角色</option>'; select.value = state.selected;
        this.root.querySelector('#mc-status').textContent = busy ? '对方正在输入…' : state.settings.includeStory ? '与你共看另一个世界' : '只聊属于你们的事';
        this.root.querySelector('.mc-avatar').textContent=p?.name?.slice(0,1) || '映';
        for (const b of this.root.querySelectorAll('[data-tab]')) { b.classList.toggle('mc-active', b.dataset.tab === this.tab); b.setAttribute('aria-current', b.dataset.tab === this.tab ? 'page' : 'false'); }
        this.root.querySelector('.mc-panel').dataset.screen=this.tab;
        this.root.querySelector('.mc-top').hidden=this.avatarTarget || !['story','company'].includes(this.tab) || this.tab==='story' && this.storyMode==='settings';
        this.root.querySelector('.mc-panel').dataset.storyMode=this.tab==='story'?this.storyMode:'';
        this.root.querySelector('#mc-story-settings-button').hidden=this.tab!=='story' || this.storyMode==='settings';
        if(this.tab==='story'){this.root.querySelector('.mc-top .mc-avatar').outerHTML=storyCompanion(state);}
        this.root.querySelector('.mc-back').hidden=this.tab==='home';
        this.root.querySelector('#mc-app-title').textContent=this.tab==='story' && this.storyMode==='settings'?'读取设置':this.tab==='roles'?contactTitle(this):this.tab==='home'?'映间':APPS.find(x=>x[0]===this.tab)?.[1] || '映间';
        const threadOpen=this.tab==='chat' && this.chatPage==='thread' && p && !this.avatarTarget;
        this.root.querySelector('#mc-app-title').hidden=Boolean(threadOpen) || this.tab==='home' && !this.avatarTarget;
        this.root.querySelector('#mc-chat-title').hidden=!threadOpen;
        this.root.querySelector('#mc-chat-title').textContent=p?.name || '';this.root.querySelector('#mc-chat-title').setAttribute('aria-label',`设置 ${p?.name || '联系人'}`);
        if(this.avatarTarget)this.root.querySelector('#mc-app-title').textContent='更换头像';
        this.root.querySelector('.mc-back').hidden=this.tab==='home' && !this.avatarTarget;
        this.root.querySelector('.mc-back').setAttribute('aria-label',threadOpen?'返回消息列表':'返回上一页');

        this.chatProfile=state.selected;
        const c = this.host.context(); const s = state.settings;
        const disabled = busy ? 'disabled' : '';const api=normalizeApi(s.api);
        if (this.tab === 'home') markup=homeScreen(state.threads.some(hasUnread));
        if (this.tab === 'moments') markup=momentsScreen(state,this,c.name1,busy);
        if (this.tab === 'diary') markup=diaryScreen(state,this,busy);
        if (this.tab === 'chat') markup=chatScreen(state,this,busy);
        if (this.tab === 'roles') markup=contactsScreen(state,this,c,busy);
        if (this.tab === 'story') markup = storyScreen(state,this,busy,c);
        if (this.tab === 'company') markup = `<div class="mc-scroll"><div class="mc-company-card"><span class="mc-orbit">◌</span><strong>${session ? `和 ${esc(state.profiles.find(x=>x.id===session.profileId)?.name)} 一起` : '一起挂着'}</strong><p>${session ? esc(session.activity) : '打开这个空间，各自做点事，也能随时说话。'}</p><div id="mc-clock">00:00</div></div>
          <label class="mc-field"><span>一起做什么</span><input name="activity" value="${esc(s.activity)}" placeholder="陪我写东西 / 待一会儿 / 一起听歌"></label>

          <div class="mc-toolbar"><button type="button" class="mc-primary" data-action="start-company" ${!p||busy?'disabled':''}>${session?'重新开始':'开始陪伴'}</button><button type="button" data-action="stop-company" ${session?'':'disabled'}>结束陪伴</button><button type="button" data-action="nudge" ${!p||busy?'disabled':''}>让他现在说一句</button></div>
          <p class="mc-muted">主动发消息的开关、间隔与每日上限，在联系人详情的「聊天设置」中调整。这里记录你们一起待着的时间，也可以手动让角色说句话。</p>
          <hr><h3>开一段小剧场</h3>${field('给你们一个场景','scene','',3)}<button type="button" data-action="theatre" ${!p||busy?'disabled':''}>一起演一小段</button></div>`;
        if (this.tab === 'settings') markup = `<div class="mc-scroll mc-settings">${settingStart('api','API 配置','连接模型，设定生成方式','api')}
          <label class="mc-field"><span>生成方式</span><select name="apiMode"><option value="host" ${api.mode==='host'?'selected':''}>沿用酒馆当前配置</option><option value="independent" ${api.mode==='independent'?'selected':''}>独立 API</option></select></label>
          <p class="mc-muted">人设提取、聊天、批注、陪伴和总结都使用这里选择的 API。酒馆模式沿用宿主的模型和采样参数。</p>
          <label class="mc-check"><input type="checkbox" name="apiStream" ${api.stream?'checked':''}>流式输出</label>
          <div data-mc-api-fields ${api.mode==='host'?'hidden':''}>
          <label class="mc-field"><span>API 来源</span><select name="apiProvider"><option value="openai" ${api.provider==='openai'?'selected':''}>OpenAI 兼容</option><option value="claude" ${api.provider==='claude'?'selected':''}>Claude</option></select></label>
          <p class="mc-muted" data-mc-provider="openai">使用 /chat/completions 协议；Claude 模型若由平台提供 OpenAI 兼容接口，也选此来源。地址可填到 /v1 或完整端点。</p>
          <p class="mc-muted" data-mc-provider="claude">使用 Claude 原生 /messages 协议。地址例如 https://api.anthropic.com/v1，也可填完整端点。输出上限为必填项；采样项可留空。</p>
          <label class="mc-field"><span>API 地址</span><input name="apiBaseUrl" type="url" value="${esc(api.baseUrl)}" placeholder="https://example.com/v1" autocomplete="off" spellcheck="false"></label>
          <label class="mc-field"><span>API Key（无鉴权接口可留空）</span><input name="apiApiKey" type="password" value="${esc(api.apiKey)}" autocomplete="off" spellcheck="false"></label>
          <label class="mc-field"><span>模型 ID</span><input name="apiModel" value="${esc(api.model)}" list="mc-api-models" placeholder="读取模型列表或手动填写" autocomplete="off" spellcheck="false"><datalist id="mc-api-models">${this.models.map(model=>`<option value="${esc(model)}"></option>`).join('')}</datalist></label>
          <label class="mc-field"><span>连接方式</span><select name="apiTransport"><option value="host" ${api.transport==='host'?'selected':''}>酒馆转发</option><option value="direct" ${api.transport==='direct'?'selected':''}>浏览器直连</option></select></label>
          <div class="mc-toolbar"><button type="button" data-action="api-models" ${disabled}>读取模型列表</button><button type="button" data-action="api-test" ${disabled}>测试连接</button></div>
          <details data-view="api-parameters"><summary>参数配置</summary><button type="button" data-action="api-defaults" ${disabled}>恢复默认</button><div class="mc-two">${API_PARAMETERS.map(([key,,label,min,max,integer])=>optionalInput(label,'api'+key[0].toUpperCase()+key.slice(1),api[key],min,max,integer?'1':'any')).join('')}${optionalInput('输出上限（tokens）','apiMaxTokens',api.maxTokens,1,1000000,'1')}</div><p class="mc-muted">留空不发送该参数。Claude 不发送频率与存在惩罚；温度非空时优先使用温度，清空后使用 Top P。</p></details>
          <details data-view="api-other"><summary>其他配置（可选）</summary>${optionalInput('上下文检查上限（估算 tokens，留空不检查）','apiContextLimit',api.contextLimit,1,10000000,'1')}${optionalInput('请求超时（秒，留空为 120 秒）','apiTimeout',api.timeout,1,3600,'1')}<p class="mc-muted">API Key 仅保存在当前设备，导出的聊天备份不包含密钥。</p></details></div>
          <button type="button" class="mc-primary" data-action="save-api" ${disabled}>保存 API 配置</button>${settingEnd}${settingStart('history','聊天记录设置','正文同步与聊天上下文','chat')}
          <form id="mc-settings-form"><label class="mc-check"><input type="checkbox" name="includeStory" ${s.includeStory?'checked':''}>聊天时携带主线剧情（关闭后也可以独立聊天）</label>
          <div class="mc-two">${number('最近读取的正文条数','recentFloors',s.recentFloors,1,60)}${number('最近 meta 消息条数','historyMessages',s.historyMessages,4,200)}</div>
          <button type="button" class="mc-primary" data-action="save-settings" ${disabled}>保存聊天记录设置</button></form><p class="mc-muted">标签、正则及正文剧情记忆的读取来源，在「共看」中设置。</p><button type="button" data-action="story-settings">正文读取设置</button>${settingEnd}${settingStart('notifications','消息提醒','提示音与音量','sound')}<label class="mc-field"><span>消息提示音</span><select name="notificationTone">${NOTIFICATION_TONES.map(([id,label])=>`<option value="${id}" ${s.notificationTone===id?'selected':''}>${label}</option>`).join('')}</select></label><label class="mc-field mc-volume-field"><span>提示音音量 <output id="mc-sound-volume">${Math.round(s.notificationVolume*100)}%</output></span><input name="notificationVolume" type="range" min="0" max="100" step="1" value="${Math.round(s.notificationVolume*100)}" aria-label="提示音音量"></label><div class="mc-toolbar"><button type="button" data-action="preview-sound">试听</button><button type="button" class="mc-primary" data-action="save-notifications">保存消息提醒</button></div>${settingEnd}${settingStart('summary','Meta小手机自动总结','整理你们自己的聊天记忆','summary')}
          <label class="mc-check"><input type="checkbox" name="autoSummary" ${s.autoSummary?'checked':''}>自动整理你们的聊天记忆</label><div class="mc-two">${number('积累多少条消息后总结','summaryEvery',s.summaryEvery,16,200)}${number('保留多少条近期原文','summaryKeep',s.summaryKeep,4,60)}</div><button type="button" class="mc-primary" data-action="save-summary-settings" ${disabled}>保存总结设置</button><p class="mc-muted">在 Meta 回复结束后检查条数，整理较早聊天，保留近期原文与完整记录。总结会额外调用一次当前模型。</p>
          <label class="mc-field"><span>查看哪位联系人的记忆</span><select name="summaryProfile">${state.profiles.map(p=>`<option value="${esc(p.id)}" ${p.id===state.selected?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
          ${p ? `<h3>${esc(p.name)} 的 meta 记忆</h3>${field('可手动修改，或让模型整理较早聊天','memory',t?.memory?.text,6)}<div class="mc-toolbar"><button type="button" data-action="save-memory" ${disabled}>保存记忆</button><button type="button" data-action="summarize" ${disabled}>整理聊天记忆</button></div><p class="mc-muted">整理只读取这个角色与你的 meta 聊天。完整记录保留，较早部分在发送时由摘要替代。</p>` : ''}
          ${settingEnd}${settingStart('prompts','提示词设置','头部与 AI 提示词','prompts')}<div class="mc-prompt-label"><strong>头部提示词</strong><small>系统 · 相对位置</small></div>${field('','headPrompt',s.headPrompt ?? HEAD_PROMPT,7)}<div class="mc-prompt-label"><strong>AI提示词</strong><small>模型 · 相对位置</small></div>${field('','aiPrompt',s.aiPrompt ?? AI_PROMPT,8)}<div class="mc-toolbar"><button type="button" class="mc-primary" data-action="save-prompts" ${disabled}>保存提示词</button><button type="button" data-action="reset-prompts" ${disabled}>恢复默认</button></div>${settingEnd}${settingStart('backup','备份及后台日志','保存资料，查看运行情况','backup')}<h3>备份</h3><p>资料和 meta 对话保存在当前设备。换设备时导出备份，再导入。</p><div class="mc-toolbar"><button type="button" data-action="export">导出完整备份</button><button type="button" data-action="import" ${disabled}>导入备份</button></div><h3>后台日志</h3><p class="mc-muted">保留最近 200 条运行记录。这里只记录任务与错误，不记录聊天正文及密钥。</p><div class="mc-log-list" aria-label="后台运行日志">${(state.logs || []).slice(-50).reverse().map(l=>`<article class="mc-log ${l.level==='error'?'mc-log-error':''}"><small>${esc(new Date(l.createdAt).toLocaleString('zh-CN'))} · ${l.level==='error'?'失败':'运行'}</small><span>${esc(l.message)}</span></article>`).join('') || '<p class="mc-muted">还没有运行记录</p>'}</div><div class="mc-toolbar"><button type="button" data-action="export-logs">导出日志</button><button type="button" data-action="clear-logs" ${disabled}>清空日志</button></div>${settingEnd}<p class="mc-settings-version">映间 v${VERSION}</p></div>`;
        if(this.avatarTarget)markup=avatarScreen(this,busy);
        const replaced=oldKey!==newKey || this.lastMarkup!==markup;
        if(replaced)this.content.innerHTML=markup;
        this.lastMarkup=markup;this.viewKey=newKey;
        this.previous = newKey;
        const saved = this.drafts.get(this.previous);
        if (saved) for (const n of this.content.querySelectorAll('input[name],textarea[name],select[name]')) {
            if (!(n.name in saved)) continue;
            if (n.type==='checkbox') n.checked = n.name==='regexIds'?saved[n.name].includes(n.value):saved[n.name];
            else if (n.multiple) for (const o of n.options) o.selected = saved[n.name].includes(o.value);
            else n.value = saved[n.name];
        }

        this.apiVisibility();this.storyMemoryVisibility();this.homeClock();this.filterContacts();this.filterMessages();this.sizeComposer();this.chatModeVisibility();this.soundVolume();
        if(replaced) {
            const view=this.views.get(newKey); const scroll=this.content.querySelector('.mc-scroll,.mc-messages');
            if(view)for(const [i,d] of [...this.content.querySelectorAll('details')].entries())if((d.dataset.view || String(i)) in view.details)d.open=view.details[d.dataset.view || String(i)];
            if(view?.focused && oldKey===newKey) {
                const input=[...this.content.querySelectorAll('[name]')].find(n=>n.name===view.focused.name);
                if(input && !input.disabled){input.focus({preventScroll:true});if(typeof view.focused.start==='number')input.setSelectionRange?.(view.focused.start,view.focused.end);input.scrollTop=view.focused.scroll;}
            }
            if(scroll)scroll.scrollTop=scroll.classList.contains('mc-messages') && (!view || view.bottom) ? scroll.scrollHeight : view?.scroll || 0;
        }
        if(this.pendingReply && busy)this.streamText(this.pendingReply.profileId,this.pendingReply.parts ?? this.pendingReply.text);
        this.refreshUnread(state);
    }
    refreshUnread(state) {
        const any=state.threads.some(hasUnread),current=state.threads.find(t=>t.profileId===state.selected);
        const app=this.root.querySelector('[data-tab="chat"] .mc-app-tile');
        app?.querySelector('.mc-unread-dot')?.remove();if(app && any)app.insertAdjacentHTML('beforeend','<span class="mc-unread-dot" role="status" aria-label="有未读消息"></span>');
        const back=this.root.querySelector('.mc-back');back.querySelector('.mc-unread-dot')?.remove();
        if(this.tab==='chat' && this.chatPage==='thread' && any)back.insertAdjacentHTML('beforeend','<span class="mc-unread-dot" role="status" aria-label="有未读消息"></span>');
        const list=this.content.querySelector('.mc-messages'),follow=list && list.scrollHeight-list.clientHeight-list.scrollTop<32;
        let jump=this.content.querySelector('[data-action="chat-unread"]');
        const needsJump=this.tab==='chat' && this.chatPage==='thread' && !this.avatarTarget && hasUnread(current);
        if(!needsJump){jump?.remove();return;}
        if(!jump){jump=document.createElement('button');jump.type='button';jump.className='mc-new-message';jump.dataset.action='chat-unread';jump.innerHTML='<span class="mc-unread-dot" aria-hidden="true"></span>新消息 · 跳到底部';this.content.querySelector('.mc-compose')?.before(jump);if(follow)list.scrollTop=list.scrollHeight;}
    }
    soundVolume() {const input=this.content.querySelector('[name="notificationVolume"]');const output=this.content.querySelector('#mc-sound-volume');if(input && output){output.textContent=Math.round(Number(input.value))+'%';input.style.setProperty('--mc-volume-fill',input.value+'%');}}
    initStatus() {
        this.networkHandler=()=>this.homeClock();window.addEventListener('online',this.networkHandler);window.addEventListener('offline',this.networkHandler);
        this.batteryHandler=()=>this.homeClock();
        try{Promise.resolve(navigator.getBattery?.()).then(battery=>{if(!battery || !this.root.isConnected)return;this.battery=battery;for(const event of ['levelchange','chargingchange'])battery.addEventListener(event,this.batteryHandler);this.homeClock();}).catch(()=>{});}catch{}
    }
    homeClock() {if(!this.open)return;const now=new Date();
        this.root.querySelector('#mc-status-time').textContent=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
        const network=this.root.querySelector('#mc-network');network.classList.toggle('mc-offline',navigator.onLine===false);network.setAttribute('aria-label',navigator.onLine===false?'网络已断开':'网络在线');
        if(this.battery){const level=Math.round(this.battery.level*100);const battery=this.root.querySelector('#mc-battery');battery.setAttribute('aria-label',`电量 ${level}%${this.battery.charging?'，充电中':''}`);battery.classList.toggle('mc-battery-low',level<=20);this.root.querySelector('#mc-battery-fill').setAttribute('width',String(18*this.battery.level));}
        const clock=this.content.querySelector('#mc-home-time');if(clock)clock.textContent=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});const date=this.content.querySelector('#mc-home-date');if(date)date.textContent=now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});}
    clock(milliseconds, paused = false) { const n=this.content.querySelector('#mc-clock'); if(n)n.textContent=`${Math.floor(milliseconds/60000).toString().padStart(2,'0')}:${Math.floor(milliseconds/1000%60).toString().padStart(2,'0')}${paused?' · 已暂停':''}`; }
    preview(request) {
        const dialog = document.createElement('dialog'); dialog.className='mc-preview';
        const title=document.createElement('h3');title.textContent='本次发送内容';
        const p=document.createElement('p');p.textContent=`较早消息未载入：${request.omitted} 条。其他扩展仍可能通过酒馆事件调整最终请求。`;
        const pre=document.createElement('pre');pre.textContent=request.systemPrompt+'\n\n'+request.prompt.map(m=>`[${m.role}]\n${m.content}${m.images?.length?'\n[附带 '+m.images.length+' 张图片]':''}`).join('\n\n');
        const close=document.createElement('button');close.textContent='关闭';close.addEventListener('click',()=>dialog.close());
        dialog.append(title,p,pre,close);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
    }
    destroy() { window.removeEventListener('online',this.networkHandler);window.removeEventListener('offline',this.networkHandler);for(const event of ['levelchange','chargingchange'])this.battery?.removeEventListener(event,this.batteryHandler);clearInterval(this.timeTimer); clearTimeout(this.noticeTimer); document.removeEventListener('keydown',this.keyHandler);window.removeEventListener('resize',this.resizeHandler);this.root.remove(); }
}

function booksOptions(context,selected) {return (context.getWorldInfoNames?.()||[]).map(name=>`<option value="${esc(name)}" ${name===selected?'selected':''}>${esc(name)}</option>`).join('');}

function optionalInput(label,name,value,min,max,step) {return `<label class="mc-field"><span>${label}</span><input name="${name}" type="number" value="${esc(value)}" min="${min}" max="${max}" step="${step}" placeholder="留空不发送"></label>`;}

const settingPaths={sound:'<path d="M4 9h4l5-4v14l-5-4H4V9ZM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/>',api:'<path d="M9 3v5m6-5v5M7 8h10v4a5 5 0 0 1-10 0V8Zm5 9v4"/>',chat:'<path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 9h8M8 13h5"/>',summary:'<path d="M5 5h14v14H5zM8 9h8M8 12h8M8 15h4M17 3v4M15 5h4"/>',prompts:'<path d="m4 20 4-1L20 7l-3-3L5 16l-1 4ZM14 7l3 3M3 4h6M6 1v6"/>',backup:'<path d="M4 15v5h16v-5M12 3v12m-5-5 5 5 5-5"/>'};
const settingStart=(key,label,subtitle,symbol)=>`<details class="mc-setting-group" data-view="settings-${key}" data-section="${key}"><summary><span class="mc-setting-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${settingPaths[symbol]}</svg></span><span><strong>${label}</strong><small>${subtitle}</small></span><svg class="mc-setting-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></summary><div class="mc-setting-body">`;
const settingEnd='</div></details>';
