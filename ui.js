import { VERSION } from './core.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const field = (label, name, value, rows = 3) => `<label class="mc-field"><span>${label}</span><textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
const number = (label, name, value, min, max) => `<label class="mc-field"><span>${label}</span><input type="number" name="${name}" value="${esc(value)}" min="${min}" max="${max}"></label>`;

export class Interface {
    constructor(host, action) {
        this.host = host; this.action = action; this.tab = 'chat'; this.open = false; this.previous = ''; this.drafts = new Map(); this.lastFocus = null;
        const root = document.createElement('div'); root.id = 'mc-root'; root.hidden = true;
        root.innerHTML = `<div class="mc-backdrop" data-action="close" data-tt-mobile-surface="backdrop"></div>
          <section class="mc-panel" role="dialog" aria-modal="true" aria-label="映间 Meta 旁聊" data-tt-mobile-surface="fullscreen-window">
            <header class="mc-header"><div><strong>映间</strong><small>另一个世界之外</small></div><span class="mc-version">v${VERSION}</span><button type="button" data-action="close" aria-label="关闭映间">×</button></header>
            <div class="mc-top"><label>和谁聊天 <select id="mc-profile" aria-label="选择 meta 角色"></select></label><span id="mc-status"></span></div>
            <nav class="mc-nav" aria-label="映间功能">${[['chat','聊天'],['roles','角色'],['story','剧情'],['company','陪伴'],['settings','设置']].map(([id,label]) => `<button type="button" data-action="tab" data-tab="${id}">${label}</button>`).join('')}</nav>
            <div id="mc-notice" role="status" hidden></div><main id="mc-content"></main>
          </section>`;
        document.body.append(root); this.root = root; this.content = root.querySelector('#mc-content');
        const launcher = document.createElement('button'); launcher.type = 'button'; launcher.id = 'mc-launcher'; launcher.textContent = '映'; launcher.title = '打开映间 · Meta 旁聊'; launcher.setAttribute('aria-label', launcher.title); launcher.setAttribute('data-tt-mobile-surface', 'free-window');
        document.body.append(launcher); launcher.addEventListener('click', () => action('open')); this.launcher = launcher;
        root.addEventListener('click', event => {
            const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
            action(button.dataset.action, button.dataset);
        });
        root.querySelector('#mc-profile').addEventListener('change', event => action('select', { id: event.target.value }));
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
    }
    show() { this.lastFocus = document.activeElement; this.open = true; this.root.hidden = false; this.root.querySelector('[data-action="close"][aria-label]')?.focus(); }
    hide() { this.capture(); this.open = false; this.root.hidden = true; this.lastFocus?.focus?.(); }
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
        this.capture();
        const p = state.profiles.find(p => p.id === state.selected); const t = state.threads.find(t => t.profileId === p?.id);
        const select = this.root.querySelector('#mc-profile');
        select.innerHTML = state.profiles.length ? state.profiles.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('') : '<option value="">先添加一个角色</option>'; select.value = state.selected;
        this.root.querySelector('#mc-status').textContent = busy ? '正在联系…' : this.host.bbsStatus();
        for (const b of this.root.querySelectorAll('[data-tab]')) { b.classList.toggle('mc-active', b.dataset.tab === this.tab); b.setAttribute('aria-current', b.dataset.tab === this.tab ? 'page' : 'false'); }
        const c = this.host.context(); const s = state.settings;
        const disabled = busy ? 'disabled' : '';
        if (this.tab === 'chat') this.content.innerHTML = p ? `
            <div class="mc-chat-meta">${s.includeStory ? esc(t?.story?.label || '可读取主线，也可以直接聊') : '独立 meta 聊天 · 未携带主线剧情'}<button type="button" data-action="preview">发送预览</button></div>
            <div class="mc-messages" aria-live="polite">${(t?.messages || []).slice(-200).map(m => `<article class="mc-message mc-${m.role}"><header><strong>${esc(m.role === 'user' ? p.userName || '你' : m.role === 'note' ? '记录' : p.name)}</strong><small>${esc(m.kind === 'proactive' ? '主动消息' : m.kind === 'theatre' ? '小剧场' : '')} ${new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small><button type="button" data-action="delete-message" data-id="${esc(m.id)}" aria-label="删除这条消息">×</button></header><div>${esc(m.text)}</div></article>`).join('') || `<div class="mc-empty"><span class="mc-orbit">◌</span><strong>和 ${esc(p.name)} 聊几句</strong><p>可以一起看故事，也可以从今天过得怎么样聊起。<br>关系沿用角色设定。</p></div>`}</div>
            <form class="mc-compose"><textarea id="mc-draft" name="draft" rows="3" placeholder="想和 ${esc(p.name)} 说什么？" aria-label="消息内容"></textarea><div><small>Ctrl / ⌘ + Enter 发送</small><button type="button" data-action="retry" ${disabled}>重试回复</button><button type="button" class="mc-primary" data-action="send" ${disabled}>发送</button></div></form>` : `<div class="mc-empty"><span class="mc-orbit">◌</span><strong>先认识一个人</strong><p>选择角色卡、世界书，或者手动写一份角色资料。</p><button type="button" class="mc-primary" data-action="tab" data-tab="roles">添加角色</button></div>`;
        if (this.tab === 'roles') {
            const cards = c.characters || []; const books = c.getWorldInfoNames?.() || [];
            this.content.innerHTML = `<div class="mc-scroll"><details class="mc-source-box" ${p ? '' : 'open'}><summary>从角色卡 / 世界书提取</summary><p>可多选。多人卡会整理出多位角色，提取后可以修改。每批素材会分段调用当前模型。</p>
              <div class="mc-two"><label class="mc-field"><span>角色卡（可多选）</span><select name="cards" multiple size="5">${cards.map((card,i) => `<option value="${i}" ${i===Number(c.characterId)?'selected':''}>${esc(card.name || card.data?.name || '未命名')}</option>`).join('')}</select></label>
              <label class="mc-field"><span>世界书（可多选）</span><select name="books" multiple size="5">${books.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label></div>
              <label class="mc-check"><input type="checkbox" name="includeDisabled">包含已关闭的世界书条目</label><button type="button" class="mc-primary" data-action="extract" ${disabled}>提取人物</button></details>
              <div class="mc-toolbar"><button type="button" data-action="add-profile" ${disabled}>＋ 手动添加</button>${p ? `<button type="button" data-action="delete-profile" ${disabled}>删除当前角色</button>` : ''}</div>
              ${p ? `<form id="mc-profile-form"><div class="mc-two"><label class="mc-field"><span>角色姓名</span><input name="name" value="${esc(p.name)}"></label><label class="mc-field"><span>你的称呼 / user 名称</span><input name="userName" value="${esc(p.userName)}"></label></div>
              ${field('身份与外貌','description',p.description)}${field('性格','personality',p.personality)}${field('说话习惯 / 示例','speech',p.speech)}${field('原设定里的关系','relationship',p.relationship)}${field('世界设定','world',p.world)}${field('你的设定','userPersona',p.userPersona)}${field('Meta 补充设定','notes',p.notes)}
              <p class="mc-muted">来源：${esc(p.sources?.join('；') || '手动资料')}</p><button type="button" class="mc-primary" data-action="save-profile" ${disabled}>保存角色资料</button></form>${p.sourceText ? `<details><summary>查看提取素材原文</summary><pre>${esc(p.sourceText)}</pre></details>` : ''}` : ''}</div>`;
        }
        if (this.tab === 'story') this.content.innerHTML = `<div class="mc-scroll"><div class="mc-toolbar"><button type="button" class="mc-primary" data-action="sync-story" ${!p||busy?'disabled':''}>同步当前主线最新剧情</button></div>
          <p class="mc-muted">${esc(t?.story?.label || '尚未保存观看内容')}。读取的是聊天数据，不依赖正文是否在屏幕上显示。</p>
          <div class="mc-inline"><label>停在第 <input type="number" name="cutoff" min="1" max="${c.chat?.length || 1}" value="${(t?.story?.cutoff ?? Math.max(0,(c.chat?.length||1)-1))+1}"> 条</label><button type="button" data-action="freeze-story" ${!p||busy?'disabled':''}>读取并固定进度</button></div>
          <p class="mc-muted">楼层包含用户和角色消息，从 1 开始。固定后，后续正文不会自动读入；点击“同步最新”恢复跟随。</p>
          ${(t?.story?.floors || []).map(f => `<article class="mc-floor"><header>第 ${f.index+1} 条 · ${esc(f.name)}<button type="button" data-action="annotate" data-index="${f.index}" ${disabled}>请 ${esc(p?.name)} 批注</button></header><div>${esc(f.body)}</div></article>`).join('')}
          ${t?.story ? `<details><summary>完整读取内容</summary><pre>${esc(t.story.text)}</pre></details>` : ''}
          ${t?.annotations?.length ? `<h3>你们留下的批注</h3>${t.annotations.map(a => `<article class="mc-floor"><blockquote>${esc(a.quote)}</blockquote><div>${esc(a.reply)}</div><small>${esc(a.label)}</small></article>`).join('')}` : ''}</div>`;
        if (this.tab === 'company') this.content.innerHTML = `<div class="mc-scroll"><div class="mc-company-card"><span class="mc-orbit">◌</span><strong>${session ? `和 ${esc(state.profiles.find(x=>x.id===session.profileId)?.name)} 一起` : '一起挂着'}</strong><p>${session ? esc(session.activity) : '打开这个空间，各自做点事，也能随时说话。'}</p><div id="mc-clock">00:00</div></div>
          <label class="mc-field"><span>一起做什么</span><input name="activity" value="${esc(s.activity)}" placeholder="陪我写东西 / 待一会儿 / 一起听歌"></label>
          <div class="mc-two">${number('主动搭话间隔（分钟）','intervalMinutes',s.intervalMinutes,2,120)}${number('本次最多主动发几条','maxProactive',s.maxProactive,1,20)}</div>
          <div class="mc-toolbar"><button type="button" class="mc-primary" data-action="start-company" ${!p||busy?'disabled':''}>${session?'重新开始':'开始陪伴'}</button><button type="button" data-action="stop-company" ${session?'':'disabled'}>结束陪伴</button><button type="button" data-action="nudge" ${!p||busy?'disabled':''}>让他现在说一句</button></div>
          <p class="mc-muted">主动搭话仅在映间打开且应用在前台时运行。计时无需调用模型，生成消息会使用当前 API；关闭面板时暂停，重新打开后继续计时。重启后需重新开始陪伴。</p>
          <hr><h3>开一段小剧场</h3>${field('给你们一个场景','scene','',3)}<button type="button" data-action="theatre" ${!p||busy?'disabled':''}>一起演一小段</button></div>`;
        if (this.tab === 'settings') this.content.innerHTML = `<div class="mc-scroll"><form id="mc-settings-form"><label class="mc-check"><input type="checkbox" name="includeStory" ${s.includeStory?'checked':''}>聊天时携带主线剧情（关闭后也可以独立聊天）</label>
          <div class="mc-two">${number('最近读取的正文条数','recentFloors',s.recentFloors,1,60)}${number('剧情发送上限（字符）','storyLimit',s.storyLimit,1000,60000)}${number('单次回复上限（tokens）','replyTokens',s.replyTokens,128,4096)}${number('最近 meta 消息条数','historyMessages',s.historyMessages,4,200)}</div>
          ${field('Meta 回复要求（可选）','customInstruction',s.customInstruction,4)}<button type="button" class="mc-primary" data-action="save-settings" ${disabled}>保存设置</button></form><hr>
          ${p ? `<h3>${esc(p.name)} 的 meta 记忆</h3>${field('可手动修改，或让模型整理较早聊天','memory',t?.memory?.text,6)}<div class="mc-toolbar"><button type="button" data-action="save-memory" ${disabled}>保存记忆</button><button type="button" data-action="summarize" ${disabled}>整理聊天记忆</button></div><p class="mc-muted">整理只读取这个角色与你的 meta 聊天。完整记录保留，较早部分在发送时由摘要替代。</p><hr>` : ''}
          <h3>备份</h3><p>资料和 meta 对话保存在当前设备。换设备时导出备份，再导入。</p><div class="mc-toolbar"><button type="button" data-action="export">导出完整备份</button><button type="button" data-action="import" ${disabled}>导入备份</button></div></div>`;
        this.previous = `${this.tab}:${state.selected}`;
        const saved = this.drafts.get(this.previous);
        if (saved) for (const n of this.content.querySelectorAll('input[name],textarea[name],select[name]')) {
            if (!(n.name in saved)) continue;
            if (n.type==='checkbox') n.checked = saved[n.name];
            else if (n.multiple) for (const o of n.options) o.selected = saved[n.name].includes(o.value);
            else n.value = saved[n.name];
        }
        const messages = this.content.querySelector('.mc-messages'); if(messages)messages.scrollTop = messages.scrollHeight;
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
    destroy() { document.removeEventListener('keydown',this.keyHandler);this.root.remove();this.launcher.remove(); }
}
