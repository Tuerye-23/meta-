import { SHORT_CHAT_PROMPT } from './prompts.js';

export const REPLY_RANGES = {'3-5':[3,5], '5-10':[5,10]};
export function chatPreferences(value={}) {
    return {replyStyle:value.replyStyle==='short'?'short':'long',replyRange:Object.prototype.hasOwnProperty.call(REPLY_RANGES,value.replyRange)?value.replyRange:'3-5'};
}
export function shortChat(profile,kind='chat') {return profile.replyStyle==='short' && ['chat','poke','proactive'].includes(kind);}
export function shortChatPrompt(profile) {
    const [min,max]=REPLY_RANGES[chatPreferences(profile).replyRange];
    return SHORT_CHAT_PROMPT.replace('〔最少条数〕',String(min)).replace('〔最多条数〕',String(max));
}

// A message is one wire block, not a paragraph or sentence inferred from prose.
export function shortReplyParts(raw,partial=false) {
    const source=String(raw ?? '').trim().replace(/^```(?:text|xml)?\s*/i,'').replace(/\s*```$/,'');
    const parts=[];const blocks=/<消息>([\s\S]*?)<\/消息>/g;let match,end=0;
    while((match=blocks.exec(source))) {
        const value=match[1].trim();
        if(source.slice(end,match.index).trim() || !value || /<\/?消息>/.test(value)) {
            if(partial)return parts;throw new Error('短句回复格式不完整，请重试。');
        }
        parts.push(value);end=blocks.lastIndex;
    }
    const rest=source.slice(end).trim();
    if(partial) {
        if(rest.startsWith('<消息>')) {
            const value=rest.slice(4).replace(/<[^>]*$/,'').trim();
            if(value && !/<\/?消息>/.test(value))parts.push(value);
        }
        return parts.slice(0,10);
    }
    if(rest || !parts.length)throw new Error('短句回复格式不完整，请重试。');
    return parts;
}
export function replyParts(raw,profile,kind='chat',partial=false) {
    if(!shortChat(profile,kind))return raw?.trim()?[raw.trim()]:[];
    const parts=shortReplyParts(raw,partial);
    if(!partial) {
        const [min,max]=REPLY_RANGES[chatPreferences(profile).replyRange];
        if(parts.length<min || parts.length>max)throw new Error(`本次短句回复为 ${parts.length} 条，需 ${min}～${max} 条，请重试。`);
    }
    return parts;
}

// Only the contiguous last reply can be regenerated, even after deleting a bubble.
export function lastReplyGroup(thread) {
    const messages=thread.messages,last=messages[messages.length-1];
    if(last?.role!=='assistant')return [];
    if(!last.replyId)return [last];
    let start=messages.length-1;
    while(start>0 && messages[start-1].role==='assistant' && messages[start-1].replyId===last.replyId)start--;
    return messages.slice(start);
}
export function groupStart(messages,index) {
    if(index<0 || index>=messages.length)return index;
    const message=messages[index];
    if(message.role==='assistant' && message.replyId)while(index>0 && messages[index-1].role==='assistant' && messages[index-1].replyId===message.replyId)index--;
    return index;
}
