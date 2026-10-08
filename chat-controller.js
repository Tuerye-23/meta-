import { uid } from './core.js';
import { attachmentText, normalizeAttachment, readChatImage } from './chat-media.js';

const actions=new Set(['send','chat-stage','chat-queued-delete','chat-media-close','chat-media-upload','chat-media-link','chat-sticker-pick','chat-sticker-delete','chat-image-preview','delete-chat']);
export class ChatController {
    constructor(app){this.app=app;}
    handles(name){return actions.has(name);}
    async stage(text='',attachment=null,id=this.app.state.selected) {
        const app=this.app,{t}=app.current(id);text=text.trim();
        if(!text && !attachment)return;
        t.outbox ??=[];if(t.outbox.length>=50)throw new Error('待发送区已有 50 条，请先发送或移除一些。');
        if(attachment){attachment=normalizeAttachment(attachment);if(attachment.kind==='image' && t.outbox.filter(m=>m.attachment?.kind==='image').length>=8)throw new Error('每次最多发送 8 张图片。');}
        t.outbox.push({id:uid(),role:'user',text:text || attachmentText(attachment),kind:attachment?.kind || 'chat',createdAt:Date.now(),...(attachment?{attachment}:{})});
        if(!attachment)app.ui.clearDraft('draft');await app.save();app.render();
        const list=app.ui.content.querySelector('.mc-messages');if(app.state.selected===id && list)list.scrollTop=list.scrollHeight;
    }
    async pick(sticker) {
        const app=this.app,state=app.state,id=state.selected,{t}=app.current(id),ui=app.ui;
        const label=(ui.values().chatMediaName || '').trim();const input=document.createElement('input');input.type='file';input.accept=sticker?'image/jpeg,image/png,image/webp,image/gif':'image/jpeg,image/png,image/webp';input.multiple=!sticker;
        input.addEventListener('change',async()=>{try{
            const files=[...(input.files || [])];if(!files.length)return;
            if(!sticker && files.length+(t.outbox || []).filter(m=>m.attachment?.kind==='image').length>8)throw new Error('每次最多发送 8 张图片。');
            if(sticker && state.stickers.length>=200)throw new Error('表情包已达到 200 个，请先删除不用的。');
            const items=[];for(const file of files)items.push({kind:sticker?'sticker':'image',source:await readChatImage(file,sticker),name:label || file.name.replace(/\.[^.]+$/,'') || (sticker?'表情包':'图片')});
            if(app.disposed || app.state!==state || !state.threads.includes(t))return;
            if(sticker && state.stickers.length>=200)throw new Error('表情包已达到 200 个。');
            if(!sticker && items.length+(t.outbox || []).filter(m=>m.attachment?.kind==='image').length>8)throw new Error('每次最多发送 8 张图片。');
            if(sticker){state.stickers.push({id:uid(),...items[0]});ui.clearDraft('chatMediaName');const details=ui.content.querySelector('.mc-media-add');if(details)details.open=false;await app.save();app.render();}
            else {
                t.outbox ??=[];if(t.outbox.length+items.length>50)throw new Error('待发送内容超过 50 条，请先发送一些。');
                t.outbox.push(...items.map(item=>({id:uid(),role:'user',text:attachmentText(item),kind:'image',createdAt:Date.now(),attachment:item})));
                if(state.selected===id)ui.chatMedia='';await app.save();app.render();
                const list=ui.content.querySelector('.mc-messages');if(state.selected===id && list)list.scrollTop=list.scrollHeight;
            }
        }catch(e){if(!app.disposed)ui.notice(e.message,true);}}, {once:true});input.click();
    }
    async handle(name,args) {
        if(!actions.has(name))return false;
        const app=this.app,ui=app.ui;
        if(name==='chat-media-close'){ui.chatMedia='';app.render();return true;}
        if(name==='chat-image-preview'){
            const {t}=app.current(),message=[...t.messages,...(t.outbox || [])].find(m=>m.id===args.id);if(!message?.attachment)return true;
            const dialog=document.createElement('dialog');dialog.className='mc-image-preview';const image=document.createElement('img');image.src=message.attachment.source;image.alt=message.attachment.name;image.referrerPolicy='no-referrer';const close=document.createElement('button');close.textContent='关闭';close.addEventListener('click',()=>dialog.close());dialog.append(image,close);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return true;
        }
        if(name==='send' && this.sending)return true;
        if(app.busy || this.sending)throw new Error('上一项任务仍在进行，请稍等。');
        if(name==='send') {
            this.sending=true;try {
                const {p,t}=app.current(),draft=ui.values().draft || '';
                const batch=[...(t.outbox || [])];
                if(draft.trim()){if(batch.length>=50)throw new Error('待发送区已有 50 条，请先发送或移除一些。');batch.push({id:uid(),role:'user',text:draft.trim(),kind:'chat',createdAt:Date.now()});}
                if(!batch.length)return true;
                ui.chatMedia='';ui.chatTools=false;await app.reply('chat','',null,batch,false,p.id);
            } finally {this.sending=false;}return true;
        }
        if(name==='delete-chat') {
            const {p,t}=app.current(ui.editorId || app.state.selected);
            if(!confirm(`删除与 ${p.name} 的当前聊天、聊天记忆及待发送内容？联系人和聊天设置会保留。`))return true;
            const clean={...t,messages:[],outbox:[],unreadIds:[],memory:{text:'',throughId:''}};app.state.threads[app.state.threads.indexOf(t)]=clean;
            for(const map of [ui.drafts,ui.views])for(const key of map.keys())if(key.startsWith('chat:'+p.id+':'))map.delete(key);
            if(app.state.selected===p.id)for(const [key,draft] of ui.drafts)if(key.startsWith('settings:'))delete draft.memory;
            ui.chatMedia='';await app.save();app.render();ui.notice('当前聊天已删除。');return true;
        }
        const {t}=app.current();
        if(name==='chat-stage'){await this.stage(ui.values().draft || '');return true;}
        if(name==='chat-queued-delete'){t.outbox=(t.outbox || []).filter(m=>m.id!==args.id);await app.save();app.render();return true;}
        if(name==='chat-media-upload'){await this.pick(ui.chatMedia==='stickers');return true;}
        if(name==='chat-media-link') {
            const values=ui.values(),sticker=ui.chatMedia==='stickers',source=String(values.chatMediaUrl || '').trim();
            if(!/^https?:\/\//i.test(source))throw new Error('请填写图片的 http 或 https 直链。');
            const attachment=normalizeAttachment({kind:sticker?'sticker':'image',source,name:values.chatMediaName || (sticker?'表情包':'图片')});
            if(sticker){if(app.state.stickers.length>=200)throw new Error('表情包已达到 200 个。');app.state.stickers.push({id:uid(),...attachment});await app.save();}
            else await this.stage('',attachment);
            ui.clearDraft('chatMediaUrl');ui.clearDraft('chatMediaName');const details=ui.content.querySelector('.mc-media-add');if(details)details.open=false;if(!sticker)ui.chatMedia='';app.render();return true;
        }
        if(name==='chat-sticker-pick'){const sticker=app.state.stickers.find(s=>s.id===args.id);if(sticker)await this.stage('',sticker);return true;}
        if(name==='chat-sticker-delete'){app.state.stickers=app.state.stickers.filter(s=>s.id!==args.id);await app.save();app.render();return true;}
        return true;
    }
}
