import { avatarMarkup, avatarSource, readLocalImage } from './images.js';
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function avatarScreen(ui,busy) {
    return `<div class="mc-scroll mc-avatar-editor"><div class="mc-avatar-preview">${avatarMarkup(ui.avatarName,ui.avatarDraft)}<strong>${esc(ui.avatarName)}</strong></div><button type="button" class="mc-primary mc-contact-primary" data-action="avatar-upload" ${busy?'disabled':''}>本地上传图片</button><label class="mc-field"><span>图片链接</span><input type="url" name="avatarUrl" placeholder="https://…" value="${esc(/^https?:/.test(ui.avatarDraft)?ui.avatarDraft:'')}" autocomplete="off"></label><div class="mc-toolbar"><button type="button" data-action="avatar-preview">预览链接</button><button type="button" data-action="avatar-reset">恢复默认头像</button></div><button type="button" class="mc-primary mc-contact-primary" data-action="avatar-save" ${busy?'disabled':''}>保存头像</button><p class="mc-muted">支持 JPG、PNG、WebP。图片链接需要能直接打开图片。</p></div>`;
}

export class AvatarController {
    constructor(app){this.app=app;}
    open(kind,id) {
        const app=this.app,ui=app.ui,p=kind==='contact'?app.state.profiles.find(p=>p.id===id):null;
        if(kind==='contact' && !p)throw new Error('联系人已不存在。');
        ui.capture();ui.avatarReturn={tab:ui.tab,contactPage:ui.contactPage,editorId:ui.editorId,chatPage:ui.chatPage};
        ui.avatarTarget={kind,id:p?.id || ''};ui.avatarName=p?.name || app.state.social.userName || app.host.context().name1 || '我';
        ui.avatarDraft=p?.avatarImage || (kind==='user'?app.state.social.avatar:'') || '';ui.avatarSerial++;app.render();
    }
    close() {
        const ui=this.app.ui;ui.drafts.delete(ui.previous);ui.previous='';ui.avatarTarget=null;ui.avatarDraft='';
        if(ui.avatarReturn)Object.assign(ui,ui.avatarReturn);ui.avatarReturn=null;this.app.render();
    }
    async upload() {
        const app=this.app,ui=app.ui,target=ui.avatarTarget,state=app.state;
        const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
        input.addEventListener('change',async()=>{try {
            const file=input.files?.[0];if(!file)return;const image=await readLocalImage(file,320);
            if(app.disposed || app.state!==state || ui.avatarTarget!==target)return;
            ui.capture();ui.clearDraft('avatarUrl');ui.avatarDraft=image;app.render();
        }catch(e){if(!app.disposed && ui.avatarTarget===target)ui.notice(e.message,true);}},{once:true});input.click();
    }
    async handle(name,args={}) {
        if(name==='avatar-settings'){this.open(args.target==='user'?'user':'contact',args.id || this.app.ui.editorId || this.app.state.selected);return true;}
        if(!name.startsWith('avatar-'))return false;
        const app=this.app,ui=app.ui,target=ui.avatarTarget;if(!target)throw new Error('请先打开头像设置。');
        if(name==='avatar-cancel'){this.close();return true;}
        if(app.busy)throw new Error('上一项任务仍在进行，请稍等。');
        if(name==='avatar-upload'){await this.upload();return true;}
        if(name==='avatar-reset'){ui.capture();ui.clearDraft('avatarUrl');ui.avatarDraft='';app.render();return true;}
        if(name==='avatar-preview' || name==='avatar-save') {
            const url=(ui.values().avatarUrl || '').trim();const image=url?avatarSource(url):avatarSource(ui.avatarDraft);
            if(url && (!image || !/^https?:/.test(image)))throw new Error('请填写有效的 http 或 https 图片链接。');
            if(name==='avatar-preview'){ui.avatarDraft=image;app.render();return true;}
            if(target.kind==='user')app.state.social.avatar=image;
            else {const p=app.state.profiles.find(p=>p.id===target.id);if(!p)throw new Error('联系人已不存在。');p.avatarImage=image;}
            await app.save();this.close();ui.notice('头像已保存。');return true;
        }
        return true;
    }
}
