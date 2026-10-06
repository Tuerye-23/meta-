import { createIndependentClient } from './api.js';
import { characterKey, chunkSources, extractRegexStory, filterStory, literalMacros, mainKey, replaceNames, sourceFingerprint, text, uid, validateBackup, freshState } from './core.js';

export function createHost(root = globalThis) {
    const context = () => {
        const ctx = root.SillyTavern?.getContext?.();
        if (!ctx) throw new Error('尚未取得酒馆接口，请等待酒馆加载完成。');
        return ctx;
    };
    const independent=createIndependentClient(root,context);
    let hostBusy = false;
    const listeners = [];
    let regexModule;
    let worldModule;
    const enabledRegexes = async () => {
        const c=context();
        if(c.extensionSettings?.disabledExtensions?.includes('regex')) return [];
        const engine=typeof c.getRegexScripts==='function' ? c : await (regexModule ??= import('/scripts/extensions/regex/engine.js').catch(()=>null));
        if(!engine?.getRegexScripts) throw new Error('未能读取酒馆正则列表，请确认正则扩展已启用。');
        return engine.getRegexScripts({allowedOnly:true}).filter(s=>!s.disabled && s.findRegex && Array.isArray(s.placement) && s.placement.some(p=>p===1||p===2)).map((s,i)=>({...s,id:String(s.id || `legacy:${i}:${s.scriptName}`)}));
    };
    return {
        context,
        get busy() { return hostBusy || Boolean(context().streamingProcessor && !context().streamingProcessor.isFinished); },
        initEvents(onChange) {
            const c = context();
            for (const name of ['APP_READY', 'APP_INITIALIZED', 'EXTENSIONS_FIRST_LOAD', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'WORLDINFO_UPDATED', 'SETTINGS_UPDATED', 'PRESET_CHANGED']) {
                const type = c.eventTypes?.[name]; if (!type) continue;
                const fn = (...args) => { if (name === 'GENERATION_STARTED' && args[2] === true) return; if (name === 'GENERATION_STARTED') hostBusy = true; if (name === 'GENERATION_ENDED' || name === 'GENERATION_STOPPED') hostBusy = false; onChange(name); };
                c.eventSource?.on(type, fn); listeners.push(() => c.eventSource?.removeListener(type, fn));
            }
            return () => listeners.splice(0).forEach(fn => fn());
        },
        async generate(request,api={mode:'host'}) {
            if(api.mode==='independent')return independent.generate(request,api);
            const c=context();
            if(this.busy)throw new Error('主线正在生成，请等这一轮结束。');
            if(typeof c.generateRaw!=='function')throw new Error('当前酒馆没有 generateRaw 接口。');
            const result=await c.generateRaw({...request,systemPrompt:literalMacros(request.systemPrompt),prompt:request.prompt.map(m=>({...m,content:literalMacros(m.content)})),trimNames:false});
            if(typeof result!=='string' || !result.trim())throw new Error('模型没有返回有效文字。');
            return result.trim();
        },
        models(api) {return independent.models(api);},
        async saveQRSet(set) {
            const c=context();
            if(typeof set?.toJSON==='function' && typeof c.getRequestHeaders==='function' && typeof root.fetch==='function') {
                // QR's native save method logs HTTP errors but does not reject them.
                const response=await root.fetch('/api/quick-replies/save',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(set)});
                if(!response.ok)throw new Error(`QR 按钮保存失败（${response.status}），稍后重试。`);
                set.rerender?.();
            } else if(typeof set?.save==='function')await set.save();
        },
        async currentDefinitions() {
            const c=context(),originKey=characterKey(c),sourceKey=mainKey(c);
            if(!originKey)return null;
            const group=c.groupId!=null && c.groupId!=='' ? c.groups?.find(g=>String(g.id)===String(c.groupId)) : null;
            const ids=group?(group.members || []).map(avatar=>c.characters.findIndex(card=>card.avatar===avatar)).filter(i=>i>=0):[Number(c.characterId)];
            if((c.groupId!=null && c.groupId!=='' && !group) || !ids.length)return null;
            const data=await this.definitions(ids,[],false,true);
            if(characterKey(context())!==originKey || mainKey(context())!==sourceKey)throw new Error('聊天已切换，取消旧人物素材读取。');
            return {...data,originKey,fingerprint:sourceFingerprint([data.cards,data.entries,data.userName,data.userPersona])};
        },
        async definitions(cardIds,books=[],includeDisabled=false,autoBooks=false) {
            const c=context(),sourceKey=mainKey(c),cards=[],embedded=[],selections=[...books];
            const wi=autoBooks ? c.worldInfo || (await (worldModule ??= import('/scripts/world-info.js').catch(()=>null)))?.world_info : null;
            for(const id of cardIds) {
                if(typeof c.unshallowCharacter==='function')await c.unshallowCharacter(Number(id));
                const card=context().characters[Number(id)];
                if(!card)throw new Error('所选角色卡已不存在，请重新选择。');
                const d=card.data || card, name=d.name || card.name || '未命名角色';
                const get=key=>text(d[key] ?? card[key]);
                const linked=[];
                if(autoBooks) {
                    const primary=d.extensions?.world || card.extensions?.world;
                    if(primary)linked.push({name:primary,ids:null});
                    for(const book of wi?.charLore?.find(e=>e.name===card.avatar?.replace(/\.[^.]+$/,''))?.extraBooks || [])linked.push({name:book,ids:null});
                    if(c.chatMetadata?.world_info)linked.push({name:c.chatMetadata.world_info,ids:null});
                    selections.push(...linked);
                }
                cards.push({name,avatar:card.avatar || '',description:get('description'),personality:get('personality'),scenario:get('scenario'),examples:get('mes_example'),sourceText:['description','personality','scenario','mes_example'].map(key=>get(key)?`[${key}]\n${get(key)}`:'').filter(Boolean).join('\n\n'),binding:{avatar:card.avatar || '',autoBooks,books:books.map(b=>({...b})),includeDisabled},linkedBooks:linked.map(b=>b.name)});
                for(const [key,e] of Object.entries(d.character_book?.entries || {})) {
                    if(!includeDisabled && (e.disable || e.enabled===false))continue;
                    if(e.content)embedded.push({id:String(e.uid ?? e.id ?? key),label:`${name} 内嵌世界书 / ${e.comment || e.name || (e.keys || []).join('、') || key}`,content:text(e.content),position:e.position ?? e.extensions?.position ?? 'before_char',order:Number(e.insertion_order ?? e.order)||0,avatar:card.avatar || '',book:''});
                }
            }
            const entries=[...embedded];
            const merged=new Map();
            for(const b of selections) {
                if(!b.name)continue;
                if(!merged.has(b.name))merged.set(b.name,b.ids===null?null:new Set(b.ids || []));
                else if(b.ids===null)merged.set(b.name,null);
                else if(merged.get(b.name))for(const id of b.ids || [])merged.get(b.name).add(id);
            }
            for(const [book,ids] of merged) {
                const available=await this.memoryEntries(book);
                if(ids && [...ids].some(id=>!available.some(e=>e.id===id)))throw new Error('所选世界书条目已不存在，请重新选择。');
                for(const e of available) {
                    if(ids && !ids.has(e.id) || !includeDisabled && e.disabled)continue;
                    if(e.content)entries.push({...e,label:`世界书 ${book} / ${e.name}`,book,avatar:''});
                }
            }
            entries.sort((a,b)=>b.order-a.order);
            const sources=[...cards.filter(card=>card.sourceText).map(card=>({label:`角色卡 ${card.name}`,text:card.sourceText})),...entries.map(e=>({label:e.label,text:e.content}))];
            if(!sources.length)throw new Error('没有读到有效设定，请检查所选条目及启用状态。');
            if(sources.reduce((n,e)=>n+e.text.length,0)>150000)throw new Error('所选设定超过 15 万字符，请分批选择。');
            if(mainKey(context())!==sourceKey)throw new Error('读取设定期间聊天已切换，请重试。');
            return {cards,entries,sources,sourceKey,userName:c.name1 || '用户',userPersona:text(c.powerUserSettings?.persona_description)};
        },
        async linkedDefinition(profile) {
            const binding=profile.binding;
            if(!binding)throw new Error('这个联系人没有绑定设定来源，请重新选择来源或改用独立人设。');
            let ids=[];
            if(binding.avatar) {
                const id=context().characters.findIndex(card=>card.avatar===binding.avatar);
                if(id<0)throw new Error('绑定的角色卡已不存在，请重新选择来源或改用独立人设。');
                ids=[id];
            }
            return this.definitions(ids,binding.books,binding.includeDisabled,binding.autoBooks);
        },
        async currentSources() {
            const ctx=context(); const originKey=characterKey(ctx); const sourceKey=mainKey(ctx);
            if(!originKey)return null;
            const group=ctx.groupId!=null ? ctx.groups?.find(g=>String(g.id)===String(ctx.groupId)) : null;
            const cards=group ? (group.members || []).map(avatar=>ctx.characters.findIndex(c=>c.avatar===avatar)).filter(id=>id>=0) : [Number(ctx.characterId)];
            if((ctx.groupId!=null && ctx.groupId!=='' && !group) || !cards.length)return null;
            for(const id of cards)if(typeof ctx.unshallowCharacter==='function')await ctx.unshallowCharacter(id);
            if(characterKey(context())!==originKey || mainKey(context())!==sourceKey)throw new Error('聊天已切换，取消旧人物素材读取。');
            const wi=ctx.worldInfo || (await (worldModule ??= import('/scripts/world-info.js').catch(()=>null)))?.world_info;
            const books=new Set();
            for(const id of cards) {
                const card=context().characters[id];
                const primary=card?.data?.extensions?.world || card?.extensions?.world;
                if(primary)books.add(primary);
                const fileName=card?.avatar?.replace(/\.[^.]+$/,'');
                const extra=wi?.charLore?.find(e=>e.name===fileName)?.extraBooks || [];
                for(const name of extra)if(name)books.add(name);
            }
            if(ctx.chatMetadata?.world_info)books.add(ctx.chatMetadata.world_info);
            const data=await this.sources(cards.map(String),[...books]);
            if(characterKey(context())!==originKey || mainKey(context())!==sourceKey)throw new Error('聊天已切换，取消旧人物素材读取。');
            return {...data,originKey,fingerprint:sourceFingerprint([data.sources,data.userName,data.userPersona])};
        },
        async sources(cardIds, books, includeDisabled = false) {
            const ctx = context(); const sourceKey=mainKey(ctx); const sources = [];
            const user = ctx.name1 || '用户';
            const persona = ctx.powerUserSettings?.persona_description || '';
            for (const id of cardIds) {
                if (typeof ctx.unshallowCharacter === 'function') await ctx.unshallowCharacter(Number(id));
                const card = context().characters[Number(id)];
                if (!card) throw new Error('所选角色卡已不存在，请重新选择。');
                const data = card.data || card; const name = data.name || card.name || '角色卡';
                const body = ['description', 'personality', 'scenario', 'mes_example', 'first_mes'].map(key => [key, data[key] ?? card[key]]).filter(([,v]) => typeof v === 'string' && v.trim()).map(([key,v]) => `${key}:\n${v}`).join('\n\n');
                if (body) sources.push({ label: `角色卡 ${name}`, text: replaceNames(body, user, name) });
                const entries = data.character_book?.entries;
                if (entries) for (const e of Object.values(entries)) {
                    if (!includeDisabled && (e.disable || e.enabled === false)) continue;
                    if (e.content) sources.push({ label: `${name} 内嵌世界书 / ${e.comment || e.name || (e.keys || []).join('、') || '条目'}`, text: replaceNames(e.content, user, name) });
                }
            }
            for (const book of books) {
                if (typeof ctx.loadWorldInfo !== 'function') throw new Error('当前酒馆不支持读取世界书。');
                const data = await ctx.loadWorldInfo(book);
                if (!data?.entries) throw new Error(`世界书“${book}”读取失败。`);
                for (const e of Object.values(data.entries)) {
                    if (!includeDisabled && (e.disable || e.enabled === false)) continue;
                    if (e.content) sources.push({ label: `世界书 ${book} / ${e.comment || e.name || (e.key || []).join('、') || '条目'}`, text: replaceNames(e.content, user, ctx.name2 || '角色') });
                }
            }
            if (persona) sources.push({ label: `用户设定 ${user}`, text: persona });
            if (!sources.length) throw new Error('没有读到有效设定，请选择角色卡或世界书。');
            const length = sources.reduce((n,s) => n+s.text.length, 0);
            if (length > 150000) throw new Error('选中的素材超过 15 万字符，请分批选择后提取。');
            if(mainKey(context())!==sourceKey)throw new Error('读取设定期间聊天已切换，请重试。');
            return { sources, chunks: chunkSources(sources), userName: user, userPersona: persona, sourceKey };
        },
        enabledRegexes,
        async memoryEntries(book) {
            if(!book) return [];
            const c=context();
            if(typeof c.loadWorldInfo!=='function') throw new Error('当前酒馆不支持读取世界书。');
            const data=await c.loadWorldInfo(book);
            if(!data?.entries) throw new Error(`世界书“${book}”读取失败。`);
            return Object.entries(data.entries).map(([key,e])=>({id:String(e.uid ?? key),name:e.comment || e.name || (e.key || e.keys || []).join('、') || `条目 ${e.uid ?? key}`,content:text(e.content),disabled:Boolean(e.disable || e.enabled===false),position:e.position ?? e.extensions?.position ?? 0,order:Number(e.order ?? e.insertion_order)||0}));
        },
        async story(settings) {
            const ctx = context(); const key = mainKey(ctx); const chat = ctx.chat || [];
            if (!key || !chat.length) throw new Error('请先打开一个有正文的主线聊天。');
            const end = chat.length - 1;
            const api = root.STBaiBaiBook;
            const available = settings.storyMemorySource !== 'worldbook' && api?.apiVersion === 1;
            const start = Math.max(0, end - settings.recentFloors + 1);
            const warnings = []; const sections = []; const floors = [];
            if(settings.storyMemorySource === 'worldbook') {
                if(!settings.memoryBook || !settings.memoryEntry) throw new Error('请选择作为正文剧情记忆的世界书和条目。');
                const entries=await this.memoryEntries(settings.memoryBook);
                const entry=entries.find(e=>e.id===settings.memoryEntry);
                if(!entry) throw new Error('所选剧情记忆条目已不存在，请重新选择。');
                sections.push(`[正文剧情记忆 / ${settings.memoryBook} / ${entry.name}]\n`+replaceNames(entry.content,ctx.name1||'你',ctx.name2||'角色'));
            } else if (available) {
                try {
                    const h = await api.getHistory({ before: start });
                    if (h.text) sections.push('[更早的剧情摘要]\n' + h.text);
                    if (h.coverage?.complete === false) warnings.push('早期记忆有缺口');
                    const s = await api.getSnapshot({ floor: end, at: 'after' });
                    sections.push('[该平行世界此时的状态]\n' + JSON.stringify({ state: s.state, protagonist: s.protagonist, npcs: s.npcs, vars: s.vars, lifeDetails: s.lifeDetails }));
                    if (s.coverage?.complete === false) warnings.push('当前摘要尚未完全覆盖正文');
                } catch (error) { warnings.push('柏宝书记忆读取失败：' + (error?.message || String(error))); }
            } else warnings.push('柏宝书公开接口未就绪，本次读取最近正文');
            const selectedIds=settings.regexIds || [];
            const regexes=selectedIds.length ? (await enabledRegexes()).filter(s=>selectedIds.includes(s.id)) : [];
            const missing=selectedIds.filter(id=>!regexes.some(s=>s.id===id));
            if(missing.length) throw new Error('所选正文正则已关闭或不在当前卡 / 预设中，请刷新列表并重新选择。');
            for (let index = start; index <= end; index++) {
                const message = chat[index]; if (message.is_system) continue;
                let body = text(message.mes);
                // Always filter original prose: BaiBai's floor cleaner may remove tags needed for extraction.
                body=filterStory(body,{...settings,includeTags:''});
                const applicable=regexes.filter(s=>s.placement.includes(message.is_user?1:2) && (s.minDepth==null || Number(s.minDepth)<0 || end-index>=Number(s.minDepth)) && (s.maxDepth==null || Number(s.maxDepth)<0 || end-index<=Number(s.maxDepth)));
                if(regexes.length && !message.is_user) body=applicable.length ? extractRegexStory(body,applicable,settings.regexCapture) : '';
                else if(applicable.length) body=extractRegexStory(body,applicable,settings.regexCapture);
                body=filterStory(body,{...settings,includeTags:message.is_user?'':settings.includeTags});
                if (body) floors.push({ index, name: text(message.name) || (message.is_user ? ctx.name1 : ctx.name2), body });
            }
            const label = `${ctx.name2 || '群聊'} · ${ctx.getCurrentChatId?.() || ctx.chatId} · 至第 ${end + 1} 条`;
            // Recent dialogue comes first, so a bounded request keeps the most relevant scene.
            const body = '[最近正文]\n' + floors.map(f => `第 ${f.index + 1} 条 / ${f.name}\n${f.body}`).join('\n\n') + '\n\n' + sections.join('\n\n') + (warnings.length ? '\n\n[读取情况]\n' + [...new Set(warnings)].join('；') : '');
            if(mainKey(context()) !== key) throw new Error('读取期间主线已切换，请重新同步。');
            return { key, label, text: body, proseText:floors.map(f=>`第 ${f.index+1} 条 / ${f.name}\n${f.body}`).join('\n\n'),memoryText:sections.join('\n\n')+(warnings.length?'\n[读取情况] '+warnings.join('；'):''), cutoff: end, capturedAt: Date.now(), frozen:false, floors, memorySource:settings.storyMemorySource || 'baibai', warnings:[...new Set(warnings)] };
        },
        bbsStatus() {
            const b = root.STBaiBaiBook;
            return b?.apiVersion === 1 ? `柏宝书 ${b.pluginVersion || ''} 已连接` : '柏宝书未就绪 · 可直接读取正文';
        },
    };
}

// Native IndexedDB covers hosts that do not expose localforage, including photo-heavy saves.
async function nativeStateDatabase(root) {
    if(!root.indexedDB?.open)return null;
    const db=await new Promise((resolve,reject)=>{
        const request=root.indexedDB.open('st-meta-companion-native',1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('state'))request.result.createObjectStore('state');};
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error || new Error('无法打开映间存储。'));
        request.onblocked=()=>reject(new Error('映间存储升级被其他窗口阻挡。'));
    });
    db.onversionchange=()=>db.close();
    const transaction=(key,value,write)=>new Promise((resolve,reject)=>{
        const tx=db.transaction('state',write?'readwrite':'readonly');const store=tx.objectStore('state');
        const request=write?store.put(value,key):store.get(key);let result;
        request.onsuccess=()=>{result=request.result;};
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error || request.error || new Error('存储未完成。'));tx.onerror=()=>reject(tx.error || request.error || new Error('存储失败。'));
    });
    return {getItem:key=>transaction(key,undefined,false),setItem:(key,value)=>transaction(key,value,true)};
}

export class StateStore {
    constructor(host, root = globalThis) { this.host = host; this.root = root; this.db = null; this.key = ''; this.queue = Promise.resolve(); }
    async init() {
        const c = this.host.context(); const storage = c.accountStorage || this.root.localStorage;
        let scope = storage.getItem('meta-companion:scope');
        if (!scope) { scope = uid(); storage.setItem('meta-companion:scope', scope); }
        this.key = 'meta-companion:state:' + scope;
        const lf = this.root.SillyTavern?.libs?.localforage || this.root.localforage;
        if (lf?.createInstance) this.db = lf.createInstance({ name: 'st-meta-companion', storeName: 'state' });
        else {try{this.db=await nativeStateDatabase(this.root);}catch(error){console.warn('[映间] IndexedDB 不可用，使用普通存储。',error?.message);}}
        const stored=this.db ? await this.db.getItem(this.key) : null;
        const raw=stored ?? this.root.localStorage.getItem(this.key);
        if (!raw) return freshState();
        const state=validateBackup(typeof raw === 'string' ? JSON.parse(raw) : raw);
        if(this.db && stored==null)await this.db.setItem(this.key,state);
        return state;
    }
    save(state) {
        const snapshot = JSON.parse(JSON.stringify(state));
        const job = this.queue.catch(() => {}).then(async () => {
            if (this.db) await this.db.setItem(this.key, snapshot);
            else this.root.localStorage.setItem(this.key, JSON.stringify(snapshot));
        });
        this.queue = job; return job;
    }
}
