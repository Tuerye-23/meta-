import test from 'node:test';
import assert from 'node:assert/strict';
import { HEAD_PROMPT, AI_PROMPT } from '../prompts.js';
import { freshState, normalizeProfile, newThread, addMessage, buildPrompt, validateBackup } from '../core.js';
import { targetNames, parsePersonas, personaRequest, definitionProfile } from '../persona.js';
import { createHost } from '../host.js';
import { independentBody } from '../api.js';

test('the approved prompts, actual data slots and original conversation roles stay ordered',()=>{
    const p=normalizeProfile({name:'Meta Rick',sourceCharacterName:'Rick',userName:'恒',description:'{{char}} 的详细人设',personality:'特定性格',scenario:'特定场景',worldBefore:'前置世界设定',worldAfter:'后置世界设定',userPersona:'用户资料',speech:'<START>\n{{user}}: 示例问题\n{{char}}: 示例回答'});
    const t=newThread(p.id);t.story={text:'legacy',proseText:'正文里的告白',memoryText:'故事里的约定'};t.memory.text='我们周六聊天';addMessage(t,'user','当前消息 {{setvar::x::1}}');
    const s={...freshState().settings,customInstruction:'旧版自定义要求不应继续发送'};
    const request=buildPrompt(p,t,s);
    assert.equal(request.systemPrompt,HEAD_PROMPT);assert.equal(request.prompt[0].role,'assistant');assert.equal(request.prompt[0].content,AI_PROMPT);
    const material=request.prompt.map(m=>m.content).join('\n');
    const ordered=['<全部设定>','前置世界设定','用户资料','Meta Rick 的详细人设','特定性格','特定场景','后置世界设定','</全部设定>','示例问题','以下正文与剧情记忆','故事里的约定','正文里的告白','以下记忆与随后','我们周六聊天','当前消息','继续当前角色'];
    let at=-1;for(const token of ordered){const next=material.indexOf(token,at+1);assert.ok(next>at,token);at=next;}
    assert.equal(request.prompt.find(m=>m.content==='示例问题').role,'user');assert.equal(request.prompt.find(m=>m.content==='示例回答').role,'assistant');
    assert.equal(request.prompt.filter(m=>m.content.startsWith('当前消息')).length,1);
    assert.doesNotMatch(material,/U₁|R₁|U₂|R₂|旧版自定义/);assert.match(material,/当前聊天角色：Meta Rick/);assert.match(material,/｛｛setvar::x::1｝｝/);
    const config={mode:'independent',provider:'openai',baseUrl:'https://example.test/v1',model:'test',transport:'direct'};
    assert.deepEqual(independentBody(request,config).body.messages.map(m=>m.role),['system',...request.prompt.map(m=>m.role)]);
    const claude=independentBody(request,{...config,provider:'claude',maxTokens:'4096'}).body;assert.equal(claude.messages[0].role,'user');assert.equal(claude.messages[1].content,AI_PROMPT);assert.equal(claude.messages.at(-1).role,'user');assert.match(claude.system,/World Info \(before\)/);
});

test('prompt migration distinguishes absent defaults from intentionally empty custom text',()=>{
    const state=freshState();delete state.settings.headPrompt;delete state.settings.aiPrompt;state.settings.customInstruction='legacy';
    const migrated=validateBackup(state);assert.equal(migrated.settings.headPrompt,HEAD_PROMPT);assert.equal(migrated.settings.aiPrompt,AI_PROMPT);assert.equal(migrated.settings.customInstruction,undefined);
    state.settings.headPrompt='';state.settings.aiPrompt='自己的接单回复';assert.equal(validateBackup(state).settings.headPrompt,'');assert.equal(validateBackup(state).settings.aiPrompt,'自己的接单回复');
});

test('plain targeted persona extraction retains text and batch results fail atomically on mismatch',()=>{
    const raw='【A】\nA原始人设，细节不删。\n与B的共同背景。\n\n【B】\nB原始人设。';
    assert.deepEqual(parsePersonas(raw,['B','A']).map(p=>p.name),['B','A']);assert.match(parsePersonas(raw,['A','B'])[0].description,/细节不删/);
    assert.equal(parsePersonas('单个人设原文',['A'])[0].description,'单个人设原文');assert.equal(parsePersonas('｛｛char｝｝ 认识 ｛｛user｝｝。｛｛setvar::x::1｝｝',['A'])[0].description,'{{char}} 认识 {{user}}。｛｛setvar::x::1｝｝');
    for(const result of ['【A】\n只有A','【A】\n一\n【A】\n二','【A】\n一\n【C】\n别的人','说明文字\n'+raw,'【A】\n\n【B】\n二'])assert.throws(()=>parsePersonas(result,['A','B']));
    assert.deepEqual(targetNames(' A\nB，C'),['A','B','C']);assert.throws(()=>targetNames('A\nA'));
    const request=personaRequest(['A','B'],[{label:'共同条目',text:'精确原始素材 {{setvar::x::1}}'}],freshState().settings,'恒');
    assert.equal(request.systemPrompt,HEAD_PROMPT);assert.equal(request.prompt[0].content,AI_PROMPT);assert.doesNotMatch(request.prompt[1].content,/JSON/);assert.match(request.prompt.at(-1).content,/所选角色：\nA\nB/);assert.match(request.prompt.at(-1).content,/精确原始素材/);
});

test('direct definitions preserve raw card fields, selected entry IDs and before/after positions without model calls',async()=>{
    const books={Primary:{entries:{a:{uid:7,position:0,order:100,content:'前置 {{char}}'},b:{uid:8,position:1,order:90,content:'后置'},off:{uid:9,disable:true,content:'已关闭'}}},Extra:{entries:{c:{uid:10,content:'额外绑定'}}}};
    const c={characterId:0,chatId:'main',name1:'恒',name2:'主卡',characters:[{name:'主卡',avatar:'card.png',description:'原始描述 {{char}}',personality:'原始性格',scenario:'原始场景',mes_example:'<START>\n{{char}}: 原始示例',data:{extensions:{world:'Primary'}}}],worldInfo:{charLore:[{name:'card',extraBooks:['Extra']}]},powerUserSettings:{persona_description:'用户原文'},loadWorldInfo:async name=>books[name],unshallowCharacter:async()=>{},generateRaw:()=>{throw Error('must not call model');}};
    const host=createHost({SillyTavern:{getContext:()=>c}});const data=await host.currentDefinitions();
    assert.equal(data.cards[0].description,'原始描述 {{char}}');assert.equal(data.entries.length,0);
    const profile=normalizeProfile(definitionProfile(data.cards[0],data.entries,data.userName,data.userPersona));assert.equal(profile.worldBefore,'');assert.equal(profile.worldAfter,'');assert.equal(profile.scenario,'原始场景');assert.equal(profile.personaMode,'inherit');
    const selection=await host.definitions([],[{name:'Primary',ids:['8']}]);assert.equal(selection.entries.length,1);assert.equal(selection.entries[0].content,'后置');
    await assert.rejects(()=>host.definitions([],[{name:'Primary',ids:['404']}]),/不存在/);await assert.rejects(()=>host.definitions([],[{name:'Primary',ids:['9']}]),/启用状态/);
    assert.equal((await host.definitions([],[{name:'Primary',ids:['9']}],true)).entries[0].content,'已关闭');
    c.characters[0].description='已修改的原始描述';const refreshed=await host.linkedDefinition(profile);assert.equal(refreshed.cards[0].description,c.characters[0].description);
    const state=freshState();state.profiles=[profile];state.threads=[newThread(profile.id)];state.selected=profile.id;const restored=validateBackup(state);assert.deepEqual(restored.profiles[0].binding,profile.binding);assert.equal(restored.profiles[0].personaMode,'inherit');
});

test('backup migration removes automatically injected bound-book material and keeps explicit supplements',()=>{
 const state=freshState();const p=normalizeProfile({name:'A',personaMode:'inherit',binding:{avatar:'a.png',books:[],autoBooks:true},worldBefore:'不应自动保留的绑定世界书'});assert.equal(p.worldBefore,'');assert.equal(p.binding.autoBooks,false);
 p.supplementalBooks=[{name:'需要的世界书',ids:['3']}];state.profiles=[p];state.threads=[newThread(p.id)];assert.deepEqual(validateBackup(state).profiles[0].supplementalBooks,p.supplementalBooks);
 const t=newThread(p.id);t.story={text:'长正文'.repeat(10000),memoryText:'尾部剧情记忆'};const request=buildPrompt(p,t,{...state.settings,storyLimit:100});assert.match(request.prompt.map(m=>m.content).join('\n'),/尾部剧情记忆/);assert.equal(request.storyClipped,false);assert.ok(request.prompt.map(m=>m.content).join('\n').length>30000);
});
