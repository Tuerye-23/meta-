export const VERSION = '0.2.1';
export const uid = () => globalThis.crypto?.randomUUID?.() || `mc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const text = value => typeof value === 'string' ? value : '';
export const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function freshState() {
    return { schema: 1, version: VERSION, profiles: [], threads: [], extractions: {}, selected: '', settings: {
        includeStory: true, recentFloors: 12, storyLimit: 12000, replyTokens: 800, historyMessages: 40,
        intervalMinutes: 10, maxProactive: 3, activity: '待一会儿', customInstruction: '',
        includeTags: '', excludeTags: '', regexIds: [], regexCapture: 1,
        storyMemorySource: 'baibai', memoryBook: '', memoryEntry: '',
        autoSummary: false, summaryEvery: 40, summaryKeep: 12, summaryInstruction: '',
    } };
}

export function normalizeProfile(value, provenance = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !text(value.name).trim()) throw new Error('角色资料缺少姓名。');
    const profile = { id: uid(), name: text(value.name).trim().slice(0, 160), ...provenance };
    for (const key of ['description', 'personality', 'speech', 'relationship', 'world', 'notes', 'userName', 'userPersona', 'sourceText']) {
        profile[key] = text(value[key] ?? provenance[key]).slice(0, key === 'sourceText' ? 170000 : 50000);
    }
    profile.sources = Array.isArray(provenance.sources) ? provenance.sources.filter(x => typeof x === 'string') : [];
    profile.sourceKey = text(provenance.sourceKey);
    return profile;
}

export function newThread(profileId) {
    return { id: uid(), profileId, messages: [], memory: { text: '', throughId: '' }, story: null, annotations: [] };
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
            return { id: m.id, role: m.role, text: m.text, kind: text(m.kind), createdAt: Number(m.createdAt) || 0 };
        });
        if (new Set(messages.map(m => m.id)).size !== messages.length) throw new Error('备份中有重复消息 ID。');
        const story = t.story && typeof t.story.text === 'string' ? {
            key: text(t.story.key), label: text(t.story.label), text: t.story.text.slice(0, 200000),
            cutoff: Number(t.story.cutoff), capturedAt: Number(t.story.capturedAt) || 0, frozen: false,
            floors: Array.isArray(t.story.floors) ? t.story.floors.filter(f => Number.isInteger(f.index) && typeof f.body === 'string').map(f => ({ index: f.index, name: text(f.name), body: f.body })) : [],
        } : null;
        out.threads.push({ id: t.id, profileId: t.profileId, messages, story,
            memory: { text: text(t.memory?.text), throughId: messages.some(m => m.id === t.memory?.throughId) ? t.memory.throughId : '' },
            annotations: Array.isArray(t.annotations) ? t.annotations.filter(a => typeof a?.quote === 'string' && typeof a?.reply === 'string').map(a => ({ quote: a.quote, reply: a.reply, label: text(a.label), createdAt: Number(a.createdAt) || 0 })) : [],
        });
    }
    for (const p of out.profiles) if (!out.threads.some(t => t.profileId === p.id)) out.threads.push(newThread(p.id));
    out.selected = ids.has(input.selected) ? input.selected : out.profiles[0]?.id || '';
    if(input.extractions && typeof input.extractions==='object') for(const [key,value] of Object.entries(input.extractions).slice(0,200)) {
        if(!value || typeof value.fingerprint!=='string' || !Array.isArray(value.profileIds))continue;
        const profileIds=value.profileIds.filter(id=>ids.has(id));
        if(profileIds.length)Object.defineProperty(out.extractions,key,{value:{fingerprint:value.fingerprint,profileIds},enumerable:true,writable:true,configurable:true});
    }
    const s = input.settings || {};
    out.settings = { includeStory: s.includeStory !== false,
        recentFloors: clamp(s.recentFloors, 1, 60, 12), storyLimit: clamp(s.storyLimit, 1000, 60000, 12000),
        replyTokens: clamp(s.replyTokens, 128, 4096, 800), historyMessages: clamp(s.historyMessages, 4, 200, 40),
        intervalMinutes: clamp(s.intervalMinutes, 2, 120, 10), maxProactive: clamp(s.maxProactive, 1, 20, 3),
        activity: text(s.activity) || '待一会儿', customInstruction: text(s.customInstruction),
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
    return pending.slice(0,Math.max(0,pending.length-settings.summaryKeep));
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

export function buildPrompt(profile, thread, settings, { kind = 'chat', quote = '', activity = '', elapsed = 0 } = {}) {
    const parts = [
        `你正在扮演 ${profile.name}，和 ${profile.userName || '用户'} 在独立的 meta 空间相处。`,
        '沿用下面资料中的性格、语言习惯、世界背景和双方关系。关系没有说明时保持未知，不擅自设为恋人。',
        '双方可以共同观看另一个平行世界的自己。观看记录是那个世界的经历；meta 对话是眼前双方自己的互动。准确区分两个世界、两份记忆和人物归属。可以有偏见、嘴硬、幽默、情绪，也可以逐渐改变关系。',
        '自然回应当前话题，可以聊日常或一起待着。仅写当前所选角色的回复；不要替对方发言或操控对方。默认用中文、正常段落，动作简短，长度随话题。',
        '[角色资料]\n' + [['外貌与身份', profile.description], ['性格', profile.personality], ['表达习惯', profile.speech], ['原设定关系', profile.relationship], ['世界', profile.world], ['补充', profile.notes]].filter(([,v]) => v).map(([k,v]) => `${k}：${replaceNames(v, profile.userName || '用户', profile.name)}`).join('\n'),
        '[对方设定]\n' + replaceNames(profile.userPersona || '未提供详细设定', profile.userName || '用户', profile.name),
    ];
    if (settings.customInstruction) parts.push('[用户设置的 meta 回复要求]\n' + settings.customInstruction);
    if (thread.memory?.text) parts.push('[我们在 meta 中形成的记忆]\n' + thread.memory.text);
    let storyClipped = false;
    if (settings.includeStory && thread.story?.text) {
        storyClipped = thread.story.text.length > settings.storyLimit;
        parts.push('[共同观看的平行世界记录，属于另一个世界]\n' + thread.story.text.slice(0, settings.storyLimit) + (storyClipped ? '\n[记录达到发送长度限制，后续内容未提供，不要猜测。]' : ''));
    }
    if (activity) parts.push(`[当前一起做的事]\n${activity}\n已一起待了约 ${Math.floor(elapsed / 60000)} 分钟。`);
    const boundary = thread.messages.findIndex(m => m.id === thread.memory?.throughId);
    const afterMemory = boundary >= 0 ? thread.messages.slice(boundary + 1) : thread.messages;
    const all = afterMemory.filter(m => ['user', 'assistant', 'note'].includes(m.role));
    const selected = all.slice(-settings.historyMessages);
    const messages = selected.map(m => ({ role: m.role === 'note' ? 'system' : m.role, content: m.role === 'note' ? '[Meta 活动记录]\n' + m.text : m.text }));
    if (all.length > selected.length) parts.push('[较早的部分 meta 消息未载入当前窗口，不要假装记得。]');
    if (kind === 'proactive') messages.push({ role: 'user', content: '[陪伴触发] 根据双方关系、正在一起做的事和之前的谈话，自然地说一两句。可以延续话题或分享想法；不虚构我刚刚发过消息，不强制撒娇。' });
    if (kind === 'annotation') messages.push({ role: 'user', content: '请对这段平行世界片段留一句你自己的批注：\n' + quote });
    return { systemPrompt: parts.join('\n\n'), prompt: messages, omitted: all.length - selected.length, storyClipped };
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
}

export function canNudge(session, now, { visible, open, busy, hostBusy, selected }) {
    return Boolean(session && visible && open && !busy && !hostBusy && selected === session.profileId && session.count < session.max && now >= session.nextAt);
}
