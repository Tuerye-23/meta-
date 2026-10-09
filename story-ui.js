import { esc, icon } from './phone-ui.js';
import { avatarMarkup } from './images.js';

// Browse only the already-captured recent window. Never fetch older pages.
export function storyFloors(story, recentFloors=12) {
    const limit=Math.max(1,Math.min(60,Math.floor(Number(recentFloors)||12)));
    const floors=Array.isArray(story?.floors)?story.floors:[];
    const end=Number.isInteger(story?.cutoff)?story.cutoff:floors.reduce((end,f)=>Number.isInteger(f.index)?Math.max(end,f.index):end,-1);
    return floors.filter(f=>Number.isInteger(f.index) && f.index>=end-limit+1 && f.index<=end && typeof f.body==='string' && f.body.trim()).slice(-limit);
}

export function storyPage(ui, state) {
    const t=state.threads.find(t=>t.profileId===state.selected),floors=storyFloors(t?.story,state.settings.recentFloors);
    const key=t?.story?.key || '';
    let cursor=ui.storyPages.get(state.selected);
    if(!cursor || cursor.key!==key){cursor={key,index:null,follow:true};ui.storyPages.set(state.selected,cursor);}
    let position=cursor.follow?floors.length-1:floors.findIndex(f=>f.index===cursor.index);
    if(position<0 && floors.length){const next=floors.findIndex(f=>f.index>cursor.index);position=cursor.index==null || next<0?floors.length-1:next;}
    cursor.index=floors[position]?.index ?? null;
    return {t,floors,cursor,position,floor:floors[position]};
}

export function storyScreen(state,ui,busy,context) {
    if(ui.storyMode==='settings')return storySettings(state,ui,busy,context);
    const p=state.profiles.find(p=>p.id===state.selected),page=storyPage(ui,state),{t,floor,floors,position,cursor}=page;
    const annotations=t?.annotations || [],section=ui.storySection;
    let body='';
    if(section==='prose')body=`<div class="mc-story-meta"><span>${floor?`第 ${floor.index+1} 楼 · ${esc(floor.name)}`:'等待正文'}</span><label class="mc-story-follow"><span>跟随最新</span><input type="checkbox" name="storyFollow" ${cursor.follow?'checked':''} aria-label="跟随最新正文"></label></div><div class="mc-scroll mc-story-reading">${floor?`<article class="mc-story-prose" data-floor-index="${floor.index}">${esc(floor.body)}</article>`:`<div class="mc-story-empty"><strong>${state.settings.includeStory?'还没有可读的正文':'正文同步已关闭'}</strong><p>${state.settings.includeStory?'打开主线聊天后，最近正文会出现在这里。':'在读取设置中打开正文同步。'}</p><button type="button" data-action="story-settings">读取设置</button></div>`}${floor?`<button type="button" class="mc-story-notes-link" data-action="story-section" data-section="annotations">${icon('chat')}已留下 ${annotations.length} 条批注 ›</button>`:''}</div><footer class="mc-story-footer"><nav aria-label="正文翻页"><button type="button" data-action="story-page" data-step="-1" aria-label="上一条" ${position<=0?'disabled':''}>‹ <span>上一条</span></button><output aria-label="当前正文页码">${floor?position+1:0} / ${floors.length}</output><button type="button" data-action="story-page" data-step="1" aria-label="下一条" ${position>=floors.length-1?'disabled':''}><span>下一条</span> ›</button></nav><button type="button" class="mc-primary" data-action="annotate" data-index="${floor?.index ?? ''}" ${busy||!p||!floor?'disabled':''}>请 ${esc(p?.name || '角色')} 批注</button></footer>`;
    if(section==='annotations')body=`<div class="mc-scroll mc-story-notes"><h2 class="mc-story-section-heading">你们留下的批注 <small>${annotations.length}</small></h2>${annotations.length?annotations.slice().reverse().map(a=>`<article class="mc-story-annotation"><blockquote>${esc(a.quote)}</blockquote><div>${esc(a.reply)}</div><small>${esc(a.label)}</small></article>`).join(''):'<div class="mc-story-empty"><strong>还没有批注</strong><p>在正文页请角色批注，想法会留在这里。</p></div>'}</div>`;
    if(section==='memory')body=`<div class="mc-scroll mc-story-memory"><h2 class="mc-story-section-heading">剧情记忆 <small>${state.settings.storyMemorySource==='worldbook'?'世界书':'柏宝书'}</small></h2>${t?.story?.memoryText?`<div class="mc-story-memory-text">${esc(t.story.memoryText)}</div>`:'<div class="mc-story-empty"><strong>暂无剧情记忆</strong><p>可以在读取设置中选择记忆来源。</p></div>'}${t?.story?.warnings?.length?`<details class="mc-story-warning"><summary>读取情况</summary><p>${esc(t.story.warnings.join('；'))}</p></details>`:''}<p class="mc-story-helper">记忆单独显示，不计入正文页数。</p></div>`;
    return `<section class="mc-story-screen"><nav class="mc-story-tabs" aria-label="共看内容">${[['prose','正文'],['annotations','批注'],['memory','记忆']].map(([id,label])=>`<button type="button" data-action="story-section" data-section="${id}" ${id===section?'aria-current="page"':''}>${label}</button>`).join('')}</nav>${body}</section>`;
}

const field=(label,name,value,placeholder='')=>`<label class="mc-field"><span>${label}</span><textarea name="${name}" rows="2" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
const row=(id,label,value,body)=>`<details class="mc-story-setting-row" data-view="story-${id}"><summary><span>${label}</span><span class="mc-story-setting-value">${esc(value || '未设置')}<b aria-hidden="true">›</b></span></summary><div class="mc-story-row-body">${body}</div></details>`;
const names=value=>String(value||'').split(/[,，\n]/).map(s=>s.trim()).filter(Boolean);
function storySettings(state,ui,busy,context) {
    const s={...state.settings,...ui.drafts.get(ui.storySettingsKey(state.selected))},ids=s.regexIds||[],disabled=busy?'disabled':'';
    const regexes=[...ui.regexes,...ids.filter(id=>!ui.regexes.some(r=>r.id===id)).map(id=>({id,scriptName:'待同步 / 已停用：'+id}))];
    const regexBody=`<div class="mc-story-regex-list">${regexes.length?regexes.map(r=>`<label><input type="checkbox" name="regexIds" value="${esc(r.id)}" ${ids.includes(r.id)?'checked':''}><span>${esc(r.scriptName || r.id)}</span></label>`).join(''):'<p class="mc-story-helper">暂无启用的正则，可先同步酒馆列表。</p>'}</div><button type="button" class="mc-story-text-action" data-action="refresh-regex" ${disabled}>同步酒馆正则</button>${ui.regexError?`<p class="mc-story-helper">${esc(ui.regexError)}</p>`:''}`;
    const books=[...new Set([...(context.getWorldInfoNames?.()||[]),s.memoryBook].filter(Boolean))];
    return `<section class="mc-story-settings"><div class="mc-scroll mc-story-settings-scroll"><section class="mc-story-settings-group"><header><h2>正文读取</h2><small>最近 ${esc(s.recentFloors)} 楼 · ${names(s.includeTags).length} 个标签 · ${ids.length} 条正则</small></header><label class="mc-story-setting-line"><span>同步正文</span><input type="checkbox" name="includeStory" ${s.includeStory?'checked':''}></label><label class="mc-story-setting-line"><span>最近读取楼数</span><input type="number" name="recentFloors" value="${esc(s.recentFloors)}" min="1" max="60" step="1" aria-label="最近读取楼数"></label><p class="mc-story-helper">只保留最近窗口内的正文，每楼一页，最多 ${esc(s.recentFloors)} 页。</p>${row('include','包含标签',s.includeTags || '全部正文',field('标签名，用逗号或换行分隔','includeTags',s.includeTags,'正文、maintext'))}${row('exclude','排除标签',s.excludeTags || '不排除',field('不读取这些标签','excludeTags',s.excludeTags,'状态栏'))}${row('regex','正文正则',ids.length?`已选 ${ids.length} 条`:'未选择',regexBody)}<label class="mc-story-setting-line"><span>读取捕获组</span><select name="regexCapture" aria-label="读取捕获组">${Array.from({length:21},(_,i)=>`<option value="${i}" ${Number(s.regexCapture)===i?'selected':''}>${i===0?'完整匹配':i}</option>`).join('')}</select></label><p class="mc-story-helper">先提取正则匹配，再筛选标签。不选正则时只按标签读取。</p></section><section class="mc-story-settings-group"><header><h2>剧情记忆</h2></header><label class="mc-story-setting-line"><span>记忆来源</span><select name="storyMemorySource"><option value="baibai" ${s.storyMemorySource!=='worldbook'?'selected':''}>柏宝书接口</option><option value="worldbook" ${s.storyMemorySource==='worldbook'?'selected':''}>世界书条目</option></select></label><div data-story-worldbook ${s.storyMemorySource==='worldbook'?'':'hidden'}><label class="mc-story-setting-line"><span>世界书</span><select name="memoryBook"><option value="">请选择</option>${books.map(b=>`<option value="${esc(b)}" ${s.memoryBook===b?'selected':''}>${esc(b)}</option>`).join('')}</select></label><label class="mc-story-setting-line"><span>记忆条目</span><select name="memoryEntry"><option value="">请选择</option>${ui.entries.map(e=>`<option value="${esc(e.id)}" ${s.memoryEntry===e.id?'selected':''}>${esc(e.name)}${e.disabled?'（已关闭）':''}</option>`).join('')}</select></label></div><p class="mc-story-helper">较早剧情通过记忆来源读取，不增加正文页数。</p></section></div><footer><button type="button" class="mc-primary" data-action="save-story-settings" ${disabled}>保存设置</button></footer></section>`;
}

export function storyCompanion(state) {
    const p=state.profiles.find(p=>p.id===state.selected);
    return avatarMarkup(p?.name || '映',p?.avatarImage || '');
}
