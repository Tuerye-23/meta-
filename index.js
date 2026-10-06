import { normalizeApi, validateApi } from './api-config.js';
import { addMessage, buildPrompt, canNudge, characterKey, clamp, literalMacros, mainKey, mergeProfiles, newThread, normalizeProfile, parseProfiles, removeMessage, summaryBatch, tagNames, uid, validateBackup, VERSION } from './core.js';
import { createHost, StateStore } from './host.js';
import { Interface } from './ui.js';
import { SocialController } from './social-controller.js';

class Companion {
    constructor(host, store, state) {
        this.host = host; this.store = store; this.state = state; this.busy = false; this.session = null; this.timer = null; this.clockTimer = null; this.syncTimer=null; this.storyRevision=0; this.disposed=false; this.autoPending=false; this.autoReading=false; this.autoTimer=null; this.autoFailure=''; this.observedOrigin=''; this.qrTimer=null; this.qrAttempts=0;
        this.ui = new Interface(host, (name, args) => this.action(name, args));
        this.unlisten = host.initEvents(name => {
            if(name==='CHAT_CHANGED') {this.storyRevision++; for(const t of this.state.threads)t.story=null;}
            if(name!=='GENERATION_STARTED') this.queueStorySync();
            if(['CHAT_CHANGED','WORLDINFO_UPDATED','APP_READY','APP_INITIALIZED','EXTENSIONS_FIRST_LOAD','SETTINGS_UPDATED','PRESET_CHANGED'].includes(name))this.queueAutoExtract();
            if(['GENERATION_ENDED','GENERATION_STOPPED'].includes(name) && this.autoPending)this.queueAutoExtract();
            if(['APP_READY','APP_INITIALIZED','EXTENSIONS_FIRST_LOAD'].includes(name))this.installQR();
            if (this.ui.open) this.render();
        });
        this.social = new SocialController(this);
        this.visibility = () => { this.updatePresence(); this.social.tick(); };
        document.addEventListener('visibilitychange', this.visibility);
        this.bindSettingsButton(); this.bindWandButton(); this.render(); this.queueStorySync(); this.queueAutoExtract();
    }
    current(id = this.state.selected) {
        const p = this.state.profiles.find(p => p.id === id);
        if (!p) throw new Error('请先添加或选择一个角色。');
        let t = this.state.threads.find(t => t.profileId === id);
        if (!t) { t = newThread(id); this.state.threads.push(t); }
        return { p, t };
    }
    render() { this.ui.render(this.state, this.busy, this.session); this.paintClock(); }
    async save() { await this.store.save(this.state); }
    async job(title, fn) {
        if (this.busy) throw new Error('上一项任务仍在进行，请稍等。');
        this.busy = true; this.ui.notice(title); this.render();
        try { const result = await fn(); await this.save(); return result; }
        finally { this.busy = false; this.render(); this.queueStorySync(); if(this.autoPending)this.queueAutoExtract(); }
    }
    elapsed(session = this.session) { return session ? session.elapsed + (session.runningSince ? Date.now() - session.runningSince : 0) : 0; }
    updatePresence() {
        const s = this.session; clearTimeout(this.timer); this.timer = null; clearInterval(this.clockTimer); this.clockTimer = null;
        if (!s) return;
        if (s.runningSince) { s.elapsed += Date.now() - s.runningSince; s.runningSince = 0; }
        if (this.ui.open && document.visibilityState === 'visible' && this.state.selected === s.profileId) {
            s.runningSince = Date.now(); s.nextAt = Date.now() + s.interval;
            this.clockTimer = setInterval(() => this.paintClock(), 1000); this.schedule();
        }
        this.paintClock();
    }
    paintClock() { this.ui.clock(this.elapsed(), Boolean(this.session && !this.session.runningSince)); }
    schedule() {
        clearTimeout(this.timer); const s = this.session; if (!s?.runningSince || s.count >= s.max) return;
        this.timer = setTimeout(async () => {
            if (this.session !== s) return;
            const now=Date.now();
            if (canNudge(s,now,{visible:document.visibilityState==='visible',open:this.ui.open,busy:this.busy,hostBusy:this.host.busy,selected:this.state.selected})) {
                // Reserve the next slot before any asynchronous operation.
                s.nextAt=now+s.interval;
                try { await this.reply('proactive', '', s); s.count++; }
                catch(error) { this.ui.notice(error?.message || String(error),true); if(s.runningSince)s.elapsed+=Date.now()-s.runningSince;s.runningSince=0; clearInterval(this.clockTimer); this.clockTimer=null; return; }
            } else s.nextAt=now+s.interval;
            if (this.session===s) this.schedule();
        }, Math.max(1000,s.nextAt-Date.now()));
    }
    queueStorySync() {
        clearTimeout(this.syncTimer);
        if(this.disposed)return;
        this.syncTimer=setTimeout(()=>this.syncCurrentStory().catch(error=>{if(this.ui.open)this.ui.notice(error.message,true);}),300);
    }
    async syncCurrentStory() {
        if(this.disposed || !this.state.selected)return;
        if(this.busy || this.host.busy)return;
        const {p,t}=this.current();
        await this.refreshStory(p,t); await this.save(); if(this.ui.open)this.render();
    }
    async refreshStory(p, t) {
        const key = mainKey(this.host.context());
        if (!this.state.settings.includeStory || !key || !this.host.context().chat?.length) {t.story=null;return;}
        const revision=++this.storyRevision;
        const story = await this.host.story(this.state.settings);
        if (mainKey(this.host.context()) !== key) throw new Error('读取期间主线已切换，请重试。');
        if(this.disposed || revision!==this.storyRevision)return;
        t.story = story; p.sourceKey = story.key;
    }
    request(p, t, kind='chat', quote='') {
        const session=this.session?.profileId===p.id?this.session:null;
        const r=buildPrompt(p,t,this.state.settings,{kind,quote,activity:session?.activity || '',elapsed:this.elapsed(session)});
        r.systemPrompt=literalMacros(r.systemPrompt);r.prompt=r.prompt.map(m=>({...m,content:literalMacros(m.content)}));return r;
    }
    async reply(kind='chat', quote='', session=null, userContent=null, retry=false) {
        const {p,t}=this.current(session?.profileId || this.state.selected);
        await this.job(`正在等待 ${p.name}…`,async()=>{
            if(userContent!==null) {addMessage(t,'user',userContent,kind);this.ui.clearDraft(kind==='theatre'?'scene':'draft');this.render();await this.save();}
            if(retry && t.messages[t.messages.length-1]?.role==='assistant') {removeMessage(t,t.messages[t.messages.length-1].id);await this.save();}
            await this.refreshStory(p,t);
            const request=this.request(p,t,kind,quote);
            const reply=await this.host.generate({systemPrompt:request.systemPrompt,prompt:request.prompt,responseLength:this.state.settings.replyTokens},this.state.settings.api);
            if (session && this.session!==session) return;
            if (kind==='annotation') t.annotations.push({quote,reply,label:t.story?.label || '',createdAt:Date.now()});
            else addMessage(t,'assistant',reply,kind);
            this.ui.notice(request.omitted || request.storyClipped ? `收到回复。${request.omitted?'较早部分消息未载入，可在设置中整理记忆。':''}${request.storyClipped?'剧情达到发送长度上限，可调整设置。':''}` : '');
            if(kind!=='annotation' && this.state.settings.autoSummary && summaryBatch(t,this.state.settings,true).length) {
                try {await this.summarizeThread(p,t,true);} catch(error) {this.ui.notice('回复已收到；自动总结未完成：'+error.message,true);}
            }
        });
    }
    queueAutoExtract(retry=false) {
        if(this.disposed)return;
        if(retry)this.autoFailure='';
        this.autoPending=true; clearTimeout(this.autoTimer);
        this.autoTimer=setTimeout(()=>this.autoExtract(),250);
    }
    async autoExtract() {
        if(this.disposed || this.autoReading || this.busy || this.host.busy)return;
        if(this.state.settings.api.mode==='host' && this.host.context().onlineStatus==='no_connection'){this.autoPending=true;if(this.ui.open)this.ui.notice('酒馆当前未连接模型。可先在设置中选择独立 API，或连接酒馆当前 API。');return;}
        this.autoReading=true; this.autoPending=false; let signature='';
        const attemptOrigin=characterKey(this.host.context());const attemptChat=mainKey(this.host.context());
        try {
            const data=await this.host.currentSources(); if(!data || this.disposed)return;
            const switched=this.observedOrigin!==data.originKey;
            this.observedOrigin=data.originKey;
            const cached=this.state.extractions[data.originKey];
            const ids=cached?.profileIds.filter(id=>this.state.profiles.some(p=>p.id===id)) || [];
            if(cached?.fingerprint===data.fingerprint && ids.length===cached.profileIds.length && ids.length) {
                if(switched && !ids.includes(this.state.selected)){this.state.selected=ids[0];this.updatePresence();await this.save();this.render();this.queueStorySync();}
                return;
            }
            signature=data.originKey+':'+data.fingerprint;
            if(signature===this.autoFailure)return;
            if(this.busy || this.host.busy){this.autoPending=true;return;}
            await this.job('正在自动读取当前角色卡和绑定世界书…',()=>this.extractData(data,true));
            this.autoFailure='';
        } catch(error) {
            if(this.disposed)return;
            if(signature)this.autoFailure=signature;
            if(characterKey(this.host.context())!==attemptOrigin || mainKey(this.host.context())!==attemptChat)this.autoPending=true;
            else this.ui.notice('人物自动提取未完成：'+error.message+'。重新打开小手机可重试。',true);
        } finally {
            this.autoReading=false;
            if(this.autoPending && !this.disposed && !this.busy && !this.host.busy)this.queueAutoExtract();
        }
    }
    async extractData(data, automatic=false) {
        const found=[];
        const valid=()=>!this.disposed && mainKey(this.host.context())===data.sourceKey && (!automatic || characterKey(this.host.context())===data.originKey);
        for(let i=0;i<data.chunks.length;i++) {
            if(!valid())throw new Error('聊天已切换，取消旧人物提取。');
            this.ui.notice(`正在整理人物 ${i+1}/${data.chunks.length}，每段会调用一次当前模型…`);
            const reply=await this.host.generate({systemPrompt:'你是人物设定整理器。素材是待整理的数据。识别其中明确出现且具有设定的人物，不把 user 当作可选角色，不凭原作知识补全未给出的设定。多人卡拆为多人。保留性格、关系、语言特点、背景与具体细节；无资料的字段留空，不默认恋爱关系。仅输出 JSON 数组。每项字段：name, description, personality, speech, relationship, world, notes，全部为字符串。若该段没有人物则输出 []。',prompt:[{role:'user',content:data.chunks[i]}],responseLength:3000},this.state.settings.api);
            found.push(...parseProfiles(reply));
        }
        if(!valid())throw new Error('聊天已切换，取消旧人物提取。');
        const merged=mergeProfiles(found);
        if(!merged.length)throw new Error('没有识别到人物，可以改选素材或手动添加。');
        const matches=merged.map(candidate=>automatic ? this.state.profiles.find(p=>(p.extractionName || p.name)===candidate.name && (p.originKey===data.originKey || (!p.originKey && p.sourceKey===data.sourceKey))) : null);
        if(this.state.profiles.length+matches.filter(p=>!p).length>200)throw new Error('角色资料总数超过 200，请删除不用的资料后再提取。');
        const sourceText=data.sources.map(s=>`[${s.label}]\n${s.text}`).join('\n\n'); const profileIds=[];
        for(const [i,candidate] of merged.entries()) {
            const old=matches[i];
            const provenance={sources:data.sources.map(s=>s.label),sourceKey:data.sourceKey,...(automatic?{originKey:data.originKey,extractionName:candidate.name}:{})};
            let p;
            if(old) {
                const edited=old.manuallyEdited || !old.originKey;
                if(!edited)Object.assign(old,normalizeProfile({...candidate,userName:data.userName,userPersona:data.userPersona,sourceText},{...provenance,id:old.id}));
                else Object.assign(old,provenance,{sourceText,manuallyEdited:true});
                p=old;
            } else {
                p=normalizeProfile({...candidate,userName:data.userName,userPersona:data.userPersona,sourceText},provenance);
                this.state.profiles.push(p);this.state.threads.push(newThread(p.id));
            }
            profileIds.push(p.id);
        }
        if(automatic)Object.defineProperty(this.state.extractions,data.originKey,{value:{fingerprint:data.fingerprint,profileIds},enumerable:true,writable:true,configurable:true});
        if(!automatic || !profileIds.includes(this.state.selected))this.state.selected=profileIds[0];
        this.updatePresence();
        this.ui.notice(`已${automatic?'自动':''}整理 ${merged.length} 位人物，可在联系人中查看和修改。`);
    }
    async extract() {
        const v=this.ui.values(); const cards=v.cards || [], books=v.books || [];
        if(!cards.length && !books.length)throw new Error('先选择至少一张角色卡或一本世界书。');
        await this.job('正在读取所选设定…',async()=>this.extractData(await this.host.sources(cards,books,Boolean(v.includeDisabled))));
    }
    async summarizeThread(p,t,automatic=false) {
        const batch=summaryBatch(t,this.state.settings,automatic);
        if(!batch.length) {if(automatic)return;throw new Error('较早聊天还不够，近期原文会保留。');}
        const marker=batch.at(-1).id;
        const instruction=this.state.settings.summaryInstruction?.trim() || '整理这两人在独立 meta 空间中的聊天记忆。保留明确事实、关系变化、称呼与偏好、承诺、未完事项和重要原话。观察到的平行世界经历必须注明归属，不作为他们亲身经历。不捏造事实，不替用户确定感情。合并旧记忆，按时间简洁记录，不超过 1800 个中文字符。';
        this.ui.notice(automatic?'正在自动整理聊天记忆…':'正在整理你们自己的聊天记忆…');
        const result=await this.host.generate({systemPrompt:instruction,prompt:[{role:'user',content:`角色：${p.name}\n旧记忆：${t.memory.text}\n新增记录：\n${batch.map(m=>`[${m.role}] ${m.text}`).join('\n\n')}`}],responseLength:2200},this.state.settings.api);
        t.memory={text:result,throughId:marker};
        if(this.state.selected===p.id && this.ui.tab==='settings')this.ui.resetDraft();
        this.ui.notice('记忆已更新，完整聊天记录仍保留。');
    }
    async summarize() {
        const {p,t}=this.current();
        await this.job('正在整理你们自己的聊天记忆…',()=>this.summarizeThread(p,t));
    }
    async loadStoryControls(book=this.state.settings.memoryBook) {
        try {this.ui.regexes=await this.host.enabledRegexes();this.ui.regexError='';} catch(error){this.ui.regexError=error.message;}
        this.ui.entries=book ? await this.host.memoryEntries(book) : []; this.ui.entryBook=book;
        this.render();
    }
    async action(name,args={}) {
        try {
            if(name==='open') {this.ui.show();this.render();this.updatePresence();this.queueStorySync();this.queueAutoExtract(true);this.installQR();this.social.tick();return;}
            if(name==='close') {this.ui.hide();this.updatePresence();return;}
            if(name==='tab') {this.ui.capture();this.ui.socialSheet='';this.ui.commentTarget='';this.ui.tab=args.tab;this.render();if(args.tab==='story')await this.loadStoryControls(this.ui.values().memoryBook);return;}
            if(name==='contact-chat'){this.ui.capture();this.state.selected=args.id;this.ui.tab='chat';this.render();this.updatePresence();await this.save();this.queueStorySync();return;}
            if(name==='select') {this.ui.capture();this.state.selected=args.id;this.render();this.updatePresence();await this.save();this.queueStorySync();return;}
            if(name==='refresh-regex') {await this.loadStoryControls(this.ui.values().memoryBook);this.ui.notice('已同步当前启用的正则，选择正文项目后保存。');return;}
            if(name==='memory-book') {this.ui.capture();this.ui.entries=await this.host.memoryEntries(args.book);this.ui.entryBook=args.book;const d=this.ui.drafts.get(this.ui.previous);if(d)d.memoryEntry='';this.render();return;}
            if(name==='preview') {const{p,t}=this.current();if(!this.busy)await this.refreshStory(p,t);const temporary={...t,messages:[...t.messages]};const draft=this.ui.values().draft?.trim();if(draft)addMessage(temporary,'user',draft);this.ui.preview(this.request(p,temporary));return;}
            if(name==='export') {await this.store.queue;const backup=JSON.parse(JSON.stringify(this.state));if(backup.settings.api)backup.settings.api.apiKey='';const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`映间备份_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return;}
            if(name==='stop-company') {if(this.session){const old=this.session;const{t}=this.current(old.profileId);addMessage(t,'note',`一起${old.activity}，约 ${Math.floor(this.elapsed(old)/60000)} 分钟。`);this.session=null;this.updatePresence();await this.save();this.render();this.ui.notice('这次陪伴已结束。');}return;}
            if(/^(moment-|diary-|social-|save-(moment|diary)-settings$)/.test(name) && await this.social.handle(name,args))return;
            if(this.busy) throw new Error('上一项任务仍在进行，请稍等。');
            if(name==='api-defaults') {this.ui.applyApiDefaults();this.ui.notice('已填入通用预设，请保存 API 配置后使用。');return;}
            if(name==='save-api') {
                const value=this.ui.apiValues();const api=value.mode==='independent'?validateApi(value).api:normalizeApi(value);
                this.state.settings.api=api;this.ui.resetDraft();await this.save();this.render();this.ui.notice(api.mode==='host'?'已沿用酒馆当前 API 配置。':'独立 API 配置已保存，可测试连接。');this.queueAutoExtract(true);return;
            }
            if(name==='api-models') {
                const api=this.ui.apiValues();await this.job('正在读取模型列表…',async()=>{this.ui.models=await this.host.models(api);this.ui.notice(`已读取 ${this.ui.models.length} 个模型，可选取或手动填写。`);});return;
            }
            if(name==='api-test') {
                const api=validateApi(this.ui.apiValues()).api;
                await this.job('正在测试独立 API…',async()=>{await this.host.generate({systemPrompt:'这是连接测试，请只回复 OK。',prompt:[{role:'user',content:'OK'}]},api);this.ui.notice('连接成功，模型已返回文字。测试使用的是当前填写的配置；需要点击保存才能用于聊天。');});return;
            }
            if(name==='extract') {await this.extract();return;}
            if(name==='add-profile') {const c=this.host.context();const p=normalizeProfile({name:'新角色',userName:c.name1 || '你',userPersona:c.powerUserSettings?.persona_description || ''});this.state.profiles.push(p);this.state.threads.push(newThread(p.id));this.state.selected=p.id;await this.save();this.render();this.queueStorySync();return;}
            if(name==='import') {const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.addEventListener('change',async()=>{try{const f=input.files?.[0];if(!f)return;if(f.size>30*1024*1024)throw new Error('备份超过 30 MB。');const restored=validateBackup(JSON.parse(await f.text()));if(!confirm('导入会替换映间现有资料与聊天。继续前请先导出备份。是否继续？'))return;this.session=null;this.updatePresence();this.state=restored;this.ui.socialSheet='';this.ui.commentTarget='';this.ui.momentPhotos=[];await this.save();this.ui.drafts.clear();this.ui.previous='';this.render();this.ui.notice('备份已导入。');}catch(e){this.ui.notice(e.message,true);}});input.click();return;}
            if(name==='save-settings') {const v=this.ui.values();const s=this.state.settings;Object.assign(s,{includeStory:Boolean(v.includeStory),recentFloors:clamp(v.recentFloors,1,60,12),storyLimit:clamp(v.storyLimit,1000,60000,12000),replyTokens:clamp(v.replyTokens,128,4096,800),historyMessages:clamp(v.historyMessages,4,200,40),customInstruction:v.customInstruction || ''});this.ui.resetDraft();await this.save();this.render();this.queueStorySync();this.ui.notice('设置已保存。');return;}
            if(name==='save-story-settings') {
                const v=this.ui.values();tagNames(v.includeTags);tagNames(v.excludeTags);
                if(v.storyMemorySource==='worldbook' && (!v.memoryBook||!v.memoryEntry))throw new Error('请选择世界书及记忆条目。');
                Object.assign(this.state.settings,{includeTags:v.includeTags||'',excludeTags:v.excludeTags||'',regexIds:v.regexIds||[],regexCapture:clamp(v.regexCapture,0,20,1),storyMemorySource:v.storyMemorySource==='worldbook'?'worldbook':'baibai',memoryBook:v.memoryBook||'',memoryEntry:v.memoryEntry||''});
                this.ui.resetDraft();await this.save();await this.syncCurrentStory();this.render();this.ui.notice('读取设置已保存，主线会自动跟随最新内容。');return;
            }
            if(name==='save-summary-settings') {const v=this.ui.values();const every=clamp(v.summaryEvery,16,200,40);Object.assign(this.state.settings,{autoSummary:Boolean(v.autoSummary),summaryEvery:every,summaryKeep:clamp(v.summaryKeep,4,Math.min(60,every-2),12),summaryInstruction:v.summaryInstruction||''});this.ui.resetDraft();await this.save();this.render();this.ui.notice('总结设置已保存。');return;}
            const{p,t}=this.current(); const v=this.ui.values();
            if(name==='save-profile') {if(!v.name?.trim())throw new Error('请填写角色姓名。');Object.assign(p,normalizeProfile({...p,...v},p),{id:p.id,manuallyEdited:true});this.ui.resetDraft();await this.save();this.render();this.ui.notice('角色资料已保存。');return;}
            if(name==='delete-profile') {if(!confirm(`删除 ${p.name} 的资料、meta 聊天和批注？`))return;if(this.session?.profileId===p.id){this.session=null;this.updatePresence();}this.state.profiles=this.state.profiles.filter(x=>x.id!==p.id);this.state.threads=this.state.threads.filter(x=>x.profileId!==p.id);for(const key of ['momentRoles','momentCommentRoles','diaryRoles','diaryCommentRoles'])this.state.social.settings[key]=this.state.social.settings[key].filter(id=>id!==p.id);for(const key of Object.keys(this.state.social.schedules))if(key.endsWith(':'+p.id))delete this.state.social.schedules[key];this.state.selected=this.state.profiles[0]?.id || '';await this.save();this.render();return;}
            if(name==='save-memory') {t.memory.text=v.memory || '';if(!t.memory.text)t.memory.throughId='';this.ui.resetDraft();await this.save();this.render();this.ui.notice('记忆已保存。');return;}
            if(name==='summarize') {await this.summarize();return;}
            if(name==='delete-message') {if(!confirm('删除这条 meta 消息？涉及已整理内容时会清空对应摘要，之后可重新整理。'))return;removeMessage(t,args.id);await this.save();this.render();return;}
            if(name==='annotate') {const floor=t.story?.floors.find(f=>f.index===Number(args.index));if(!floor)throw new Error('这段正文已不在当前观看记录中。');await this.reply('annotation',floor.body);return;}
            if(name==='send') {if(!v.draft?.trim())return;await this.reply('chat','',null,v.draft.trim());return;}
            if(name==='retry') {if(!t.messages.length)throw new Error('先发一条消息。');await this.reply('chat','',null,null,true);return;}
            if(name==='theatre') {if(!v.scene?.trim())throw new Error('先给小剧场写一个场景。');const scene=v.scene.trim();this.ui.clearDraft('scene');this.ui.tab='chat';await this.reply('theatre','',null,`[Meta 小剧场]\n我们在这里演一段独立的小场景：${scene}\n保持双方人设与关系，你开始。`);return;}
            if(name==='start-company') {if(this.session)await this.action('stop-company');const s=this.state.settings;s.activity=v.activity?.trim() || '待一会儿';s.intervalMinutes=clamp(v.intervalMinutes,2,120,10);s.maxProactive=clamp(v.maxProactive,1,20,3);this.session={id:uid(),profileId:p.id,activity:s.activity,interval:s.intervalMinutes*60000,max:s.maxProactive,count:0,elapsed:0,runningSince:0,nextAt:0};addMessage(t,'note',`开始一起${s.activity}。`);this.updatePresence();await this.save();this.render();this.ui.notice('已开始陪伴。你可以切到聊天页随时说话。');return;}
            if(name==='nudge') {await this.reply('proactive');return;}
        } catch(error) {console.error('[映间]',error);this.ui.notice(error?.message || String(error),true);this.render();}
    }
    bindSettingsButton() {
        const target=document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if(!target)return;const wrap=document.createElement('div');wrap.className='extension_container';wrap.id='mc-extension-settings';const button=document.createElement('button');button.type='button';button.className='menu_button';button.textContent='映间 · 打开 Meta 旁聊';button.addEventListener('click',()=>this.action('open'));wrap.append(button);target.append(wrap);this.settingsButton=wrap;
    }
    bindWandButton() {
        const attach=()=>{const menu=document.getElementById('extensionsMenu');if(!menu)return false;if(!document.getElementById('mc-wand-button')){const button=document.createElement('button');button.type='button';button.id='mc-wand-button';button.className='list-group-item flex-container flexGap5 interactable';button.innerHTML='<i class="fa-solid fa-mobile-screen" aria-hidden="true"></i><span>映间小手机</span>';button.addEventListener('click',()=>this.action('open'));menu.append(button);this.wandButton=button;}return true;};
        if(!attach()){this.menuObserver=new MutationObserver(()=>{if(attach())this.menuObserver.disconnect();});this.menuObserver.observe(document.body,{childList:true,subtree:true});}
    }
    installQR() {
        if(this.disposed || this.qrTask)return this.qrTask;
        clearTimeout(this.qrTimer);
        if(this.host.context().extensionSettings?.disabledExtensions?.includes('quick-reply'))return;
        this.qrTask=(async()=>{
            let api=globalThis.quickReplyApi;
            if(!api?.createSet) {
                const module=await import('/scripts/extensions/quick-reply/index.js').catch(()=>null);api=module?.quickReplyApi;
            }
            if(!api?.createSet || !api?.createQuickReply)throw new Error('快速回复接口尚未就绪');
            const name='映间小手机';let imported=false;
            if(!api.getSetByName(name)){await api.createSet(name);imported=true;}
            if(this.disposed)return;
            const set=api.getSetByName(name);
            if(!api.getQrByLabel(name,'映间')){await api.createQuickReply(name,'映间',{message:'/meta',icon:'fa-mobile-screen',showLabel:true,title:'打开映间小手机'});imported=true;}
            await this.host.saveQRSet(set);
            if(this.disposed)return;
            const repair=!this.state.qrInstalled || imported;
            if(repair) {
                if(api.settings)api.settings.isEnabled=true;
                api.settingsUi?.rerender?.();
                await api.addGlobalSet(name,true);
                const link=api.settings?.config?.setList?.find(link=>link.set===set || link.set?.name===name);
                if(link)link.isVisible=true;
                await api.settings?.save?.();
                this.state.qrInstalled=true;await this.save();
            }
            this.qrAttempts=0;
        })().catch(error=>{
            if(this.disposed)return;
            if(this.qrAttempts++<12)this.qrTimer=setTimeout(()=>this.installQR(),Math.min(500*2**Math.min(this.qrAttempts,4),5000));
            else console.warn('[映间] QR 自动导入未完成',error?.message || String(error));
        }).finally(()=>{this.qrTask=null;});
        return this.qrTask;
    }
    destroy() {this.disposed=true;this.storyRevision++;clearTimeout(this.syncTimer);clearTimeout(this.autoTimer);clearTimeout(this.qrTimer);clearTimeout(this.timer);clearInterval(this.clockTimer);this.social.destroy();document.removeEventListener('visibilitychange',this.visibility);this.unlisten?.();this.menuObserver?.disconnect();this.ui.destroy();this.settingsButton?.remove();this.wandButton?.remove();}
}

async function initialize() {
    await (globalThis.__TAURITAVERN__?.ready ?? globalThis.__TAURITAVERN_MAIN_READY__ ?? Promise.resolve());
    if(document.getElementById('mc-root'))return;
    const host=createHost();const store=new StateStore(host);const state=await store.init();
    const app=new Companion(host,store,state);
    globalThis.STMetaCompanion={version:VERSION,open:()=>app.action('open'),destroy:()=>app.destroy()};
    const c=host.context();
    if(c.SlashCommandParser?.addCommandObject&&c.SlashCommand?.fromProps) {
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({name:'meta',callback:async()=>{await app.action('open');return '';},helpString:'打开映间 Meta 旁聊'}));
    }
    app.installQR();
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initialize().catch(reportInitializationError),{once:true});
else initialize().catch(reportInitializationError);

function reportInitializationError(error) {
    console.error('[映间] 初始化失败',error);
    globalThis.toastr?.error?.(`映间加载失败：${error?.message || String(error)}`);
}
