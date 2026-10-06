import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, validateBackup, normalizeProfile, newThread } from '../core.js';
import { freshSocial, normalizeSocial, createEntry, createComment, imageData, reserveSchedules, nextSocialTask, finishSocialTask, generationCount, SOCIAL_PROMPTS } from '../social.js';
import { SocialController } from '../social-controller.js';

const now=()=>new Date(2026,9,6,12,0).getTime();
test('old backups migrate to empty social apps without changing existing chat',()=>{
 const s=freshState();const p=normalizeProfile({name:'Alpha'});s.profiles.push(p);s.threads.push(newThread(p.id));delete s.social;
 const out=validateBackup(s);assert.deepEqual(out.social,freshSocial());assert.equal(out.threads[0].id,s.threads[0].id);
});
test('social records, permissions, cover and comments survive backup roundtrip; prompts are never imported',()=>{
 const s=freshState();const p=normalizeProfile({name:'Alpha'});s.profiles.push(p);s.threads.push(newThread(p.id));s.social.settings.diaryRoles=[p.id,'deleted'];s.social.settings.diaryCommentRoles=[p.id];
 s.social.cover='data:image/png;base64,AAAA';s.social.avatar=s.social.cover;s.social.status='摸鱼';s.social.moments.push(createEntry({authorName:'我',text:'今天',images:[s.social.cover]}));
 const entry=createEntry({authorType:'character',profileId:p.id,authorName:p.name,text:'角色日记',generated:true},now());entry.comments.push(createComment('user','','我','看到了'));s.social.diaries.push(entry);s.social.prompts={diary:'不应导入'};
 const out=validateBackup(s);assert.deepEqual(out.social.settings.diaryRoles,[p.id]);assert.deepEqual(out.social.diaries,s.social.diaries);assert.equal(out.social.cover,s.social.cover);assert.equal(out.social.prompts,undefined);
});
test('image data only allows bounded raster data URLs; duplicate entries and corrupt collections reject',()=>{
 assert.equal(imageData('javascript:alert(1)'), '');assert.equal(imageData('data:image/svg+xml;base64,AAAA'),'');assert.equal(imageData('https://evil.test/pic.png'),'');assert.throws(()=>createEntry({text:' '}));
 const s=freshSocial();const entry=createEntry({text:'one'});s.moments=[entry,entry];assert.throws(()=>normalizeSocial(s,[]),/无效/);assert.throws(()=>normalizeSocial({diaries:{}},[]),/格式/);
});
test('real-world timers survive restart, coalesce missed periods and respect per-character local-day cap',()=>{
 const s=freshSocial();s.settings.diaryRoles=['a','b'];s.settings.diaryAuto=true;s.settings.diaryMinutes=60;s.settings.diaryDaily=1;reserveSchedules(s,now());
 const prompts={diary:'test'};assert.equal(nextSocialTask(s,[{id:'a'},{id:'b'}],now()+59*60000,prompts),null);
 const overdue=now()+5*3600000;const restored=normalizeSocial(JSON.parse(JSON.stringify(s)),['a','b']);assert.deepEqual(nextSocialTask(restored,[{id:'a'},{id:'b'}],overdue,prompts),{kind:'diary',profileId:'a'});
 restored.diaries.push(createEntry({authorType:'character',profileId:'a',text:'manual',generated:true},overdue));finishSocialTask(restored,'diary','a',overdue);assert.equal(restored.schedules['diary:a'].nextAt,overdue+3600000);
 assert.equal(generationCount(restored,'diary','a',overdue),1);assert.deepEqual(nextSocialTask(restored,[{id:'a'},{id:'b'}],overdue,prompts),{kind:'diary',profileId:'b'});
 assert.equal(generationCount(restored,'diary','a',new Date(2026,9,7,1).getTime()),0);
});
test('empty prompts never schedule a request or consume quota; failures back off without skipping a record',()=>{
 const s=freshSocial();s.settings.momentRoles=['a'];s.settings.momentAuto=true;reserveSchedules(s,now());const later=now()+24*3600000;
 assert.equal(nextSocialTask(s,[{id:'a'}],later),null);finishSocialTask(s,'moment','a',later,true);assert.equal(generationCount(s,'moment','a',later),0);
 assert.equal(nextSocialTask(s,[{id:'a'}],later+4*60000,{moment:'test'}),null);assert.deepEqual(nextSocialTask(s,[{id:'a'}],later+5*60000,{moment:'test'}),{kind:'moment',profileId:'a'});
});
function fixture(){
 const state=freshState();const p=normalizeProfile({name:'Alpha'});state.profiles=[p];state.threads=[newThread(p.id)];state.social.settings.diaryRoles=[p.id];state.social.settings.diaryCommentRoles=[p.id];state.social.settings.diaryDaily=1;
 const app={state,disposed:false,busy:false,host:{generate:async()=> '生成内容',context:()=>({name1:'我'}),busy:false},current:()=>({p,t:state.threads[0]}),request:()=>({systemPrompt:'角色资料',prompt:[]}),save:async()=>{},ui:{open:true,socialSheet:'',resetDraft(){},notice(){}},job:async(title,fn)=>fn()};return {app,p};
}
test('controller enforces blank prompts, selected-role permission and shared manual/automatic caps',async()=>{
 const {app,p}=fixture();const controller=new SocialController(app);
 try {
 await assert.rejects(()=>controller.generate('diary',p.id),/等待接入/);assert.equal(app.state.social.diaries.length,0);
 SOCIAL_PROMPTS.diary='test diary prompt';await controller.generate('diary',p.id);assert.equal(app.state.social.diaries.length,1);
 await assert.rejects(()=>controller.generate('diary',p.id,null,true),/上限/);await assert.rejects(()=>controller.generate('diary','other'),/允许/);
 SOCIAL_PROMPTS.diaryComment='test comment prompt';const entry=app.state.social.diaries[0];await controller.generate('diary',p.id,entry.id);assert.equal(entry.comments.length,1);assert.equal(entry.comments[0].profileId,p.id);
 app.state.social.settings.diaryCommentRoles=[];await assert.rejects(()=>controller.generate('diary',p.id,entry.id),/允许/);
 } finally {controller.destroy();SOCIAL_PROMPTS.diary='';SOCIAL_PROMPTS.diaryComment='';}
});
test('late generation response cannot leak into an imported state or a deleted diary',async()=>{
 const {app,p}=fixture();const controller=new SocialController(app);SOCIAL_PROMPTS.diary='test';SOCIAL_PROMPTS.diaryComment='test';
 try {
 let release;app.host.generate=()=>new Promise(resolve=>release=resolve);const original=app.state;const pending=controller.generate('diary',p.id);app.state=freshState();release('late');await pending;assert.equal(original.social.diaries.length,0);assert.equal(app.state.social.diaries.length,0);
 app.state=original;const entry=createEntry({text:'my diary'});original.social.diaries.push(entry);const comment=controller.generate('diary',p.id,entry.id);original.social.diaries=[];release('late comment');await comment;assert.equal(entry.comments.length,0);
 }finally{controller.destroy();SOCIAL_PROMPTS.diary='';SOCIAL_PROMPTS.diaryComment='';}
});

test('local image bytes are excluded from all social model requests',async()=>{
 const {app,p}=fixture();app.state.social.settings.momentRoles=[p.id];app.state.social.settings.momentCommentRoles=[p.id];
 const bytes='data:image/png;base64,AAAABBBB';const entry=createEntry({text:'照片旁边的文字',images:[bytes]});app.state.social.moments.push(entry);
 const requests=[];app.host.generate=async request=>{requests.push(request);return '文字回复';};
 const controller=new SocialController(app);SOCIAL_PROMPTS.moment='test';SOCIAL_PROMPTS.momentComment='test';
 try {await controller.generate('moment',p.id);await controller.generate('moment',p.id,entry.id);
 for(const request of requests){assert.ok(!JSON.stringify(request).includes(bytes));const data=JSON.parse(request.prompt.at(-1).content);assert.equal(data.recent[0].imageCount,1);assert.equal(data.recent[0].text,'照片旁边的文字');}
 }finally{controller.destroy();SOCIAL_PROMPTS.moment='';SOCIAL_PROMPTS.momentComment='';}
});
