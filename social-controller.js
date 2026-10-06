import { clamp, literalMacros } from './core.js';
import { SOCIAL_PROMPTS, collectionFor, createEntry, createComment, generationCount, reserveSchedules, nextSocialTask, finishSocialTask } from './social.js';

import { readLocalImage } from './images.js';
export { readLocalImage } from './images.js';

export class SocialController {
    constructor(app){this.app=app;this.checking=false;reserveSchedules(app.state.social);this.timer=setInterval(()=>this.tick(),30000);}
    destroy(){clearInterval(this.timer);}
    async pick(target,multiple=false) {
        const app=this.app;const state=app.state;const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.multiple=multiple;
        input.addEventListener('change',async()=>{
            try {
                const files=[...(input.files || [])];if(!files.length)return;
                if(target==='photos' && app.ui.momentPhotos.length+files.length>9)throw new Error('一条朋友圈最多选择 9 张图片。');
                const results=[];for(const file of files)results.push(await readLocalImage(file,target==='avatar'?320:1440));
                if(app.disposed || app.state!==state)return;
                app.ui.capture();if(target==='photos'){app.ui.momentPhotos.push(...results);}else {state.social[target]=results[0];await app.save();}
                app.render();
            } catch(e){if(!app.disposed)app.ui.notice(e.message,true);}
        },{once:true});input.click();
    }
    async generate(kind,profileId,entryId=null,automatic=false) {
        const app=this.app;const social=app.state.social;const state=app.state;const originalView=app.ui.viewKey;const comment=Boolean(entryId);const prompt=SOCIAL_PROMPTS[kind+(comment?'Comment':'')];
        if(!['moment','diary'].includes(kind))throw new Error('生成类型无效。');
        const allowed=social.settings[kind+(comment?'CommentRoles':'Roles')];
        if(!allowed.includes(profileId))throw new Error('请先在设置中允许这个角色'+(comment?'评论。':'生成。'));
        if(!prompt?.trim())throw new Error('生成接口已准备好，等待接入作者提供的'+(kind==='moment'?'朋友圈':'日记')+(comment?'评论':'生成')+'提示词。');
        if(!comment && generationCount(social,kind,profileId)>=social.settings[kind+'Daily'])throw new Error('这个角色今天已达到生成上限。');
        const {p,t}=app.current(profileId);const entry=comment?social[collectionFor(kind)].find(x=>x.id===entryId):null;
        if(comment && !entry)throw new Error('这条记录已不存在。');
        await app.job(`正在等待 ${p.name} ${comment?'评论':kind==='moment'?'发动态':'写日记'}…`,async()=>{
            await app.refreshProfile(p);await app.refreshStory(p,t);
            const base=app.request(p,t);const recent=social[collectionFor(kind)].filter(x=>x.authorType==='user' || x.profileId===profileId).slice(-12);
            const readable=x=>x?{authorType:x.authorType,authorName:x.authorName,profileId:x.profileId,title:x.title,text:x.text,createdAt:x.createdAt,imageCount:x.images?.length || 0,comments:x.comments.slice(-12).map(c=>({authorName:c.authorName,text:c.text}))}:null;
            const data={task:kind+(comment?'Comment':''),now:new Date().toLocaleString('zh-CN'),userName:social.userName || app.host.context().name1 || '我',userStatus:social.status,entry:readable(entry),recent:recent.map(readable)};
            const result=await app.host.generate({systemPrompt:base.systemPrompt+'\n\n'+literalMacros(prompt),prompt:[...base.prompt,{role:'user',content:literalMacros(JSON.stringify(data))}],responseLength:app.state.settings.replyTokens},app.state.settings.api);
            if(app.disposed || app.state!==state)return;
            // Recheck permissions / deleted targets after an asynchronous response.
            if(!social.settings[kind+(comment?'CommentRoles':'Roles')].includes(profileId) || !app.state.profiles.some(x=>x.id===profileId))return;
            if(comment){if(!social[collectionFor(kind)].includes(entry))return;entry.comments.push(createComment('character',p.id,p.name,result));}
            else {social[collectionFor(kind)].push(createEntry({authorType:'character',profileId:p.id,authorName:p.name,text:result,generated:true}));finishSocialTask(social,kind,p.id);}
            if(!automatic && app.ui.viewKey===originalView){app.ui.socialSheet='';app.ui.resetDraft();}
            app.ui.notice(comment?'评论已收到。':kind==='moment'?'角色动态已发布。':'角色日记已保存。');
        });
    }
    async tick(now=Date.now()) {
        const app=this.app;if(this.checking || app.disposed || app.busy || app.host.busy || document.visibilityState!=='visible')return;
        const task=nextSocialTask(app.state.social,app.state.profiles,now);if(!task)return;
        this.checking=true;const state=app.state;
        try {await this.generate(task.kind,task.profileId,null,true);}
        catch(e){if(app.disposed || app.state!==state)return;finishSocialTask(state.social,task.kind,task.profileId,now,true);await app.save();if(app.ui.open)app.ui.notice('自动生成未完成：'+e.message,true);}
        finally {this.checking=false;}
    }
    async handle(name,args) {
        const app=this.app;const ui=app.ui;const social=app.state.social;
        const names=['moment-compose','moment-settings','diary-compose','diary-settings'];
        if(names.includes(name)){ui.capture();ui.socialSheet=name;ui.commentTarget='';app.render();return true;}
        if(name==='social-dismiss'){ui.capture();ui.socialSheet='';app.render();return true;}
        if(name==='diary-tab'){ui.capture();ui.diaryTab=args.value==='user'?'user':'character';ui.commentTarget='';ui.socialSheet='';app.render();return true;}
        if(name==='social-status'){const el=ui.content.querySelector('[name="socialStatus"]');if(el)el.value=args.value;return true;}
        if(name==='social-comment-open'){ui.capture();ui.commentTarget=ui.commentTarget===args.id?'':args.id;app.render();return true;}
        if(name==='social-view-photo') {
            const entry=social.moments.find(x=>x.id===args.id);const src=entry?.images[Number(args.index)];if(!src)return true;
            const dialog=document.createElement('dialog');dialog.className='mc-preview mc-photo-dialog';const img=document.createElement('img');img.src=src;img.alt='朋友圈图片';const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>dialog.close();dialog.append(img,close);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return true;
        }
        if(!/^(moment-|diary-|social-|save-moment-settings$|save-diary-settings$)/.test(name))return false;
        if(app.busy)throw new Error('上一项任务仍在进行，请稍等。');
        const values=ui.values();const userName=social.userName || app.host.context().name1 || '我';
        if(name==='moment-photos'){await this.pick('photos',true);return true;}
        if(name==='moment-cover'){await this.pick('cover');return true;}
        if(name==='social-avatar'){await this.pick('avatar');return true;}
        if(name==='moment-clear-photos'){ui.momentPhotos=[];app.render();return true;}
        if(name==='moment-reset-cover'){social.cover='';await app.save();app.render();return true;}
        if(name==='moment-publish' || name==='diary-publish') {
            const moment=name==='moment-publish';social[moment?'moments':'diaries'].push(createEntry({authorName:userName,text:values[moment?'momentText':'diaryText'],title:moment?'':values.diaryTitle,images:moment?ui.momentPhotos:[]}));
            if(moment)ui.momentPhotos=[];ui.socialSheet='';ui.resetDraft();await app.save();app.render();app.ui.notice(moment?'朋友圈已发表。':'日记已保存。');return true;
        }
        if(name==='save-moment-settings' || name==='save-diary-settings') {
            const kind=name==='save-moment-settings'?'moment':'diary';const settings=social.settings;const oldSchedule=JSON.stringify([settings[kind+'Roles'],settings[kind+'Auto'],settings[kind+'Minutes']]);
            for(const key of [kind+'Roles',kind+'CommentRoles'])settings[key]=app.state.profiles.filter(p=>values[key+':'+p.id]).map(p=>p.id);
            settings[kind+'Auto']=Boolean(values[kind+'Auto']);settings[kind+'Minutes']=clamp(values[kind+'Minutes'],1,10080,kind==='moment'?180:720);settings[kind+'Daily']=Math.floor(clamp(values[kind+'Daily'],1,100,kind==='moment'?3:1));
            if(kind==='moment'){social.userName=(values.socialUserName || '').trim().slice(0,160);social.status=(values.socialStatus || '').trim().slice(0,80);}
            reserveSchedules(social,Date.now(),false);if(oldSchedule!==JSON.stringify([settings[kind+'Roles'],settings[kind+'Auto'],settings[kind+'Minutes']]))for(const profileId of settings[kind+'Roles'])social.schedules[kind+':'+profileId]={nextAt:Date.now()+settings[kind+'Minutes']*60000,retryAt:0};
            ui.socialSheet='';ui.resetDraft();await app.save();app.render();ui.notice('设置已保存。');return true;
        }
        if(name==='social-generate'){ui.capture();ui.socialSheet='generate-'+(args.kind==='moment'?'moment':'diary');app.render();return true;}
        if(name==='social-generate-confirm'){await this.generate(args.kind,values.generateRole);return true;}
        const collection=collectionFor(args.kind);const entry=social[collection].find(x=>x.id===args.id);
        if(!entry)throw new Error('这条记录已不存在。');
        if(name==='moment-like'){entry.liked=!entry.liked;await app.save();app.render();return true;}
        if(name==='social-comment'){entry.comments.push(createComment('user','',userName,values['comment:'+entry.id]));ui.clearDraft('comment:'+entry.id);await app.save();app.render();return true;}
        if(name==='social-generate-comment'){await this.generate(args.kind,values.commentRole,entry.id);return true;}
        if(name==='social-delete'){if(entry.authorType!=='user')throw new Error('只能删除自己的记录。');if(!confirm('删除这条'+(args.kind==='moment'?'朋友圈':'日记')+'及其评论？'))return true;social[collection]=social[collection].filter(x=>x!==entry);await app.save();app.render();return true;}
        return false;
    }
}
