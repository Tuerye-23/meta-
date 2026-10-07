import { mainKey, newThread, normalizeProfile } from './core.js';
import { definitionProfile, recognitionRequest, parseRecognizedNames, personaRequest, parsePersonas } from './persona.js';
import { chatPreferences } from './chat-mode.js';
import { proactivePreferences, reserveProactive } from './proactive.js';

export class ContactsController {
    constructor(app){this.app=app;this.revision=0;this.recognition=null;}
    get ui(){return this.app.ui;}
    person(){const p=this.app.state.profiles.find(p=>p.id===this.ui.editorId);if(!p)throw new Error('联系人已不存在，请返回列表。');return p;}
    back(){
        this.revision++;
        const ui=this.ui;ui.capture();
        if(ui.contactPage==='list'){ui.tab='home';return;}
        if(ui.contactPage==='chatMode'){ui.contactPage='detail';return;}
        if(ui.contactPage==='picker'){ui.contactPage=['supplements','supplementEntries'].includes(ui.pickerKind)?'supplements':'add';return;}
        if(ui.contactPage==='field'){ui.contactPage=['world','notes'].includes(ui.contactField)?'supplements':['personality','scenario','speech','relationship','userPersona'].includes(ui.contactField)?'field':'detail';if(ui.contactPage==='field')ui.contactField='description';return;}
        if(ui.contactPage==='supplements')ui.contactPage='detail';
        else if(ui.contactPage==='candidates')ui.contactPage='add';
        else {ui.contactPage='list';ui.editorId='';}
    }
    async picker(kind,index) {
        const ui=this.ui,app=this.app;ui.capture();const revision=++this.revision;
        let entries=[],selection=[];
        if(kind==='cards')selection=[...(ui.sourceDraft.cards || [])];
        if(kind==='book')selection=ui.sourceDraft.personaBook?[ui.sourceDraft.personaBook]:[];
        if(kind==='entries') {if(!ui.sourceDraft.personaBook)throw new Error('请先选择世界书。');entries=await app.host.memoryEntries(ui.sourceDraft.personaBook);selection=[...(ui.sourceDraft.personaEntries || [])];}
        if(kind==='supplements')selection=ui.supplementDraft.map(b=>b.name);
        if(kind==='supplementEntries') {const b=ui.supplementDraft[Number(index)];if(!b)throw new Error('请重新选择世界书。');entries=await app.host.memoryEntries(b.name);selection=b.ids===null?entries.filter(e=>!e.disabled).map(e=>e.id):[...b.ids];}
        if(revision!==this.revision || app.disposed || ui.tab!=='roles')return;
        ui.pickerEntries=entries;ui.pickerSelection=selection;ui.pickerKind=kind;ui.pickerIndex=Number(index);ui.contactPage='picker';app.render();
    }
    async identify() {
        const app=this.app,ui=this.ui,source=ui.sourceDraft;
        const cards=ui.contactSource==='card'?(source.cards || []):[];
        const books=ui.contactSource==='book' && source.personaBook?[{name:source.personaBook,ids:[...(source.personaEntries || [])]}]:[];
        if(!cards.length && !books[0]?.ids.length)throw new Error('请先选择角色卡或世界书条目。');
        await app.job(cards.length?'正在读取联系人…':'正在识别条目中的人物…',async()=>{
            const origin=mainKey(app.host.context()),revision=++this.revision;
            const data=await app.host.definitions(cards,books,books.length>0,false);
            let candidates;
            if(cards.length)candidates=data.cards.map(card=>({name:card.name,profile:definitionProfile(card,[],data.userName,data.userPersona)}));
            else {
                const raw=await app.host.generate(recognitionRequest(data.sources,app.state.settings,data.userName),app.state.settings.api);
                const names=parseRecognizedNames(raw);candidates=names.map(name=>({name}));
            }
            if(app.disposed || revision!==this.revision || mainKey(app.host.context())!==origin)throw new Error('聊天或来源已切换，请重新选择。');
            this.recognition={data,books,origin,candidates,sourceKey:JSON.stringify([ui.contactSource,source.cards,source.personaBook,source.personaEntries])};
            ui.contactCandidates=candidates;ui.candidateSelection=[];
            // Navigation made while the request was running is respected.
            if(ui.tab==='roles' && ui.contactPage==='add')ui.contactPage='candidates';
        });
    }
    async create() {
        const app=this.app,ui=this.ui,r=this.recognition;
        if(!r || JSON.stringify([ui.contactSource,ui.sourceDraft.cards,ui.sourceDraft.personaBook,ui.sourceDraft.personaEntries])!==r.sourceKey)throw new Error('来源已变化，请重新识别人物。');
        const chosen=ui.candidateSelection.map(i=>r.candidates[i]).filter(Boolean);if(!chosen.length)throw new Error('请至少选择一个人物。');
        await app.job('正在建立联系人…',async()=>{
            let profiles;
            if(chosen.every(c=>c.profile))profiles=chosen.map(c=>c.profile);
            else {
                const binding={avatar:'',books:r.books,autoBooks:false,includeDisabled:true};
                if(r.candidates.length===1)profiles=[{name:chosen[0].name,description:r.data.entries.map(e=>e.content).join('\n\n'),personaMode:'inherit',binding}];
                else {
                    const names=chosen.map(c=>c.name),raw=await app.host.generate(personaRequest(names,r.data.sources,app.state.settings,r.data.userName),app.state.settings.api);
                    profiles=parsePersonas(raw,names,r.candidates.map(c=>c.name)).map(p=>({...p,personaMode:'extracted',binding}));
                }
                profiles=profiles.map(p=>({...p,userName:r.data.userName,userPersona:r.data.userPersona,sourceText:r.data.sources.map(s=>s.text).join('\n\n')}));
            }
            if(app.disposed || mainKey(app.host.context())!==r.origin)throw new Error('聊天已切换，未保存联系人，请重新选择。');
            const normalized=profiles.map(p=>normalizeProfile({...p,supplementalBooks:[]},{sources:r.data.sources.map(s=>s.label),sourceKey:r.data.sourceKey}));
            // Reading a manually selected disabled entry does not make an existing contact a new person.
            const sameBinding=(a,b)=>JSON.stringify(a && {...a,includeDisabled:false})===JSON.stringify(b && {...b,includeDisabled:false});
            const matches=normalized.map(p=>app.state.profiles.find(old=>old.name===p.name && old.personaMode===p.personaMode && sameBinding(old.binding,p.binding)));
            if(app.state.profiles.length+matches.filter(p=>!p).length>200)throw new Error('联系人最多 200 位，请先删除不用的联系人。');
            let first;
            for(const [i,p] of normalized.entries()){const existing=matches[i];if(!existing){app.state.profiles.push(p);app.state.threads.push(newThread(p.id));}else if(p.binding?.includeDisabled)existing.binding.includeDisabled=true;first ??=existing?.id || p.id;}
            if(!app.state.selected)app.state.selected=first;
            ui.contactPage='list';ui.editorId='';app.ui.notice(`已添加 ${chosen.length} 位联系人。`);app.queueStorySync();
        });
    }
    async handle(name,args) {
        if(!name.startsWith('contact-') && name!=='save-supplements')return false;
        const app=this.app,ui=this.ui;ui.capture();
        // Detail navigation is allowed during generation; mutations are locked.
        if(name==='contact-open'){this.revision++;ui.editorId=args.id;ui.contactPage='detail';app.render();return true;}
        if(name==='contact-field'){ui.contactField=args.field;ui.contactPage='field';app.render();return true;}
        if(name==='contact-mode'){return true;}
        if(name==='contact-supplements'){ui.supplementDraft=this.person().supplementalBooks.map(b=>({...b,ids:b.ids===null?null:[...b.ids]}));ui.contactPage='supplements';app.render();return true;}
        if(app.busy)throw new Error('上一项任务仍在进行，请稍等。');
        if(name==='contact-mode-save'){
            const p=this.person(),values=ui.values(),preferences=proactivePreferences(values);
            if(preferences.proactiveEnabled && (!Number.isFinite(Number(values.proactiveHours)) || Number(values.proactiveHours)<.5 || Number(values.proactiveHours)>720))throw new Error('发送间隔请填写 0.5～720 小时。');
            if(preferences.proactiveEnabled && (!Number.isInteger(Number(values.proactiveDaily)) || Number(values.proactiveDaily)<1 || Number(values.proactiveDaily)>100))throw new Error('每日次数请填写 1～100 的整数。');
            const reset=p.proactiveEnabled!==preferences.proactiveEnabled || p.proactiveHours!==preferences.proactiveHours;
            Object.assign(p,chatPreferences(values),preferences);
            const t=app.state.threads?.find(t=>t.profileId===p.id);
            if(t)reserveProactive(p,t,Date.now(),reset);
            ui.resetDraft(['replyStyle','replyRange','proactiveEnabled','proactiveHours','proactiveDaily']);await app.save();
            if(ui.chatModeDirect){ui.tab='chat';ui.chatPage='thread';ui.contactReturn='';ui.chatModeDirect=false;}else ui.contactPage='detail';
            app.render();ui.notice('聊天设置已保存。');return true;
        }
        if(name==='contact-add'){ui.contactPage='add';ui.contactCandidates=[];ui.candidateSelection=[];this.recognition=null;}
        if(name==='contact-source'){this.revision++;this.recognition=null;ui.contactSource=args.value;if(args.value==='manual'){ui.contactSource='card';await app.action('add-profile');return true;}}
        if(name==='contact-picker'){await this.picker(args.kind,args.index);return true;}
        if(name==='contact-picker-toggle'){const id=args.id;ui.pickerSelection=ui.pickerKind==='book'?[id]:ui.pickerSelection.includes(id)?ui.pickerSelection.filter(x=>x!==id):[...ui.pickerSelection,id];}
        if(name==='contact-picker-all'){
            const options=ui.pickerKind==='cards'?(app.host.context().characters || []).map((c,i)=>String(i)):ui.pickerKind==='supplements'?(app.host.context().getWorldInfoNames?.() || []):ui.pickerEntries.filter(e=>ui.pickerKind==='entries' || !e.disabled).map(e=>e.id);
            ui.pickerSelection=options.every(x=>ui.pickerSelection.includes(x))?[]:options;
        }
        if(name==='contact-picker-done'){
            const kind=ui.pickerKind,selection=[...ui.pickerSelection];this.revision++;
            if(kind==='cards')ui.sourceDraft.cards=selection;
            if(kind==='book'){ui.sourceDraft.personaBook=selection[0] || '';ui.sourceDraft.personaEntries=[];}
            if(kind==='entries')ui.sourceDraft.personaEntries=selection;
            if(kind==='supplements')ui.supplementDraft=selection.map(name=>ui.supplementDraft.find(b=>b.name===name) || {name,ids:null});
            if(kind==='supplementEntries')ui.supplementDraft[ui.pickerIndex].ids=selection;
            ui.contactPage=['supplements','supplementEntries'].includes(kind)?'supplements':'add';
            if(kind==='entries' && selection.length){await this.identify();return true;}
        }
        if(name==='contact-identify'){await this.identify();return true;}
        if(name==='contact-all')ui.candidateSelection=ui.contactCandidates.every((c,i)=>ui.candidateSelection.includes(i))?[]:ui.contactCandidates.map((c,i)=>i);
        if(name==='contact-candidate'){const i=Number(args.index);ui.candidateSelection=ui.candidateSelection.includes(i)?ui.candidateSelection.filter(x=>x!==i):[...ui.candidateSelection,i];}
        if(name==='contact-create'){await this.create();return true;}
        if(name==='save-supplements'){
            const p=this.person(),snapshot={...p,supplementalBooks:ui.supplementDraft.map(b=>({...b,ids:b.ids===null?null:[...b.ids]}))};
            await app.refreshSupplements(snapshot);Object.assign(p,snapshot);await app.save();ui.contactPage='detail';app.ui.notice('补充设定已保存。');
        }
        app.render();return true;
    }
}
