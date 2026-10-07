import { normalizeApi, validateApi } from './api-config.js';
import { addMessage, buildPrompt, characterKey, clamp, literalMacros, mainKey, newThread, normalizeProfile, removeMessage, summaryBatch, tagNames, uid, validateBackup, VERSION } from './core.js';
import { createHost, StateStore } from './host.js';
import { Interface } from './ui.js';
import { HEAD_PROMPT, AI_PROMPT } from './prompts.js';
import { definitionProfile } from './persona.js';
import { ContactsController } from './contacts-controller.js';
import { SocialController } from './social-controller.js';
import { AvatarController } from './avatars.js';
import { replyParts, shortChat, lastReplyGroup } from './chat-mode.js';
import { MessageSound, markRead, receiveMessages, notificationPreferences } from './notifications.js';
import { ProactiveController, finishProactive } from './proactive.js';

class Companion {
    constructor(host, store, state) {
        this.host = host; this.store = store; this.state = state; this.busy = false; this.session = null; this.timer = null; this.clockTimer = null; this.syncTimer=null; this.storyRevision=0; this.disposed=false; this.autoPending=false; this.autoReading=false; this.autoTimer=null; this.autoFailure=''; this.observedOrigin=''; this.qrTimer=null; this.qrAttempts=0;
        this.sound = new MessageSound();
        this.sound.bind();
        this.ui = new Interface(host, (name, args) => this.action(name, args));
        this.unlisten = host.initEvents(name => {
            if(name==='CHAT_CHANGED') {this.storyRevision++; for(const t of this.state.threads)t.story=null;}
            if(name!=='GENERATION_STARTED') this.queueStorySync();
            if(['CHAT_CHANGED','WORLDINFO_UPDATED','APP_READY','APP_INITIALIZED','EXTENSIONS_FIRST_LOAD','SETTINGS_UPDATED','PRESET_CHANGED'].includes(name))this.queueAutoExtract();
            if(['GENERATION_ENDED','GENERATION_STOPPED'].includes(name) && this.autoPending)this.queueAutoExtract();
            if(['APP_READY','APP_INITIALIZED','EXTENSIONS_FIRST_LOAD'].includes(name))this.installQR();
            if (this.ui.open) this.render();
        });
        this.social = new SocialController(this);this.contacts=new ContactsController(this);this.avatars=new AvatarController(this);
        this.proactive = new ProactiveController(this);
        this.visibility = () => { this.render(); this.updatePresence(); this.social.tick();void this.proactive.tick(); };
        document.addEventListener('visibilitychange', this.visibility);
        this.readListener=()=>this.readVisibleThread();
        window.addEventListener('focus',this.readListener);
        this.ui.root.addEventListener('scroll',this.readListener,true);
        this.bindSettingsButton(); this.bindWandButton(); this.render(); this.queueStorySync(); this.queueAutoExtract();
    }
    current(id = this.state.selected) {
        const p = this.state.profiles.find(p => p.id === id);
        if (!p) throw new Error('请先添加或选择一个角色。');
        let t = this.state.threads.find(t => t.profileId === id);
        if (!t) { t = newThread(id); this.state.threads.push(t); }
        return { p, t };
    }
    viewingThread(id) {return this.ui.open && document.visibilityState==='visible' && this.ui.tab==='chat' && this.ui.chatPage==='thread' && !this.ui.avatarTarget && this.state.selected===id;}
    render() {
        this.ui.render(this.state, this.busy, this.session); this.paintClock();
        this.readVisibleThread();
    }
    readVisibleThread() {
        if(this.disposed || !this.viewingThread(this.state.selected) || document.hasFocus?.()===false)return;
        const t=this.state.threads.find(t=>t.profileId===this.state.selected),last=t?.messages.at(-1);
        const list=this.ui.content.querySelector('.mc-messages');
        if(!list || this.ui.chatProfile!==this.state.selected || list.scrollHeight-list.clientHeight-list.scrollTop>24)return;
        if(last && ![...list.querySelectorAll('[data-message-id]')].some(el=>el.dataset.messageId===last.id))return;
        if(markRead(t)){this.ui.refreshUnread(this.state);this.save().catch(error=>this.ui.notice(error.message,true));}
    }
    async save() { await this.store.save(this.state); }
    log(message,level='info') {
        const key=this.state.settings.api?.apiKey;
        const safe=String(message).split(key || '\0').join('[API Key]').replace(/(?:sk-|Bearer\s+)[\w.-]+/gi,'[API Key]').slice(0,800);
        this.state.logs ??=[];this.state.logs.push({createdAt:Date.now(),level,message:safe});this.state.logs=this.state.logs.slice(-200);
    }
    async job(title, fn) {
        if (this.busy) throw new Error('上一项任务仍在进行，请稍等。');
        this.busy = true; this.log(title); this.ui.notice(title); this.render();
        try { const result = await fn(); this.log(title+' · 完成'); await this.save(); return result; }
        catch(error){this.log(title+' · '+(error?.message || String(error)),'error');await this.save();throw error;}
        finally { this.ui.pendingReply=null;this.ui.retryHidden=null;this.busy = false; this.render(); this.queueStorySync(); if(this.autoPending)this.queueAutoExtract(); }
    }
    elapsed(session = this.session) { return session ? session.elapsed + (session.runningSince ? Date.now() - session.runningSince : 0) : 0; }
    updatePresence() {
        const s = this.session; clearTimeout(this.timer); this.timer = null; clearInterval(this.clockTimer); this.clockTimer = null;
        if (!s) return;
        if (s.runningSince) { s.elapsed += Date.now() - s.runningSince; s.runningSince = 0; }
        if (this.ui.open && document.visibilityState === 'visible' && this.state.selected === s.profileId) {
            s.runningSince = Date.now();
            this.clockTimer = setInterval(() => this.paintClock(), 1000);
        }
        this.paintClock();
    }
    paintClock() { this.ui.clock(this.elapsed(), Boolean(this.session && !this.session.runningSince)); }
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
    async reply(kind='chat', quote='', session=null, userContent=null, retry=false, targetId=null, automatic=false) {
        const {p,t}=this.current(targetId || session?.profileId || this.state.selected);
        const state=this.state;
        await this.job(`正在等待 ${p.name}…`,async()=>{
            if(userContent!==null) {addMessage(t,'user',userContent,kind);this.ui.clearDraft(kind==='theatre'?'scene':'draft');this.render();await this.save();}
            if(kind==='poke' && !retry){addMessage(t,'note',`${p.userName || '你'} 戳了戳 ${p.name}。`,'poke');this.render();await this.save();}
            const replaced=retry?lastReplyGroup(t):[],replacedIds=new Set(replaced.map(m=>m.id));
            if(replaced.length){this.ui.retryHidden={profileId:p.id,ids:replacedIds};this.render();}
            await this.refreshProfile(p);
            await this.refreshStory(p,t);
            const outputProfile={...p},isShort=shortChat(outputProfile,kind);
            const request=this.request(outputProfile,replaced.length?{...t,messages:t.messages.filter(m=>!replacedIds.has(m.id))}:t,kind,quote);
            const reply=await this.host.generate({systemPrompt:request.systemPrompt,prompt:request.prompt,onText:content=>{const parts=replyParts(content,outputProfile,kind,true);this.ui.pendingReply={profileId:p.id,parts};this.ui.streamText(p.id,parts);}},this.state.settings.api);
            const parts=replyParts(reply,outputProfile,kind);
            this.ui.pendingReply=null;
            if(this.disposed || this.state!==state || !state.profiles.some(person=>person.id===p.id))return;
            if(automatic && !p.proactiveEnabled)return;
            if (session && this.session!==session) return;
            if (kind==='annotation') t.annotations.push({quote,reply,label:t.story?.label || '',createdAt:Date.now()});
            else {
                for(const old of replaced)removeMessage(t,old.id);
                const replyId=isShort?uid():null;
                const received=[];
                for(const part of parts){const message=addMessage(t,'assistant',part,kind);if(replyId)message.replyId=replyId;received.push(message);}
                if(automatic && received.length)finishProactive(p,t);
                if(!retry){receiveMessages(t,received);void this.sound.play(this.state.settings).then(ok=>{if(!ok && !this.disposed){this.log('消息提示音未能播放，请在消息提醒中点击试听。','error');if(this.ui.open)this.ui.notice('提示音未能播放，可在设置 → 消息提醒中点击试听。',true);}});}
            }
            this.render();
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
        this.autoReading=true;this.autoPending=false;
        const attemptOrigin=characterKey(this.host.context());
        try {
            const data=await this.host.currentDefinitions();if(!data || this.disposed)return;
            const switched=this.observedOrigin!==data.originKey;this.observedOrigin=data.originKey;
            const cached=this.state.extractions[data.originKey];
            const oldIds=cached?.profileIds.filter(id=>this.state.profiles.some(p=>p.id===id)) || [];
            // Older extracted/manual contacts retain their persona and conversations.
            if(oldIds.length && oldIds.every(id=>this.state.profiles.find(p=>p.id===id).personaMode!=='inherit')) {
                if(switched && !(this.ui.tab==='chat' && this.ui.chatPage==='thread')){this.state.selected=oldIds[0];this.updatePresence();}
            } else {
                const ids=[];
                for(const card of data.cards) {
                    const entries=[];
                    const candidate=definitionProfile(card,entries,data.userName,data.userPersona);
                    let p=this.state.profiles.find(p=>oldIds.includes(p.id) && p.binding?.avatar===card.avatar) || this.state.profiles.find(p=>p.personaMode==='inherit' && p.binding?.avatar===card.avatar);
                    if(p?.personaMode==='inherit'){Object.assign(p,normalizeProfile({...candidate,name:p.name,world:p.world,notes:p.notes,relationship:p.relationship,userName:p.manuallyEdited?p.userName:data.userName,userPersona:p.manuallyEdited?p.userPersona:data.userPersona},p),{id:p.id});await this.refreshSupplements(p);}
                    else if(!p) {if(this.state.profiles.length>=200)throw new Error('联系人已达到 200 位，请先删除不用的联系人。');p=normalizeProfile(candidate,{originKey:data.originKey,sourceKey:data.sourceKey,sources:candidate.sources});this.state.profiles.push(p);this.state.threads.push(newThread(p.id));}
                    ids.push(p.id);
                }
                Object.defineProperty(this.state.extractions,data.originKey,{value:{fingerprint:data.fingerprint,profileIds:ids},enumerable:true,writable:true,configurable:true});
                if((switched && !(this.ui.tab==='chat' && this.ui.chatPage==='thread') || !this.state.selected) && ids.length)this.state.selected=ids[0];
            }
            await this.save();this.render();this.updatePresence();this.queueStorySync();
        } catch(error) {
            if(!this.disposed && characterKey(this.host.context())===attemptOrigin){this.log('读取设定失败：'+error.message,'error');await this.save();this.ui.notice('设定读取未完成：'+error.message,true);}
            else this.autoPending=true;
        } finally {this.autoReading=false;if(this.autoPending && !this.disposed && !this.busy && !this.host.busy)this.queueAutoExtract();}
    }
    async refreshProfile(p) {
        if(p.personaMode!=='inherit'){await this.refreshSupplements(p);return;}
        const data=await this.host.linkedDefinition(p);
        const card=data.cards[0] || {name:p.name,description:data.entries.map(e=>e.content).join('\n\n'),personality:'',scenario:'',examples:'',sourceText:'',binding:p.binding};
        // A book-only persona is the selected raw entries, not duplicated in world slots.
        const candidate=definitionProfile(card,data.cards.length?data.entries:[],p.manuallyEdited?p.userName:data.userName,p.manuallyEdited?p.userPersona:data.userPersona);
        Object.assign(p,normalizeProfile({...candidate,name:p.name,binding:p.binding,relationship:p.relationship,world:p.world,notes:p.notes},p),{id:p.id});
        await this.refreshSupplements(p);
    }
    async refreshSupplements(p) {
        const books=(p.supplementalBooks || []).filter(b=>b.ids===null || b.ids.length);
        if(!books.length){p.worldBefore='';p.worldAfter='';return;}
        const data=await this.host.definitions([],books,false,false);
        const format=entries=>entries.map(e=>`[${e.label}]\n${e.content}`).join('\n\n');
        p.worldBefore=format(data.entries.filter(e=>e.position===0 || e.position==='before_char'));
        p.worldAfter=format(data.entries.filter(e=>e.position!==0 && e.position!=='before_char'));
    }
    async summarizeThread(p,t,automatic=false) {
        const batch=summaryBatch(t,this.state.settings,automatic);
        if(!batch.length) {if(automatic)return;throw new Error('较早聊天还不够，近期原文会保留。');}
        const marker=batch.at(-1).id;
        const instruction='整理这两人在独立 meta 空间中的聊天记忆。保留明确事实、关系变化、称呼与偏好、承诺、未完事项和重要原话。观察到的平行世界经历必须注明归属，不作为他们亲身经历。不捏造事实，不替用户确定感情。合并旧记忆，按时间简洁记录，不超过 1800 个中文字符。';
        this.ui.notice(automatic?'正在自动整理聊天记忆…':'正在整理你们自己的聊天记忆…');
        const result=await this.host.generate({systemPrompt:instruction,prompt:[{role:'user',content:`角色：${p.name}\n旧记忆：${t.memory.text}\n新增记录：\n${batch.map(m=>`[${m.role}] ${m.text}`).join('\n\n')}`}],responseLength:2200},this.state.settings.api);
        t.memory={text:result,throughId:marker};
        if(this.state.selected===p.id && this.ui.tab==='settings')this.ui.resetDraft(['memory']);
        this.ui.notice('记忆已更新，完整聊天记录仍保留。');
    }
    async summarize() {
        const {p,t}=this.current();
        await this.job('正在整理你们自己的聊天记忆…',()=>this.summarizeThread(p,t));
    }
    download(name,value) {
        const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    }
    async loadStoryControls(book=this.state.settings.memoryBook) {
        try {this.ui.regexes=await this.host.enabledRegexes();this.ui.regexError='';} catch(error){this.ui.regexError=error.message;}
        this.ui.entries=book ? await this.host.memoryEntries(book) : []; this.ui.entryBook=book;
        this.render();
    }
    async action(name,args={}) {
        try {
            void this.sound.unlock();
            if(name==='open') {this.ui.show();this.render();this.updatePresence();this.queueStorySync();this.queueAutoExtract(true);this.installQR();this.social.tick();void this.proactive.tick();return;}
            if(name==='close') {this.ui.hide();this.updatePresence();return;}
            if(name==='chat-unread'){const list=this.ui.content.querySelector('.mc-messages');if(list){list.scrollTop=list.scrollHeight;this.readVisibleThread();}return;}
            if(name==='back'){this.ui.capture();if(this.ui.avatarTarget){this.avatars.close();return;}if(this.ui.tab==='chat' && this.ui.chatPage==='thread'){this.ui.chatPage='list';this.ui.chatTools=false;this.ui.emojiOpen=false;}else if(this.ui.tab==='roles' && (this.ui.contactPage==='detail' || this.ui.contactPage==='chatMode' && this.ui.chatModeDirect) && this.ui.contactReturn==='chat'){this.ui.tab='chat';this.ui.chatPage='thread';this.ui.contactReturn='';this.ui.chatModeDirect=false;}else if(this.ui.tab==='roles')this.contacts.back();else this.ui.tab='home';this.render();return;}
            if(name==='social-avatar'){this.avatars.open('user');return;}
            if(name.startsWith('avatar-') && await this.avatars.handle(name,args))return;
            if(name==='chat-settings'){this.ui.capture();this.ui.editorId=args.id || this.state.selected;this.ui.contactPage='detail';this.ui.contactReturn='chat';this.ui.tab='roles';this.ui.chatTools=false;this.render();return;}
            if(name==='chat-new'){await this.action('tab',{tab:'roles'});return;}
            if(((name.startsWith('contact-') && name!=='contact-chat') || name==='save-supplements') && await this.contacts.handle(name,args))return;
            if(name==='tab') {this.ui.capture();this.ui.avatarTarget=null;this.ui.socialSheet='';this.ui.commentTarget='';this.ui.contactReturn='';this.ui.tab=args.tab;if(args.tab==='chat'){this.ui.chatPage='list';this.ui.chatTools=false;this.ui.emojiOpen=false;}if(args.tab==='roles'){this.ui.contactPage='list';this.ui.editorId='';}this.render();if(args.tab==='story')await this.loadStoryControls(this.ui.values().memoryBook);return;}
            if(name==='contact-chat' || name==='chat-open'){if(!this.state.profiles.some(p=>p.id===args.id))throw new Error('联系人已不存在。');this.ui.capture();this.state.selected=args.id;this.ui.tab='chat';this.ui.chatPage='thread';this.ui.chatTools=false;this.ui.emojiOpen=false;this.ui.contactReturn='';this.render();this.updatePresence();await this.save();this.queueStorySync();return;}
            if(name==='chat-plus'){this.ui.capture();this.ui.chatTools=!this.ui.chatTools;this.ui.emojiOpen=false;this.render();return;}
            if(name==='chat-emoji'){const draft=this.ui.content.querySelector('#mc-draft');if(draft){const start=draft.selectionStart ?? draft.value.length,end=draft.selectionEnd ?? start;draft.value=draft.value.slice(0,start)+args.value+draft.value.slice(end);draft.focus();draft.setSelectionRange(start+args.value.length,start+args.value.length);this.ui.capture();this.ui.sizeComposer();}return;}
            if(name==='select') {this.ui.capture();this.state.selected=args.id;if(this.ui.tab==='settings'){const memory=this.ui.content.querySelector('[name="memory"]');if(memory)memory.value=this.current().t.memory?.text || '';const selected=this.ui.content.querySelector('[name="summaryProfile"]');if(selected)selected.value=args.id;}this.render();this.updatePresence();await this.save();this.queueStorySync();return;}
            if(name==='refresh-regex') {await this.loadStoryControls(this.ui.values().memoryBook);this.ui.notice('已同步当前启用的正则，选择正文项目后保存。');return;}
            if(name==='clear-logs'){this.state.logs=[];await this.save();this.render();return;}
            if(name==='export-logs'){this.download('映间后台日志.json',this.state.logs);return;}
            if(name==='memory-book') {this.ui.capture();this.ui.entries=await this.host.memoryEntries(args.book);this.ui.entryBook=args.book;const d=this.ui.drafts.get(this.ui.previous);if(d)d.memoryEntry='';this.render();return;}
            if(name==='preview') {this.ui.capture();const{p,t}=this.current(args.id || this.state.selected);if(!this.busy){await this.refreshProfile(p);await this.refreshStory(p,t);}const temporary={...t,messages:[...t.messages]};const draft=this.ui.chatDraft(p.id).trim();if(draft)addMessage(temporary,'user',draft);this.ui.preview(this.request(p,temporary));return;}
            if(name==='export') {await this.store.queue;const backup=JSON.parse(JSON.stringify(this.state));if(backup.settings.api)backup.settings.api.apiKey='';const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`映间备份_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return;}
            if(name==='stop-company') {if(this.session){const old=this.session;const{t}=this.current(old.profileId);addMessage(t,'note',`一起${old.activity}，约 ${Math.floor(this.elapsed(old)/60000)} 分钟。`);this.session=null;this.updatePresence();await this.save();this.render();this.ui.notice('这次陪伴已结束。');}return;}
            if(/^(moment-|diary-|social-|save-(moment|diary)-settings$)/.test(name) && await this.social.handle(name,args))return;
            if(this.busy) throw new Error('上一项任务仍在进行，请稍等。');
            if(name==='chat-tool'){
                if(['transfer','photo','voice'].includes(args.tool)){this.ui.notice(({transfer:'转账',photo:'照片',voice:'语音'})[args.tool]+'入口已预留，暂未开放。');return;}
                if(args.tool==='emoji'){this.ui.capture();this.ui.emojiOpen=!this.ui.emojiOpen;this.render();return;}
                this.ui.capture();this.ui.chatTools=false;this.ui.emojiOpen=false;
                if(args.tool==='company'){this.ui.tab='company';this.render();return;}
                if(args.tool==='poke'){this.render();await this.reply('poke');return;}
            }
            if(name==='api-defaults') {this.ui.applyApiDefaults();this.ui.notice('已恢复默认参数，保存后生效。');return;}
            if(name==='save-api') {
                const value=this.ui.apiValues();const api=value.mode==='independent'?validateApi(value).api:normalizeApi(value);
                this.state.settings.api=api;this.ui.resetDraft(Object.keys(api).map(key=>'api'+key[0].toUpperCase()+key.slice(1)));await this.save();this.render();this.ui.notice(api.mode==='host'?'已沿用酒馆当前 API 配置。':'独立 API 配置已保存，可测试连接。');this.queueAutoExtract(true);return;
            }
            if(name==='api-models') {
                const api=this.ui.apiValues();await this.job('正在读取模型列表…',async()=>{this.ui.models=await this.host.models(api);this.ui.notice(`已读取 ${this.ui.models.length} 个模型，可选取或手动填写。`);});return;
            }
            if(name==='api-test') {
                const api=validateApi(this.ui.apiValues()).api;
                await this.job('正在测试独立 API…',async()=>{await this.host.generate({systemPrompt:'这是连接测试，请只回复 OK。',prompt:[{role:'user',content:'OK'}]},api);this.ui.notice('连接成功，模型已返回文字。测试使用的是当前填写的配置；需要点击保存才能用于聊天。');});return;
            }
            if(name==='add-profile') {const c=this.host.context();const p=normalizeProfile({name:'新角色',userName:c.name1 || '你',userPersona:c.powerUserSettings?.persona_description || ''});this.state.profiles.push(p);this.state.threads.push(newThread(p.id));this.ui.editorId=p.id;this.ui.contactPage='field';this.ui.contactField='name';if(!this.state.selected)this.state.selected=p.id;await this.save();this.render();this.queueStorySync();return;}
            if(name==='import') {const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.addEventListener('change',async()=>{try{const f=input.files?.[0];if(!f)return;if(f.size>30*1024*1024)throw new Error('备份超过 30 MB。');const restored=validateBackup(JSON.parse(await f.text()));if(!confirm('导入会替换映间现有资料与聊天。继续前请先导出备份。是否继续？'))return;this.session=null;this.updatePresence();this.state=restored;this.ui.socialSheet='';this.ui.commentTarget='';this.ui.momentPhotos=[];this.ui.avatarTarget=null;this.ui.chatPage='list';this.ui.chatTools=false;this.ui.emojiOpen=false;this.ui.contactReturn='';await this.save();this.ui.drafts.clear();this.ui.sourceDraft={cards:[],personaBook:'',personaEntries:[]};this.ui.contactPage='list';this.ui.editorId='';this.ui.contactCandidates=[];this.contacts.revision++;this.contacts.recognition=null;this.ui.previous='';this.render();this.ui.notice('备份已导入。');}catch(e){this.ui.notice(e.message,true);}});input.click();return;}
            if(name==='save-settings') {const v=this.ui.values();const s=this.state.settings;Object.assign(s,{includeStory:Boolean(v.includeStory),recentFloors:clamp(v.recentFloors,1,60,12),historyMessages:clamp(v.historyMessages,4,200,40),});this.ui.resetDraft(['includeStory','recentFloors','historyMessages']);await this.save();this.render();this.queueStorySync();this.ui.notice('设置已保存。');return;}
            if(name==='save-story-settings') {
                const v=this.ui.values();tagNames(v.includeTags);tagNames(v.excludeTags);
                if(v.storyMemorySource==='worldbook' && (!v.memoryBook||!v.memoryEntry))throw new Error('请选择世界书及记忆条目。');
                Object.assign(this.state.settings,{includeTags:v.includeTags||'',excludeTags:v.excludeTags||'',regexIds:v.regexIds||[],regexCapture:clamp(v.regexCapture,0,20,1),storyMemorySource:v.storyMemorySource==='worldbook'?'worldbook':'baibai',memoryBook:v.memoryBook||'',memoryEntry:v.memoryEntry||''});
                this.ui.resetDraft();await this.save();await this.syncCurrentStory();this.render();this.ui.notice('读取设置已保存，主线会自动跟随最新内容。');return;
            }
            if(name==='save-summary-settings') {const v=this.ui.values();const every=clamp(v.summaryEvery,16,200,40);Object.assign(this.state.settings,{autoSummary:Boolean(v.autoSummary),summaryEvery:every,summaryKeep:clamp(v.summaryKeep,4,Math.min(60,every-2),12),});this.ui.resetDraft(['autoSummary','summaryEvery','summaryKeep']);await this.save();this.render();this.ui.notice('总结设置已保存。');return;}
            if(name==='save-notifications' || name==='preview-sound') {
                const v=this.ui.values();const preferences=notificationPreferences({notificationTone:v.notificationTone,notificationVolume:Number(v.notificationVolume)/100});
                if(name==='preview-sound'){if(!await this.sound.play(preferences))this.ui.notice('当前浏览器未能播放提示音，请点击试听重试。',true);return;}
                Object.assign(this.state.settings,preferences);this.ui.resetDraft(['notificationTone','notificationVolume']);await this.save();this.render();this.ui.notice('消息提醒已保存。');return;
            }
            if(name==='save-prompts'){const v=this.ui.values();Object.assign(this.state.settings,{headPrompt:v.headPrompt ?? HEAD_PROMPT,aiPrompt:v.aiPrompt ?? AI_PROMPT});this.ui.resetDraft(['headPrompt','aiPrompt']);await this.save();this.render();this.ui.notice('头部和 AI 提示词已保存。');return;}
            if(name==='reset-prompts'){for(const [key,value] of [['headPrompt',HEAD_PROMPT],['aiPrompt',AI_PROMPT]]){const input=this.ui.content.querySelector(`[name="${key}"]`);if(input)input.value=value;}this.ui.capture();this.ui.notice('已填入默认提示词，保存后生效。');return;}
            const{p,t}=this.current(this.ui.tab==='roles' && ['save-profile','delete-profile'].includes(name)?this.ui.editorId:this.state.selected); const v=this.ui.values();
            if(name==='save-profile') {if(!String(v.name ?? p.name).trim())throw new Error('请填写角色姓名。');const mode=(v.personaMode ?? p.personaMode)==='inherit'?'inherit':'manual';if(mode==='inherit' && !p.binding)throw new Error('请先从角色卡或条目建立设定来源。');const changed={...normalizeProfile({...p,...v,personaMode:mode},p),id:p.id,manuallyEdited:true};await this.refreshProfile(changed);Object.assign(p,changed);this.ui.resetDraft();await this.save();this.ui.contactPage='detail';this.render();this.ui.notice('角色资料已保存。');return;}
            if(name==='delete-profile') {if(!confirm(`删除 ${p.name} 的资料、meta 聊天和批注？`))return;if(this.session?.profileId===p.id){this.session=null;this.updatePresence();}this.state.profiles=this.state.profiles.filter(x=>x.id!==p.id);this.state.threads=this.state.threads.filter(x=>x.profileId!==p.id);for(const key of ['momentRoles','momentCommentRoles','diaryRoles','diaryCommentRoles'])this.state.social.settings[key]=this.state.social.settings[key].filter(id=>id!==p.id);for(const key of Object.keys(this.state.social.schedules))if(key.endsWith(':'+p.id))delete this.state.social.schedules[key];if(this.state.selected===p.id)this.state.selected=this.state.profiles[0]?.id || '';this.ui.contactPage='list';this.ui.editorId='';this.ui.contactReturn='';await this.save();this.render();return;}
            if(name==='save-memory') {t.memory.text=v.memory || '';if(!t.memory.text)t.memory.throughId='';this.ui.resetDraft(['memory']);await this.save();this.render();this.ui.notice('记忆已保存。');return;}
            if(name==='summarize') {await this.summarize();return;}
            if(name==='delete-message') {if(!confirm('删除这条 meta 消息？涉及已整理内容时会清空对应摘要，之后可重新整理。'))return;removeMessage(t,args.id);await this.save();this.render();return;}
            if(name==='annotate') {const floor=t.story?.floors.find(f=>f.index===Number(args.index));if(!floor)throw new Error('这段正文已不在当前观看记录中。');await this.reply('annotation',floor.body);return;}
            if(name==='send') {if(!v.draft?.trim())return;await this.reply('chat','',null,v.draft.trim());return;}
            if(name==='retry') {if(!t.messages.length)throw new Error('先发一条消息。');const last=t.messages[t.messages.length-1];await this.reply(['poke','proactive','theatre'].includes(last.kind)?last.kind:'chat','',null,null,true);return;}
            if(name==='theatre') {if(!v.scene?.trim())throw new Error('先给小剧场写一个场景。');const scene=v.scene.trim();this.ui.clearDraft('scene');this.ui.tab='chat';this.ui.chatPage='thread';await this.reply('theatre','',null,`[Meta 小剧场]\n我们在这里演一段独立的小场景：${scene}\n保持双方人设与关系，你开始。`);return;}
            if(name==='start-company') {if(this.session)await this.action('stop-company');const s=this.state.settings;s.activity=v.activity?.trim() || '待一会儿';this.session={id:uid(),profileId:p.id,activity:s.activity,elapsed:0,runningSince:0};addMessage(t,'note',`开始一起${s.activity}。`);this.updatePresence();await this.save();this.render();this.ui.notice('已开始陪伴。你可以切到聊天页随时说话。');return;}
            if(name==='nudge') {await this.reply('proactive');return;}
        } catch(error) {console.error('[映间]',error);this.log(name+' · '+(error?.message || String(error)),'error');await this.save();this.ui.notice(error?.message || String(error),true);this.render();}
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
    destroy() {this.disposed=true;this.storyRevision++;clearTimeout(this.syncTimer);clearTimeout(this.autoTimer);clearTimeout(this.qrTimer);clearTimeout(this.timer);clearInterval(this.clockTimer);this.sound.destroy();this.social.destroy();this.proactive.destroy();window.removeEventListener('focus',this.readListener);this.ui.root.removeEventListener('scroll',this.readListener,true);document.removeEventListener('visibilitychange',this.visibility);this.unlisten?.();this.menuObserver?.disconnect();this.ui.destroy();this.settingsButton?.remove();this.wandButton?.remove();}
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
