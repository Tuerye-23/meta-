import { hasUnread } from './notifications.js';
import { avatarMarkup } from './images.js';
import { chatImageSource } from './chat-media.js';
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={plus:'<path d="M12 5v14M5 12h14"/>',retry:'<path d="M19.4 8.1A8 8 0 1 0 20 12"/><path d="M20 3.5V8.5H15"/>',send:'<path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14"/>',transfer:'<path d="M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5"/>',photo:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',voice:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/>',emoji:'<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M8 14c2 3 6 3 8 0"/>',poke:'<path d="M8 13V6a2 2 0 0 1 4 0v5l3 1 4 3v4a3 3 0 0 1-3 3h-5l-6-7a2 2 0 0 1 3-2ZM5 5 3 3M16 5l2-2"/>',company:'<path d="M3 8h7v9H3V8Zm11 0h7v9h-7V8ZM10 10h2v4h-2M21 10h2v4h-2M4 4v1M15 4v1"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>'};
export const chatIcon=key=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] || paths.plus}</svg>`;

export function recentConversations(state) {
    return state.profiles.map(p=>({p,t:state.threads.find(t=>t.profileId===p.id)})).filter(({t})=>t?.messages.length || t?.outbox?.length).map(({p,t})=>({p,t,last:t.outbox?.at(-1) || t.messages.at(-1),pending:Boolean(t.outbox?.length)})).sort((a,b)=>b.last.createdAt-a.last.createdAt);
}
export function conversationTime(timestamp,now=Date.now()) {
    const date=new Date(timestamp),today=new Date(now),start=new Date(today.getFullYear(),today.getMonth(),today.getDate());
    if(date>=start)return date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
    const yesterday=new Date(start);yesterday.setDate(yesterday.getDate()-1);if(date>=yesterday)return '昨天';
    const week=new Date(start);week.setDate(week.getDate()-6);if(date>=week)return date.toLocaleDateString('zh-CN',{weekday:'long'});
    return date.toLocaleDateString('zh-CN',{...(date.getFullYear()!==today.getFullYear()?{year:'numeric'}:{}),month:'numeric',day:'numeric'});
}
export function chatTimestamp(message,previous=null,now=Date.now()) {
    const date=new Date(message.createdAt),before=previous?new Date(previous.createdAt):null,today=new Date(now);
    if(!Number.isFinite(date.getTime()))return '';
    const sameDay=other=>date.getFullYear()===other.getFullYear() && date.getMonth()===other.getMonth() && date.getDate()===other.getDate();
    if(before && sameDay(before) && date-before<5*60000)return '';
    const label=date.toLocaleString('zh-CN',{...(!sameDay(today)?{...(date.getFullYear()!==today.getFullYear()?{year:'numeric'}:{}),month:'numeric',day:'numeric'}:{}),hour:'2-digit',minute:'2-digit',hour12:false});
    return `<div class="mc-chat-timestamp"><time datetime="${date.toISOString()}">${esc(label)}</time></div>`;
}
function inbox(state) {
    const items=recentConversations(state);
    return `<div class="mc-scroll mc-inbox"><label class="mc-contact-search">${chatIcon('search')}<input name="messageSearch" placeholder="搜索消息" aria-label="搜索消息"></label><div class="mc-inbox-actions"><button type="button" data-action="chat-new">新聊天</button><button type="button" data-action="avatar-settings" data-target="user">我的头像</button></div><div class="mc-conversations">${items.map(({p,t,last,pending})=>`<button type="button" class="mc-conversation" data-action="chat-open" data-id="${esc(p.id)}" data-message-search="${esc((p.name+' '+last.text).toLowerCase())}">${hasUnread(t)?'<span class="mc-unread-dot mc-conversation-unread" role="status" aria-label="有未读消息"></span>':''}${avatarMarkup(p.name,p.avatarImage)}<span class="mc-conversation-copy"><strong>${esc(p.name)}</strong><small>${esc((pending?'[待发送] ':'')+last.text.replace(/\s+/g,' ').slice(0,160))}</small></span><time>${esc(conversationTime(last.createdAt))}</time></button>`).join('')}</div>${!items.length?'<div class="mc-empty"><strong>还没有聊天</strong><p>从联系人中选一个人，开始你们的交流。</p><button type="button" data-action="chat-new">选择联系人</button></div>':''}</div>`;
}
export function chatMessage(m,p,state,queued=false) {
    if(m.role==='note')return `<article class="mc-message mc-note" data-message-id="${esc(m.id)}"><span>${esc(m.text)}</span></article>`;
    const user=m.role==='user',name=user?(p.userName || '我'):p.name,attachment=m.attachment,source=attachment && chatImageSource(attachment.source,attachment.kind==='sticker');
    const body=source?`<button type="button" class="mc-message-image ${attachment.kind==='sticker'?'mc-message-sticker':''}" data-action="chat-image-preview" data-id="${esc(m.id)}"><img src="${esc(source)}" alt="${esc(attachment.name)}" referrerpolicy="no-referrer" loading="lazy"></button>${attachment.kind==='image'?`<small class="mc-image-caption">${esc(attachment.name)}</small>`:''}`:`<div class="mc-message-text">${esc(m.text)}</div>`;
    return `<article class="mc-message mc-${m.role} mc-chat-message ${queued?'mc-queued-message':''}" ${queued?'data-queued-id':'data-message-id'}="${esc(m.id)}" ${m.replyId?`data-reply-id="${esc(m.replyId)}"`: ''}>${avatarMarkup(name,user?state.social.avatar:p.avatarImage,user?'avatar-settings':'chat-settings',user?'data-target="user" aria-label="设置我的头像"':`data-id="${esc(p.id)}" aria-label="设置 ${esc(p.name)}"`)}<div class="mc-chat-bubble ${source?'mc-media-bubble':''}">${body}<header><small>${queued?'待发送 · ':m.kind==='proactive'?'主动消息 · ':m.kind==='theatre'?'小剧场 · ':''}${esc(conversationTime(m.createdAt))}</small><button type="button" data-action="${queued?'chat-queued-delete':'delete-message'}" data-id="${esc(m.id)}" aria-label="${queued?'移除待发送消息':'删除这条消息'}">×</button></header></div></article>`;
}
function mediaPanel(state,ui,busy) {
    const disabled=busy?'disabled':'';
    if(ui.chatMedia) {
        const sticker=ui.chatMedia==='stickers',items=state.stickers || [];
        return `<section class="mc-media-panel" aria-label="${sticker?'表情包':'图片'}面板"><header><strong>${sticker?'表情包':'图片'}</strong><button type="button" data-action="chat-media-close" aria-label="收起面板">×</button></header><div class="mc-media-scroll"><details class="mc-media-add" data-view="media-add" ${!sticker || !items.length?'open':''}><summary>${sticker?'添加表情包':'选择图片'}</summary><label class="mc-field"><span>${sticker?'名称 / 含义':'图片说明（可选）'}</span><input name="chatMediaName" placeholder="${sticker?'例如：抱抱、无语、吃饭了吗':'这张图片里是什么'}" maxlength="160"></label><button type="button" data-action="chat-media-upload" ${disabled}>本地上传</button><label class="mc-field"><span>图床图片直链</span><input name="chatMediaUrl" type="url" placeholder="https://…"></label><button type="button" data-action="chat-media-link" ${disabled}>${sticker?'添加到表情包':'加入待发送'}</button><p class="mc-muted">${sticker?'支持静态图片和 GIF；名称或含义会随消息传给角色。':'选好后先加入待发送区，点右侧箭头再发送。看图需要模型支持图片输入。'}</p></details>${sticker?`<div class="mc-sticker-grid">${items.map(item=>`<div class="mc-sticker-item"><button type="button" data-action="chat-sticker-pick" data-id="${esc(item.id)}" aria-label="加入表情包 ${esc(item.name)}" ${disabled}><img src="${esc(item.source)}" alt="${esc(item.name)}" referrerpolicy="no-referrer" loading="lazy"><span>${esc(item.name)}</span></button><button type="button" class="mc-sticker-delete" data-action="chat-sticker-delete" data-id="${esc(item.id)}" aria-label="删除表情包 ${esc(item.name)}" ${disabled}>×</button></div>`).join('')}</div>`:''}</div></section>`;
    }
    return ui.chatTools?`<div class="mc-chat-tray" aria-label="聊天功能">${[['transfer','转账'],['photo','图片'],['voice','语音'],['stickers','表情包'],['poke','戳一戳'],['company','一起挂着']].map(([key,label])=>`<button type="button" data-action="chat-tool" data-tool="${key}" ${disabled}><span>${chatIcon(key==='stickers'?'emoji':key)}</span><strong>${label}</strong>${['transfer','voice'].includes(key)?'<small>预留</small>':''}</button>`).join('')}</div>`:'';
}
export function chatScreen(state,ui,busy) {
    if(ui.chatPage!=='thread')return inbox(state);
    const p=state.profiles.find(p=>p.id===state.selected);if(!p)return inbox(state);
    const t=state.threads.find(t=>t.profileId===p.id),disabled=busy?'disabled':'';
    const hidden=ui.retryHidden?.profileId===p.id?ui.retryHidden.ids:new Set();
    const entries=(t?.messages || []).filter(m=>!hidden.has(m.id)).slice(-200);
    const tray=mediaPanel(state,ui,busy),outbox=t?.outbox || [];
    return `<div class="mc-messages" aria-live="polite">${entries.map((m,index)=>chatTimestamp(m,entries[index-1])+chatMessage(m,p,state)).join('') || (outbox.length?'':`<div class="mc-empty"><strong>和 ${esc(p.name)} 聊几句</strong><p>可以一起看故事，也可以聊你们自己的事情。</p></div>`) }${outbox.map(m=>chatMessage(m,p,state,true)).join('')}</div><form class="mc-compose mc-chat-compose"><button type="button" class="mc-compose-icon" data-action="chat-plus" aria-label="更多聊天功能" aria-expanded="${ui.chatTools}">${chatIcon('plus')}</button><textarea id="mc-draft" name="draft" rows="1" placeholder="发消息…" aria-label="消息内容" enterkeyhint="enter"></textarea><button type="button" class="mc-compose-icon" data-action="retry" aria-label="重试回复" title="重试回复" ${disabled}>${chatIcon('retry')}</button><button type="button" class="mc-compose-icon mc-send" data-action="send" aria-label="发送消息" ${disabled}>${chatIcon('send')}</button></form>${tray}`;
}
