import { VERSION } from './core.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const field = (label, name, value, rows = 3) => `<label class="mc-field"><span>${label}</span><textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
const number = (label, name, value, min, max) => `<label class="mc-field"><span>${label}</span><input type="number" name="${name}" value="${esc(value)}" min="${min}" max="${max}"></label>`;

export class Interface {
    constructor(host, action) {
        this.host = host; this.action = action; this.tab = 'chat'; this.open = false; this.previous = ''; this.drafts = new Map(); this.lastFocus = null; this.regexes=[]; this.entries=[]; this.entryBook=''; this.regexError=''; this.views=new Map(); this.viewKey=''; this.lastMarkup=''; this.desktopPosition=null;
        const root = document.createElement('div'); root.id = 'mc-root'; root.hidden = true;
        root.innerHTML = `<div class="mc-backdrop" data-action="close" data-tt-mobile-surface="backdrop"></div>
          <section class="mc-panel" role="dialog" aria-modal="true" aria-label="映间小手机" data-tt-mobile-surface="free-window">
            <header class="mc-header"><strong>映间</strong><span class="mc-island" aria-hidden="true"></span><button type="button" data-action="close" aria-label="收起小手机">×</button></header>
            <div class="mc-top"><span class="mc-avatar" aria-hidden="true">映</span><label><select id="mc-profile" aria-label="选择 meta 角色"></select><span id="mc-status"></span></label><span class="mc-meta-mark">META</span></div>
            <div id="mc-notice" role="status" hidden></div><main id="mc-content"></main>
            <nav class="mc-nav" aria-label="映间功能">${[['chat','消息','fa-comment-dots'],['roles','联系人','fa-user-group'],['story','共看','fa-clapperboard'],['company','陪伴','fa-moon'],['settings','设置','fa-sliders']].map(([id,label,icon]) => `<button type="button" data-action="tab" data-tab="${id}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join('')}</nav><div class="mc-home-bar" aria-hidden="true"></div>
          </section>`;
        document.body.append(root); this.root = root; this.content = root.querySelector('#mc-content');
        root.addEventListener('click', event => {
            const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
            action(button.dataset.action, button.dataset);
        });
        root.querySelector('#mc-profile').addEventListener('change', event => action('select', { id: event.target.value }));
        root.addEventListener('change', event => {if(event.target.name==='memoryBook') action('memory-book',{book:event.target.value});});
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
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.id === 'mc-draft') { event.preventDefault(); action('send'); }
        };
        document.addEventListener('keydown', this.keyHandler);
        this.bindDrag();
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
        if(!this.viewKey)return;
        const scroll=this.content.querySelector('.mc-scroll,.mc-messages'); const active=document.activeElement;
        const focused=this.content.contains(active) && active?.name ? {name:active.name,start:active.selectionStart,end:active.selectionEnd,scroll:active.scrollTop} : null;
        this.views.set(this.viewKey,{scroll:scroll?.scrollTop || 0,bottom:!scroll || scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<32,details:[...this.content.querySelectorAll('details')].map(d=>d.open),focused});
    }
    show() { this.lastFocus = document.activeElement; this.open = true; this.root.hidden = false; this.placePhone(); this.root.querySelector('[data-action="close"][aria-label]')?.focus(); }
    hide() { this.capture(); this.snapshotView(); this.open = false; this.root.hidden = true; this.lastFocus?.focus?.(); }
    notice(message, error = false) { const el = this.root.querySelector('#mc-notice'); el.hidden = !message; el.textContent = message; el.classList.toggle('mc-error', error); }
    capture() {
        if (!this.previous) return;
        const values = {};
        for (const n of this.content.querySelectorAll('input[name],textarea[name],select[name]')) {
            values[n.name] = n.type === 'checkbox' ? n.checked : n.multiple ? [...n.selectedOptions].map(o => o.value) : n.value;
        }
        this.drafts.set(this.previous, values);
    }
    clearDraft(name) { const key = this.previous; const d = this.drafts.get(key) || {}; d[name] = ''; this.drafts.set(key,d); const n=this.content.querySelector(`[name="${name}"]`); if(n)n.value=''; }
    resetDraft() { this.drafts.delete(this.previous); this.previous = ''; }
    values() { this.capture(); return this.drafts.get(this.previous) || {}; }
    render(state, busy = false, session = null) {
        this.capture(); this.snapshotView();
        const oldKey=this.viewKey; const newKey=`${this.tab}:${state.selected}`; let markup='';
        const p = state.profiles.find(p => p.id === state.selected); const t = state.threads.find(t => t.profileId === p?.id);
        const select = this.root.querySelector('#mc-profile');
        select.innerHTML = state.profiles.length ? state.profiles.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('') : '<option value="">先添加一个角色</option>'; select.value = state.selected;
        this.root.querySelector('#mc-status').textContent = busy ? '对方正在输入…' : state.settings.includeStory ? '与你共看另一个世界' : '只聊属于你们的事';
        this.root.querySelector('.mc-avatar').textContent=p?.name?.slice(0,1) || '映';
        for (const b of this.root.querySelectorAll('[data-tab]')) { b.classList.toggle('mc-active', b.dataset.tab === this.tab); b.setAttribute('aria-current', b.dataset.tab === this.tab ? 'page' : 'false'); }
        const c = this.host.context(); const s = state.settings;
        const disabled = busy ? 'disabled' : '';
        if (this.tab === 'chat') markup = p ? `
            <div class="mc-chat-meta"><span>${s.includeStory ? '主线自动同步 · '+esc(t?.story?.label || '等待正文') : '独立 Meta 对话'}</span><button type="button" data-action="preview" aria-label="查看本次发送内容">发送预览</button></div>
            <div class="mc-messages" aria-live="polite">${(t?.messages || []).slice(-200).map(m => `<article class="mc-message mc-${m.role}"><header><strong>${esc(m.role === 'user' ? p.userName || '你' : m.role === 'note' ? '记录' : p.name)}</strong><small>${esc(m.kind === 'proactive' ? '主动消息' : m.kind === 'theatre' ? '小剧场' : '')} ${new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small><button type="button" data-action="delete-message" data-id="${esc(m.id)}" aria-label="删除这条消息">×</button></header><div>${esc(m.text)}</div></article>`).join('') || `<div class="mc-empty"><span class="mc-orbit">◌</span><strong>和 ${esc(p.name)} 聊几句</strong><p>可以一起看故事，也可以从今天过得怎么样聊起。<br>关系沿用角色设定。</p></div>`}</div>
            <form class="mc-compose"><textarea id="mc-draft" name="draft" rows="3" placeholder="想和 ${esc(p.name)} 说什么？" aria-label="消息内容"></textarea><div><small>Ctrl / ⌘ + Enter 发送</small><button type="button" data-action="retry" ${disabled}>重试回复</button><button type="button" class="mc-primary" data-action="send" ${disabled}>发送</button></div></form>` : `<div class="mc-empty"><span class="mc-orbit">◌</span><strong>先认识一个人</strong><p>选择角色卡、世界书，或者手动写一份角色资料。</p><button type="button" class="mc-primary" data-action="tab" data-tab="roles">添加角色</button></div>`;
        if (this.tab === 'roles') {
            const cards = c.characters || []; const books = c.getWorldInfoNames?.() || [];
            markup = `<div class="mc-scroll"><details class="mc-source-box" ${p ? '' : 'open'}><summary>从角色卡 / 世界书提取</summary><p>可多选。多人卡会整理出多位角色，提取后可以修改。每批素材会分段调用当前模型。</p>
              <div class="mc-two"><label class="mc-field"><span>角色卡（可多选）</span><select name="cards" multiple size="5">${cards.map((card,i) => `<option value="${i}" ${i===Number(c.characterId)?'selected':''}>${esc(card.name || card.data?.name || '未命名')}</option>`).join('')}</select></label>
              <label class="mc-field"><span>世界书（可多选）</span><select name="books" multiple size="5">${books.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label></div>
              <label class="mc-check"><input type="checkbox" name="includeDisabled">包含已关闭的世界书条目</label><button type="button" class="mc-primary" data-action="extract" ${disabled}>提取人物</button></details>
              <div class="mc-toolbar"><button type="button" data-action="add-profile" ${disabled}>＋ 手动添加</button>${p ? `<button type="button" data-action="delete-profile" ${disabled}>删除当前角色</button>` : ''}</div>
              ${p ? `<form id="mc-profile-form"><div class="mc-two"><label class="mc-field"><span>角色姓名</span><input name="name" value="${esc(p.name)}"></label><label class="mc-field"><span>你的称呼 / user 名称</span><input name="userName" value="${esc(p.userName)}"></label></div>
              ${field('身份与外貌','description',p.description)}${field('性格','personality',p.personality)}${field('说话习惯 / 示例','speech',p.speech)}${field('原设定里的关系','relationship',p.relationship)}${field('世界设定','world',p.world)}${field('你的设定','userPersona',p.userPersona)}${field('Meta 补充设定','notes',p.notes)}
              <p class="mc-muted">来源：${esc(p.sources?.join('；') || '手动资料')}</p><button type="button" class="mc-primary" data-action="save-profile" ${disabled}>保存角色资料</button></form>${p.sourceText ? `<details><summary>查看提取素材原文</summary><pre>${esc(p.sourceText)}</pre></details>` : ''}` : ''}</div>`;
        }
        if (this.tab === 'story') markup = `<div class="mc-scroll"><div class="mc-section-title"><span>共同观看</span><small>自动跟随最新正文</small></div><p class="mc-muted">${esc(t?.story?.label || '等待当前主线出现正文')}</p>
          <details open><summary>正文读取范围</summary><p>只读所选标签，或排除不想读的内容。正文标签和正则筛选作用于角色回复，用户消息保留。</p>
          ${field('只提取这些标签（留空读取全部）','includeTags',s.includeTags,2)}${field('不读取这些标签','excludeTags',s.excludeTags,2)}
          <p class="mc-muted">填写标签名即可，例如 正文、状态栏；多个标签用逗号或换行分开。正则和标签同时填写时，先提取正则匹配，再筛选标签。</p>
          <div class="mc-toolbar"><button type="button" data-action="refresh-regex" ${disabled}>同步已启用正则</button></div>${this.regexError?`<p class="mc-muted">${esc(this.regexError)}</p>`:''}
          <label class="mc-field"><span>选择正文正则（可多选，不运行替换 HTML）</span><select name="regexIds" multiple size="4">${this.regexes.map(r=>`<option value="${esc(r.id)}" ${(s.regexIds||[]).includes(r.id)?'selected':''}>${esc(r.scriptName||r.id)}</option>`).join('')}${(s.regexIds||[]).filter(id=>!this.regexes.some(r=>r.id===id)).map(id=>`<option value="${esc(id)}" selected>待刷新 / 已停用：${esc(id)}</option>`).join('')}</select></label>
          ${number('读取捕获组（1 为 $1，0 为完整匹配）','regexCapture',s.regexCapture,0,20)}<p class="mc-muted">不选正则就使用标签设置；正则未匹配的角色回复不读入。</p></details>
          <details open><summary>正文剧情记忆</summary><label class="mc-field"><span>记忆来源（二选一）</span><select name="storyMemorySource"><option value="baibai" ${s.storyMemorySource!=='worldbook'?'selected':''}>柏宝书接口</option><option value="worldbook" ${s.storyMemorySource==='worldbook'?'selected':''}>世界书指定条目</option></select></label>
          <label class="mc-field"><span>世界书</span><select name="memoryBook"><option value="">请选择</option>${booksOptions(c,s.memoryBook)}</select></label>
          <label class="mc-field"><span>记忆条目</span><select name="memoryEntry"><option value="">请选择条目</option>${this.entries.map(e=>`<option value="${esc(e.id)}" ${s.memoryEntry===e.id?'selected':''}>${esc(e.name)}${e.disabled?'（世界书中已关闭）':''}</option>`).join('')}</select></label><p class="mc-muted">世界书模式直接读取所选条目；柏宝书模式读取摘要及状态。最近正文仍会自动更新。</p></details>
          <button type="button" class="mc-primary" data-action="save-story-settings" ${disabled}>保存读取设置</button>
          ${(t?.story?.warnings||[]).length?`<p class="mc-muted">${esc(t.story.warnings.join('；'))}</p>`:''}<hr><div class="mc-section-title"><span>正在看的片段</span></div>
          ${(t?.story?.floors || []).map(f => `<article class="mc-floor"><header>第 ${f.index+1} 条 · ${esc(f.name)}<button type="button" data-action="annotate" data-index="${f.index}" ${disabled}>请 ${esc(p?.name)} 批注</button></header><div>${esc(f.body)}</div></article>`).join('')}
          ${t?.story ? `<details><summary>完整读取内容</summary><pre>${esc(t.story.text)}</pre></details>` : ''}
          ${t?.annotations?.length ? `<h3>你们留下的批注</h3>${t.annotations.map(a => `<article class="mc-floor"><blockquote>${esc(a.quote)}</blockquote><div>${esc(a.reply)}</div><small>${esc(a.label)}</small></article>`).join('')}` : ''}</div>`;
        if (this.tab === 'company') markup = `<div class="mc-scroll"><div class="mc-company-card"><span class="mc-orbit">◌</span><strong>${session ? `和 ${esc(state.profiles.find(x=>x.id===session.profileId)?.name)} 一起` : '一起挂着'}</strong><p>${session ? esc(session.activity) : '打开这个空间，各自做点事，也能随时说话。'}</p><div id="mc-clock">00:00</div></div>
          <label class="mc-field"><span>一起做什么</span><input name="activity" value="${esc(s.activity)}" placeholder="陪我写东西 / 待一会儿 / 一起听歌"></label>
          <div class="mc-two">${number('主动搭话间隔（分钟）','intervalMinutes',s.intervalMinutes,2,120)}${number('本次最多主动发几条','maxProactive',s.maxProactive,1,20)}</div>
          <div class="mc-toolbar"><button type="button" class="mc-primary" data-action="start-company" ${!p||busy?'disabled':''}>${session?'重新开始':'开始陪伴'}</button><button type="button" data-action="stop-company" ${session?'':'disabled'}>结束陪伴</button><button type="button" data-action="nudge" ${!p||busy?'disabled':''}>让他现在说一句</button></div>
          <p class="mc-muted">主动搭话仅在映间打开且应用在前台时运行。计时无需调用模型，生成消息会使用当前 API；关闭面板时暂停，重新打开后继续计时。重启后需重新开始陪伴。</p>
          <hr><h3>开一段小剧场</h3>${field('给你们一个场景','scene','',3)}<button type="button" data-action="theatre" ${!p||busy?'disabled':''}>一起演一小段</button></div>`;
        if (this.tab === 'settings') markup = `<div class="mc-scroll"><form id="mc-settings-form"><label class="mc-check"><input type="checkbox" name="includeStory" ${s.includeStory?'checked':''}>聊天时携带主线剧情（关闭后也可以独立聊天）</label>
          <div class="mc-two">${number('最近读取的正文条数','recentFloors',s.recentFloors,1,60)}${number('剧情发送上限（字符）','storyLimit',s.storyLimit,1000,60000)}${number('单次回复上限（tokens）','replyTokens',s.replyTokens,128,4096)}${number('最近 meta 消息条数','historyMessages',s.historyMessages,4,200)}</div>
          ${field('Meta 回复要求（可选）','customInstruction',s.customInstruction,4)}<button type="button" class="mc-primary" data-action="save-settings" ${disabled}>保存设置</button></form><hr>
          <h3>Meta 自动总结</h3><label class="mc-check"><input type="checkbox" name="autoSummary" ${s.autoSummary?'checked':''}>自动整理你们的聊天记忆</label><div class="mc-two">${number('积累多少条消息后总结','summaryEvery',s.summaryEvery,16,200)}${number('保留多少条近期原文','summaryKeep',s.summaryKeep,4,60)}</div>${field('总结提示词（留空使用内置提示词）','summaryInstruction',s.summaryInstruction,5)}<button type="button" class="mc-primary" data-action="save-summary-settings" ${disabled}>保存总结设置</button><p class="mc-muted">在 Meta 回复结束后检查条数，整理较早聊天，保留近期原文与完整记录。总结会额外调用一次当前模型。</p><hr>
          ${p ? `<h3>${esc(p.name)} 的 meta 记忆</h3>${field('可手动修改，或让模型整理较早聊天','memory',t?.memory?.text,6)}<div class="mc-toolbar"><button type="button" data-action="save-memory" ${disabled}>保存记忆</button><button type="button" data-action="summarize" ${disabled}>整理聊天记忆</button></div><p class="mc-muted">整理只读取这个角色与你的 meta 聊天。完整记录保留，较早部分在发送时由摘要替代。</p><hr>` : ''}
          <h3>备份</h3><p>资料和 meta 对话保存在当前设备。换设备时导出备份，再导入。</p><div class="mc-toolbar"><button type="button" data-action="export">导出完整备份</button><button type="button" data-action="import" ${disabled}>导入备份</button></div><p class="mc-muted">映间 v${VERSION}</p></div>`;
        const replaced=oldKey!==newKey || this.lastMarkup!==markup;
        if(replaced)this.content.innerHTML=markup;
        this.lastMarkup=markup;this.viewKey=newKey;
        this.previous = newKey;
        const saved = this.drafts.get(this.previous);
        if (saved) for (const n of this.content.querySelectorAll('input[name],textarea[name],select[name]')) {
            if (!(n.name in saved)) continue;
            if (n.type==='checkbox') n.checked = saved[n.name];
            else if (n.multiple) for (const o of n.options) o.selected = saved[n.name].includes(o.value);
            else n.value = saved[n.name];
        }
        if(replaced) {
            const view=this.views.get(newKey); const scroll=this.content.querySelector('.mc-scroll,.mc-messages');
            if(view)for(const [i,d] of [...this.content.querySelectorAll('details')].entries())if(i<view.details.length)d.open=view.details[i];
            if(view?.focused && oldKey===newKey) {
                const input=[...this.content.querySelectorAll('[name]')].find(n=>n.name===view.focused.name);
                if(input && !input.disabled){input.focus({preventScroll:true});if(typeof view.focused.start==='number')input.setSelectionRange?.(view.focused.start,view.focused.end);input.scrollTop=view.focused.scroll;}
            }
            if(scroll)scroll.scrollTop=scroll.classList.contains('mc-messages') && (!view || view.bottom) ? scroll.scrollHeight : view?.scroll || 0;
        }
    }
    clock(milliseconds, paused = false) { const n=this.content.querySelector('#mc-clock'); if(n)n.textContent=`${Math.floor(milliseconds/60000).toString().padStart(2,'0')}:${Math.floor(milliseconds/1000%60).toString().padStart(2,'0')}${paused?' · 已暂停':''}`; }
    preview(request) {
        const dialog = document.createElement('dialog'); dialog.className='mc-preview';
        const title=document.createElement('h3');title.textContent='本次发送内容';
        const p=document.createElement('p');p.textContent=`较早消息未载入：${request.omitted} 条；剧情达到长度上限：${request.storyClipped?'是':'否'}。其他扩展仍可能通过酒馆事件调整最终请求。`;
        const pre=document.createElement('pre');pre.textContent=request.systemPrompt+'\n\n'+request.prompt.map(m=>`[${m.role}]\n${m.content}`).join('\n\n');
        const close=document.createElement('button');close.textContent='关闭';close.addEventListener('click',()=>dialog.close());
        dialog.append(title,p,pre,close);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
    }
    destroy() { document.removeEventListener('keydown',this.keyHandler);window.removeEventListener('resize',this.resizeHandler);this.root.remove(); }
}

function booksOptions(context,selected) {return (context.getWorldInfoNames?.()||[]).map(name=>`<option value="${esc(name)}" ${name===selected?'selected':''}>${esc(name)}</option>`).join('');}
