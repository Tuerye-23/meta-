import test from 'node:test';
import assert from 'node:assert/strict';
import { addMessage, buildPrompt, canNudge, chunkSources, freshState, mainKey, mergeProfiles, newThread, normalizeProfile, parseProfiles, removeMessage, replaceNames, validateBackup } from '../core.js';

test('extracts a multi-character response with braces inside strings',()=>{
    const p=parseProfiles('结果如下：\n```json\n{"characters":[{"name":"Rick","speech":"say [hello] {hi}"},{"name":"Beth"}]}\n```');
    assert.equal(p.length,2);assert.equal(p[0].speech,'say [hello] {hi}');
    assert.throws(()=>parseProfiles('{"characters":"oops"}'));
    assert.deepEqual(parseProfiles('[]'),[]);
});
test('merges repeated names across extraction chunks without merging different people',()=>{
    const p=mergeProfiles([normalizeProfile({name:'Rick',personality:'冷淡'}),normalizeProfile({name:'rick',speech:'口语'}),normalizeProfile({name:'Rick Prime',personality:'狂妄'})]);
    assert.equal(p.length,2);assert.equal(p[0].personality,'冷淡');assert.equal(p[0].speech,'口语');
});
test('source chunking is bounded and retains every character and provenance',()=>{
    const material='人'.repeat(25000);const chunks=chunkSources([{label:'世界书',text:material}],1000);
    assert.ok(chunks.every(c=>c.length<=1000));assert.equal(chunks.join('').replace(/\n\[来源：世界书\]\n/g,''),material);
});
test('only substitutes user/char names; variable macros are inert',()=>{
    assert.equal(replaceNames('{{user}} {{char}} {{setvar::x::1}}','$&','Rick'),'$& Rick {{setvar::x::1}}');
});
test('different cards and groups with the same chat name have different identities',()=>{
    const a=mainKey({chatId:'chat',characterId:0,characters:[{avatar:'a.png'}]});
    const b=mainKey({chatId:'chat',characterId:0,characters:[{avatar:'b.png'}]});
    assert.notEqual(a,b);assert.notEqual(a,mainKey({chatId:'chat',groupId:'a.png'}));
});
test('meta and watched memories remain in separate labelled sections; relationships remain unspecified',()=>{
    const p=normalizeProfile({name:'Rick',userName:'恒'});const t=newThread(p.id);t.story={text:'他向另一个 user 许诺。'};t.memory={text:'我们约好周六聊天。',throughId:''};
    addMessage(t,'user','你觉得那个你怎么样？');
    const r=buildPrompt(p,t,freshState().settings);
    assert.match(r.systemPrompt,/原设定关系|关系没有说明时保持未知/);assert.match(r.systemPrompt,/共同观看的平行世界/);assert.match(r.systemPrompt,/我们在 meta 中形成的记忆/);
    const off=buildPrompt(p,t,{...freshState().settings,includeStory:false});assert.doesNotMatch(off.systemPrompt,/他向另一个/);
});
test('context excludes already summarized history; activity notes are labelled',()=>{
    const p=normalizeProfile({name:'R'});const t=newThread(p.id);const a=addMessage(t,'user','old');t.memory={text:'old summary',throughId:a.id};addMessage(t,'note','一起写东西');addMessage(t,'assistant','new');
    const r=buildPrompt(p,t,freshState().settings);assert.deepEqual(r.prompt.map(m=>m.role),['system','assistant']);assert.ok(r.prompt.every(m=>m.content!=='old'));
});
test('removing summarized messages invalidates the summary',()=>{
    const t=newThread('p');const old=addMessage(t,'user','old');const recent=addMessage(t,'assistant','recent');t.memory={text:'summary',throughId:old.id};removeMessage(t,recent.id);assert.equal(t.memory.text,'summary');removeMessage(t,old.id);assert.equal(t.memory.text,'');
});
test('backup roundtrip restores sessions, fixed cutoff, and source excerpts',()=>{
    const s=freshState();const p=normalizeProfile({name:'Rick',sourceText:'原文'}, {sourceKey:'chat'});s.profiles.push(p);const t=newThread(p.id);s.threads.push(t);s.selected=p.id;addMessage(t,'user','hello');t.story={key:'chat',label:'第 4 条',text:'截至这里',cutoff:3,capturedAt:1,frozen:true,floors:[{index:3,name:'R',body:'here'}]};
    const r=validateBackup(JSON.parse(JSON.stringify(s)));assert.equal(r.profiles[0].sourceText,'原文');assert.equal(r.threads[0].story.frozen,true);assert.equal(r.threads[0].messages[0].text,'hello');
    assert.throws(()=>validateBackup({...s,threads:[{...t,profileId:'wrong'}]}));assert.throws(()=>validateBackup({...s,profiles:[p,p]}));
});
test('proactive messages respect visibility, interval, selection, cap and main generation',()=>{
    const s={profileId:'a',nextAt:100,count:0,max:3};const options={visible:true,open:true,busy:false,hostBusy:false,selected:'a'};
    assert.equal(canNudge(s,101,options),true);
    for(const change of [{visible:false},{open:false},{busy:true},{hostBusy:true},{selected:'b'}]) assert.equal(canNudge(s,101,{...options,...change}),false);
    assert.equal(canNudge({...s,count:3},101,options),false);assert.equal(canNudge(s,99,options),false);
});
