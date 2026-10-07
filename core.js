import { notificationPreferences } from './notifications.js';
import { proactivePreferences, proactiveSchedule } from './proactive.js';
import { freshSocial, normalizeSocial } from './social.js';
import { apiDefaults, normalizeApi } from './api-config.js';
import { avatarSource } from './images.js';
import { chatPreferences, shortChat, shortChatPrompt, groupStart } from './chat-mode.js';
import { HEAD_PROMPT, AI_PROMPT, TASK_PROMPT, DEFINITIONS_AFTER, STORY_PROMPT, MEMORY_PROMPT, POST_HISTORY, POKE_PROMPT, PROACTIVE_PROMPT } from './prompts.js';
export const VERSION = '0.10.2';
export const uid = () => globalThis.crypto?.randomUUID?.() || `mc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const text = value => typeof value === 'string' ? value : '';
export const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function freshState() {
    return { schema: 1, version: VERSION, social:freshSocial(), profiles: [], threads: [], logs: [], extractions: {}, selected: '', settings: {
        includeStory: true, recentFloors: 12, historyMessages: 40,
        intervalMinutes: 10, maxProactive: 3, activity: '待一会儿', headPrompt: HEAD_PROMPT, aiPrompt: AI_PROMPT,
        includeTags: '', excludeTags: '', regexIds: [], regexCapture: 1,
        storyMemorySource: 'baibai', memoryBook: '', memoryEntry: '',
        api:apiDefaults(), ...notificationPreferences(),
        autoSummary: false, summaryEvery: 40, summaryKeep: 12, summaryInstruction: '',
    } };
}

export function normalizeProfile(value, provenance = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !text(value.name).trim()) throw new Error('角色资料缺少姓名。');
    const profile = { id: uid(), name: text(value.name).trim().slice(0, 160), ...provenance };
    for (const key of ['description', 'personality', 'speech', 'relationship', 'world', 'notes', 'userName', 'userPersona', 'sourceText', 'scenario', 'worldBefore', 'worldAfter', 'sourceCharacterName']) {
        profile[key] = text(value[key] ?? provenance[key]).slice(0, key === 'sourceText' ? 170000 : 50000);
    }
    profile.personaMode = ['inherit','extracted','manual'].includes(value.personaMode) ? value.personaMode : provenance.personaMode || 'manual';
    profile.avatarImage=avatarSource(value.avatarImage ?? provenance.avatarImage);
    Object.assign(profile,chatPreferences({replyStyle:value.replyStyle ?? provenance.replyStyle,replyRange:value.replyRange ?? provenance.replyRange}));
    Object.assign(profile,proactivePreferences({proactiveEnabled:value.proactiveEnabled ?? provenance.proactiveEnabled,proactiveHours:value.proactiveHours ?? provenance.proactiveHours,proactiveDaily:value.proactiveDaily ?? provenance.proactiveDaily}));
    const binding=value.binding ?? provenance.binding;
    profile.binding=binding && typeof binding==='object' ? {avatar:text(binding.avatar),autoBooks:binding.autoBooks===true,books:Array.isArray(binding.books)?binding.books.filter(b=>typeof b?.name==='string').map(b=>({name:b.name,ids:Array.isArray(b.ids)?b.ids.filter(id=>typeof id==='string'):null})):[],includeDisabled:binding.includeDisabled===true} : null;
    const supplements=value.supplementalBooks ?? provenance.supplementalBooks;
    profile.supplementalBooks=Array.isArray(supplements)?supplements.filter(b=>typeof b?.name==='string').map(b=>({name:b.name,ids:Array.isArray(b.ids)?b.ids.filter(id=>typeof id==='string'):null})):[];
    // Old automatic bound-book material must not survive the opt-in supplement migration.
    if(!Array.isArray(supplements) && profile.personaMode==='inherit') {profile.worldBefore='';profile.worldAfter='';}
    if(profile.binding)profile.binding.autoBooks=false;
    profile.sources = Array.isArray(value.sources ?? provenance.sources) ? (value.sources ?? provenance.sources).filter(x => typeof x === 'string') : [];
    profile.sourceKey = text(provenance.sourceKey);
    return profile;
}

export function newThread(profileId) {
    return { id: uid(), profileId, messages: [], unreadIds: [], proactive:proactiveSchedule(), memory: { text: '', throughId: '' }, story: null, annotations: [] };
}

export function validateBackup(input) {
    if (input?.schema !== 1 || !Array.isArray(input.profiles) || !Array.isArray(input.threads)) throw new Error('这不是映间的有效备份。');
    if (input.profiles.length > 200 || input.threads.length > 200) throw new Error('备份中的角色数量过多。');
    const out = freshState();
    for (const p of input.profiles) {
        if (typeof p.id !== 'string' || !p.id || out.profiles.some(x => x.id === p.id)) throw new Error('备份中有重复或无效角色 ID。');
        out.profiles.push({ ...normalizeProfile(p, p), id: p.id });
    }
    const ids = new Set(out.profiles.map(p => p.id));
    for (const t of input.threads) {
        if (!ids.has(t.profileId) || typeof t.id !== 'string' || !Array.isArray(t.messages)) throw new Error('备份会话与角色不匹配。');
        if (out.threads.some(x => x.profileId === t.profileId || x.id === t.id)) throw new Error('备份中有重复会话。');
        const messages = t.messages.map(m => {
            if (!m || typeof m.id !== 'string' || !['user', 'assistant', 'note'].includes(m.role) || typeof m.text !== 'string') throw new Error('备份消息格式有误。');
            return { id: m.id, role: m.role, text: m.text, kind: text(m.kind), createdAt: Number(m.createdAt) || 0,...(m.role==='assistant' && text(m.replyId)?{replyId:text(m.replyId).slice(0,160)}:{}) };
        });
        if (new Set(messages.map(m => m.id)).size !== messages.length) throw new Error('备份中有重复消息 ID。');
        const story = t.story && typeof t.story.text === 'string' ? {
            key: text(t.story.key), label: text(t.story.label), text: t.story.text.slice(0, 200000),
            cutoff: Number(t.story.cutoff), capturedAt: Number(t.story.capturedAt) || 0, frozen: false,
            proseText:typeof t.story.proseText==='string'?t.story.proseText.slice(0,200000):undefined,memoryText:text(t.story.memoryText).slice(0,200000),
            floors: Array.isArray(t.story.floors) ? t.story.floors.filter(f => Number.isInteger(f.index) && typeof f.body === 'string').map(f => ({ index: f.index, name: text(f.name), body: f.body })) : [],
        } : null;
        out.threads.push({ id: t.id, profileId: t.profileId, messages, story,
            proactive:proactiveSchedule(t.proactive),
            unreadIds:Array.isArray(t.unreadIds)?[...new Set(t.unreadIds.filter(id=>messages.some(m=>m.id===id && m.role==='assistant')))]:[],
            memory: { text: text(t.memory?.text), throughId: messages.some(m => m.id === t.memory?.throughId) ? t.memory.throughId : '' },
            annotations: Array.isArray(t.annotations) ? t.annotations.filter(a => typeof a?.quote === 'string' && typeof a?.reply === 'string').map(a => ({ quote: a.quote, reply: a.reply, label: text(a.label), createdAt: Number(a.createdAt) || 0 })) : [],
        });
    }
    for (const p of out.profiles) if (!out.threads.some(t => t.profileId === p.id)) out.threads.push(newThread(p.id));
    out.social=normalizeSocial(input.social,[...ids]);
    out.logs=Array.isArray(input.logs)?input.logs.filter(l=>typeof l?.message==='string').slice(-200).map(l=>({createdAt:Number(l.createdAt)||0,level:l.level==='error'?'error':'info',message:l.message.slice(0,800)})):[];
    out.qrInstalled=input.qrInstalled===true;
    out.selected = ids.has(input.selected) ? input.selected : out.profiles[0]?.id || '';
    if(input.extractions && typeof input.extractions==='object') for(const [key,value] of Object.entries(input.extractions).slice(0,200)) {
        if(!value || typeof value.fingerprint!=='string' || !Array.isArray(value.profileIds))continue;
        const profileIds=value.profileIds.filter(id=>ids.has(id));
        if(profileIds.length)Object.defineProperty(out.extractions,key,{value:{fingerprint:value.fingerprint,profileIds},enumerable:true,writable:true,configurable:true});
    }
    const s = input.settings || {};
    const wasDefault=input.version!==VERSION && s.api?.maxTokens==='4096' && s.api?.timeout==='120' && !s.api?.topP && !s.api?.frequencyPenalty && !s.api?.presencePenalty && ['1',''].includes(s.api?.temperature);
    out.settings = { ...notificationPreferences(s), api:wasDefault?apiDefaults(s.api):normalizeApi(s.api),includeStory: s.includeStory !== false,
        recentFloors: clamp(s.recentFloors, 1, 60, 12), historyMessages: clamp(s.historyMessages, 4, 200, 40),
        intervalMinutes: clamp(s.intervalMinutes, 2, 120, 10), maxProactive: clamp(s.maxProactive, 1, 20, 3),
        activity: text(s.activity) || '待一会儿', headPrompt:typeof s.headPrompt==='string'?s.headPrompt.slice(0,30000):HEAD_PROMPT,aiPrompt:typeof s.aiPrompt==='string'?s.aiPrompt.slice(0,30000):AI_PROMPT,
        includeTags: text(s.includeTags), excludeTags: text(s.excludeTags),
        regexIds: Array.isArray(s.regexIds) ? [...new Set(s.regexIds.filter(x => typeof x === 'string'))].slice(0,100) : [],
        regexCapture: clamp(s.regexCapture,0,20,1),
        storyMemorySource: s.storyMemorySource === 'worldbook' ? 'worldbook' : 'baibai',
        memoryBook: text(s.memoryBook), memoryEntry: text(s.memoryEntry),
        autoSummary: s.autoSummary === true, summaryEvery: clamp(s.summaryEvery,16,200,40),
        summaryKeep: clamp(s.summaryKeep,4,Math.min(60,clamp(s.summaryEvery,16,200,40)-2),12),
        summaryInstruction: text(s.summaryInstruction),
    };
    return out;
}

export function characterKey(context) {
    if(context.groupId!==undefined && context.groupId!==null && context.groupId!=='')return 'group:'+context.groupId;
    if(context.characterId===undefined || context.characterId===null || context.characterId==='')return '';
    const card=context.characters?.[Number(context.characterId)];
    return card ? 'card:'+(card.avatar || card.name || card.data?.name || context.characterId) : '';
}

export function sourceFingerprint(sources) {
    const material=JSON.stringify(sources);
    let hash=2166136261;
    for(let i=0;i<material.length;i++)hash=Math.imul(hash^material.charCodeAt(i),16777619);
    return material.length+':'+(hash>>>0).toString(16);
}

export function tagNames(value) {
    return [...new Set(text(value).split(/[\s,，;；]+/).map(x=>x.replace(/^<\/?|>$/g,'')).filter(Boolean))].map(name=>{
        if(!/^[\p{L}\p{N}_:.-]+$/u.test(name)) throw new Error(`标签名称无效：${name}`);
        return name;
    });
}
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function tagRanges(body,name) {
    const pattern=new RegExp(`<(/?)${escapeRegex(name)}(?=[\\s/>])[^>]*>`,'giu');
    const ranges=[];let depth=0,start=0,content=0;
    for(const m of body.matchAll(pattern)) {
        if(!m[1]) {
            if(depth===0){start=m.index;content=m.index+m[0].length;}
            if(/\/\s*>$/.test(m[0])){if(depth===0)ranges.push({start,end:content,text:''});}
            else depth++;
        } else if(depth>0 && --depth===0) ranges.push({start,end:m.index+m[0].length,text:body.slice(content,m.index)});
    }
    if(depth>0)ranges.push({start,end:body.length,text:body.slice(content)});
    return ranges;
}
export function filterStory(body, settings) {
    let result=text(body);
    // Remove excluded material before extraction, including unfinished reasoning blocks.
    for(const name of [...new Set(['think','thinking','analysis','script','style',...tagNames(settings.excludeTags)])]) for(const range of tagRanges(result,name).reverse())result=result.slice(0,range.start)+result.slice(range.end);
    const include=tagNames(settings.includeTags);
    if(include.length) {
        const blocks=[];
        for(const name of include) for(const range of tagRanges(result,name)) blocks.push({at:range.start,text:range.text});
        result=blocks.sort((a,b)=>a.at-b.at).map(x=>x.text).join('\n\n');
    }
    return result.trim();
}

export function regexForStory(value) {
    const source=text(value); const literal=source.match(/^\/([\s\S]*)\/([a-z]*)$/i);
    const flags=literal ? literal[2] : '';
    return new RegExp(literal ? literal[1] : source,[...new Set(flags.replace(/y/g,'')+'g')].join(''));
}

export function extractRegexStory(body, scripts, capture=1) {
    const blocks=[];
    for(const script of scripts) {
        let regex;
        try { regex=regexForStory(script.findRegex); } catch { throw new Error(`正则“${script.scriptName || script.id}”无法解析，请检查正则设置。`); }
        for(const match of text(body).matchAll(regex)) {
            const value=match[Number(capture)];
            if(value===undefined) throw new Error(`正则“${script.scriptName || script.id}”没有第 ${capture} 个捕获组，可改选 0（完整匹配）。`);
            if(value.trim()) blocks.push({at:match.index,text:value});
        }
    }
    return blocks.sort((a,b)=>a.at-b.at).filter((v,i,a)=>!a.slice(0,i).some(x=>x.at===v.at&&x.text===v.text)).map(x=>x.text).join('\n\n').trim();
}

export function summaryBatch(thread, settings, automatic=false) {
    const through=thread.messages.findIndex(m=>m.id===thread.memory?.throughId);
    const pending=thread.messages.slice(through+1);
    if(automatic && pending.length < settings.summaryEvery) return [];
    return pending.slice(0,groupStart(pending,Math.max(0,pending.length-settings.summaryKeep)));
}

export function parseProfiles(raw) {
    const cleaned = text(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let data;
    try { data = JSON.parse(cleaned); } catch {
        // Find the first balanced JSON array/object, respecting brackets inside strings.
        for (let start = 0; start < cleaned.length && data === undefined; start++) {
            if (!'[{'.includes(cleaned[start])) continue;
            const stack = []; let quoted = false; let escaped = false;
            for (let end = start; end < cleaned.length; end++) {
                const c = cleaned[end];
                if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
                if (c === '"') { quoted = true; continue; }
                if ('[{'.includes(c)) stack.push(c);
                if (']}'.includes(c)) {
                    const open = stack.pop();
                    if ((c === ']' && open !== '[') || (c === '}' && open !== '{')) break;
                    if (!stack.length) { try { data = JSON.parse(cleaned.slice(start, end + 1)); } catch { /* try next start */ } break; }
                }
            }
        }
    }
    const list = Array.isArray(data) ? data : data?.characters;
    if (!Array.isArray(list)) throw new Error('模型没有返回角色列表，请重试或手动添加角色。');
    return list.map(p => normalizeProfile(p));
}

export function mergeProfiles(profiles) {
    const map = new Map();
    for (const p of profiles) {
        const key = p.name.normalize('NFKC').trim().toLocaleLowerCase();
        if (!map.has(key)) { map.set(key, { ...p }); continue; }
        const old = map.get(key);
        for (const field of ['description', 'personality', 'speech', 'relationship', 'world', 'notes']) {
            if (p[field] && !old[field].includes(p[field])) old[field] = [old[field], p[field]].filter(Boolean).join('\n');
        }
    }
    return [...map.values()];
}

export function replaceNames(source, user, character) {
    return text(source).replace(/\{\{user\}\}/gi, () => user).replace(/\{\{char\}\}/gi, () => character);
}

// generateRaw runs SillyTavern macros; make data macros visibly literal first.
export function literalMacros(source) {
    return text(source).replace(/\{\{/g, '｛｛').replace(/\}\}/g, '｝｝');
}

export function chunkSources(sources, limit = 12000) {
    const chunks = []; let current = '';
    for (const source of sources) {
        const label = `\n[来源：${source.label}]\n`;
        if (label.length >= limit / 2) throw new Error('来源名称过长。');
        const step = limit - label.length;
        for (let pos = 0; pos < source.text.length; pos += step) {
            const part = label + source.text.slice(pos, pos + step);
            if (current.length + part.length > limit && current) { chunks.push(current); current = ''; }
            current += part;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

export function mainKey(ctx) {
    const chat = ctx.getCurrentChatId?.() ?? ctx.chatId;
    if (!chat) return '';
    return JSON.stringify(ctx.groupId ? ['group', String(ctx.groupId), String(chat)] : ['character', ctx.characters?.[ctx.characterId]?.avatar || ctx.name2 || '', String(chat)]);
}

export function chatExamples(value,user,character,sourceName='') {
    const material=replaceNames(value,user,character);
    const names=[user,character,sourceName].filter(Boolean);
    const roles=new Map([[user,'user'],[sourceName || character,'assistant'],[character,'assistant']]);
    const prefix=new RegExp('^('+[...new Set(names)].map(escapeRegex).join('|')+')[:：][ \t]*','gm');
    const messages=[];
    for(const block of material.split(/<START>/i).filter(b=>b.trim())) {
        const matches=[...block.matchAll(prefix)];
        if(!matches.length || block.slice(0,matches[0].index).trim())return [];
        for(const [i,m] of matches.entries()) {
            const content=block.slice(m.index+m[0].length,matches[i+1]?.index ?? block.length).trim();
            if(content)messages.push({role:roles.get(m[1]),content:literalMacros(content)});
        }
    }
    return messages;
}

export function buildPrompt(profile, thread, settings, { kind = 'chat', quote = '', activity = '', elapsed = 0 } = {}) {
    const user=profile.userName || '用户';
    const bind=value=>literalMacros(replaceNames(value,user,profile.name));
    const messages=[];
    const push=(role,content)=>{if(content?.trim())messages.push({role,content:bind(content)});};
    push('assistant',settings.aiPrompt ?? AI_PROMPT);
    push('system',TASK_PROMPT);
    // These are actual Prompt Manager data slots, in their intended order.
    push('system',profile.worldBefore && '[World Info (before)]\n'+profile.worldBefore);
    push('system','[Persona Description]\n'+(profile.userPersona || '未提供详细设定'));
    push('system','[Char Description]\n'+(profile.description || '未提供详细设定'));
    push('system',profile.personality && '[Char Personality]\n'+profile.personality);
    push('system',profile.scenario && '[Scenario]\n'+profile.scenario);
    push('system',[profile.worldAfter,profile.world,profile.relationship && '双方关系：'+profile.relationship,profile.notes].filter(Boolean).join('\n\n'));
    push('system',DEFINITIONS_AFTER);
    if(profile.speech){const examples=chatExamples(profile.speech,user,profile.name,profile.sourceCharacterName);push('system','[Chat Examples / 说话方式参考，非当前聊天经历]');if(examples.length)messages.push(...examples);else push('system',profile.speech);push('system','[对白示例结束]');}
    let storyClipped=false;
    let prose='',memory='';
    if(settings.includeStory && thread.story?.text) {
        const source=thread.story.proseText ?? thread.story.text;
        prose=source;
        memory=text(thread.story.memoryText);
    }
    push('system',STORY_PROMPT+'\n\n<主线剧情记忆>\n'+memory+'\n</主线剧情记忆>\n<主线正文历史>\n'+prose+(storyClipped?'\n[记录达到发送长度限制，后续内容未提供，不要猜测。]':'')+'\n</主线正文历史>');
    const boundary=thread.messages.findIndex(m=>m.id===thread.memory?.throughId);
    const all=thread.messages.slice(boundary+1).filter(m=>['user','assistant','note'].includes(m.role));
    const selected=all.slice(groupStart(all,Math.max(0,all.length-settings.historyMessages)));
    push('system',MEMORY_PROMPT+'\n\n<Meta聊天记忆>\n'+literalMacros(thread.memory?.text || '')+'\n</Meta聊天记忆>'+(all.length>selected.length?'\n[较早的部分 Meta 消息未载入当前窗口，不要假装记得。]':''));
    if(activity)push('system',`[Meta 活动记录]\n当前一起做的事：${activity}\n已一起待了约 ${Math.floor(elapsed/60000)} 分钟。`);
    // Stored conversation is data: names and other macros in user messages stay literal.
    for(const m of selected)messages.push({role:m.role==='note'?'system':m.role,content:literalMacros(m.role==='note'?'[Meta 活动记录]\n'+m.text:m.text)});
    if(kind==='annotation')messages.push({role:'user',content:literalMacros('请对这段另一个世界的片段留一句你自己的批注：\n'+quote)});
    push('system',POST_HISTORY);
    if(kind==='proactive')push('system',PROACTIVE_PROMPT);
    if(kind==='poke')push('system',POKE_PROMPT);
    if(shortChat(profile,kind))push('system',shortChatPrompt(profile));
    if(kind==='poke') {
        // System messages may be extracted by the host/provider. Keep the actual
        // interaction as the final user turn, without inventing a typed message.
        push('user','[小手机互动：戳一戳]\n{{user}} 戳了戳 {{char}}。\n这是一条互动事件，没有附带文字消息。');
    }
    if(kind==='proactive')push('user',`[小手机事件：主动联系]\n当前本机时间：${new Date().toLocaleString('zh-CN',{hour12:false})}。\n请由 {{char}} 主动发来消息。此事件没有附带 {{user}} 的新发言。`);
    return {systemPrompt:bind(settings.headPrompt ?? HEAD_PROMPT),prompt:messages,omitted:all.length-selected.length,storyClipped};
}

export function addMessage(thread, role, content, kind = 'chat') {
    const message = { id: uid(), role, text: content, kind, createdAt: Date.now() };
    thread.messages.push(message); return message;
}

export function removeMessage(thread, id) {
    const at = thread.messages.findIndex(m => m.id === id);
    const through = thread.messages.findIndex(m => m.id === thread.memory?.throughId);
    if (at < 0) return;
    if (through >= at) thread.memory = { text: '', throughId: '' };
    thread.messages.splice(at, 1);
    if(thread.unreadIds)thread.unreadIds=thread.unreadIds.filter(messageId=>messageId!==id);
}

export function canNudge(session, now, { visible, open, busy, hostBusy, selected }) {
    return Boolean(session && visible && open && !busy && !hostBusy && selected === session.profileId && session.count < session.max && now >= session.nextAt);
}
