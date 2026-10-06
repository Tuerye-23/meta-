// These author-supplied prompts intentionally remain empty until the next update.
import { avatarSource } from './images.js';
// They are not part of user settings or imported backups.
export const SOCIAL_PROMPTS = { moment: '', momentComment: '', diary: '', diaryComment: '' };
const string = (v, limit=20000) => typeof v === 'string' ? v.slice(0,limit) : '';
const id = () => globalThis.crypto?.randomUUID?.() || `social-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const bounded = (v,min,max,fallback) => Number.isFinite(Number(v)) ? Math.floor(Math.max(min,Math.min(max,Number(v)))) : fallback;
export const imageData = v => typeof v==='string' && v.length<=1600000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : '';
export const localDay = now => {const d=new Date(now);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function freshSocial() {
    return { userName:'', avatar:'', cover:'', status:'', moments:[], diaries:[],
        settings:{momentRoles:[],momentCommentRoles:[],diaryRoles:[],diaryCommentRoles:[],momentAuto:false,diaryAuto:false,momentMinutes:180,diaryMinutes:720,momentDaily:3,diaryDaily:1}, schedules:{} };
}
export function normalizeSocial(input, profileIds) {
    const out=freshSocial(); if(!input || typeof input!=='object')return out;
    const ids=new Set(profileIds);const s=input.settings || {};
    for(const k of ['userName','status'])out[k]=string(input[k],k==='status'?80:160);
    out.avatar=avatarSource(input.avatar);out.cover=imageData(input.cover);
    for(const k of ['momentRoles','momentCommentRoles','diaryRoles','diaryCommentRoles'])out.settings[k]=Array.isArray(s[k])?[...new Set(s[k].filter(v=>ids.has(v)))]:[];
    for(const k of ['momentAuto','diaryAuto'])out.settings[k]=s[k]===true;
    for(const kind of ['moment','diary']){out.settings[kind+'Minutes']=bounded(s[kind+'Minutes'],1,10080,kind==='moment'?180:720);out.settings[kind+'Daily']=bounded(s[kind+'Daily'],1,100,kind==='moment'?3:1);}
    const allIds=new Set();
    for(const collection of ['moments','diaries']) {
        if(input[collection]!==undefined && !Array.isArray(input[collection]))throw new Error('朋友圈或日记存档格式有误。');
        if((input[collection]?.length || 0)>10000)throw new Error('朋友圈或日记条数过多。');
        out[collection]=(input[collection] || []).map(v=>{
            if(!v || typeof v.id!=='string' || !v.id || allIds.has(v.id) || !['user','character'].includes(v.authorType))throw new Error('动态或日记记录无效。');allIds.add(v.id);
            const comments=Array.isArray(v.comments)?v.comments.slice(0,2000).filter(c=>c && ['user','character'].includes(c.authorType) && typeof c.text==='string').map(c=>({id:string(c.id,160)||id(),authorType:c.authorType,profileId:string(c.profileId,160),authorName:string(c.authorName,160),text:string(c.text,5000),createdAt:Number(c.createdAt)||0})):[];
            return {id:v.id,authorType:v.authorType,profileId:string(v.profileId,160),authorName:string(v.authorName,160),text:string(v.text),title:string(v.title,160),images:collection==='moments'&&Array.isArray(v.images)?v.images.slice(0,9).map(imageData).filter(Boolean):[],comments,liked:v.liked===true,createdAt:Number(v.createdAt)||0,generated:v.generated===true};
        });
    }
    for(const [key,v] of Object.entries(input.schedules || {}))if(v && /^(moment|diary):/.test(key) && ids.has(key.slice(key.indexOf(':')+1)))out.schedules[key]={nextAt:Number(v.nextAt)||0,retryAt:Number(v.retryAt)||0};
    return out;
}
export function createEntry({authorType='user',profileId='',authorName='',text='',title='',images=[],generated=false}, now=Date.now()) {
    const body=string(text).trim();const photos=images.slice(0,9).map(imageData).filter(Boolean);
    if(!body && !photos.length)throw new Error('先写点内容或选择图片。');
    return {id:id(),authorType,profileId,authorName:string(authorName,160),text:body,title:string(title,160).trim(),images:photos,comments:[],liked:false,createdAt:now,generated};
}
export function createComment(authorType,profileId,authorName,text,now=Date.now()) {
    const body=string(text,5000).trim();if(!body)throw new Error('先填写评论。');
    return {id:id(),authorType,profileId,authorName:string(authorName,160),text:body,createdAt:now};
}
export const collectionFor = kind => kind==='moment' ? 'moments' : 'diaries';
export function generationCount(social,kind,profileId,now=Date.now()) {
    return social[collectionFor(kind)].filter(x=>x.generated && x.profileId===profileId && localDay(x.createdAt)===localDay(now)).length;
}
export function reserveSchedules(social,now=Date.now(),reset=false) {
    for(const kind of ['moment','diary'])for(const profileId of social.settings[kind+'Roles']){
        const key=kind+':'+profileId;
        if(reset || !social.schedules[key])social.schedules[key]={nextAt:now+social.settings[kind+'Minutes']*60000,retryAt:0};
    }
}
export function nextSocialTask(social,profiles,now=Date.now(),prompts=SOCIAL_PROMPTS) {
    for(const kind of ['moment','diary']) {
        if(!social.settings[kind+'Auto'] || !prompts[kind]?.trim())continue;
        for(const profileId of social.settings[kind+'Roles']) {
            const slot=social.schedules[kind+':'+profileId];
            if(!profiles.some(p=>p.id===profileId) || !slot || now<slot.nextAt || now<slot.retryAt)continue;
            if(generationCount(social,kind,profileId,now)>=social.settings[kind+'Daily'])continue;
            return {kind,profileId};
        }
    }
    return null;
}
export function finishSocialTask(social,kind,profileId,now=Date.now(),failed=false) {
    const key=kind+':'+profileId;const slot=social.schedules[key] ||= {nextAt:now,retryAt:0};
    if(failed)slot.retryAt=now+5*60000;
    else {slot.nextAt=now+social.settings[kind+'Minutes']*60000;slot.retryAt=0;}
}
