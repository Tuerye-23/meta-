import test from 'node:test';
import assert from 'node:assert/strict';
import { ContactsController } from '../contacts-controller.js';
import { contactsScreen } from '../contacts-ui.js';
import { freshState, validateBackup } from '../core.js';
import { createHost } from '../host.js';

function fixture(recognized='Morty Smith',extracted='【Morty Smith】\n【性格】\n谨慎。') {
    const book={entries:{on:{uid:1,comment:'启用的背景',content:'无关背景'},off:{uid:2,disable:true,comment:'隐藏人设',content:'Morty Smith的人设原文。Rick Sanchez的人设原文。'},off2:{uid:3,enabled:false,comment:'另一关闭条目',content:'另一份素材'}}};
    const context={characterId:0,chatId:'main',characters:[],name1:'用户',loadWorldInfo:async()=>book};
    const host=createHost({SillyTavern:{getContext:()=>context}}),requests=[];
    host.generate=async request=>{requests.push(request);return request.prompt.some(m=>m.content.startsWith('识别以下素材'))?recognized:extracted;};
    const ui={tab:'roles',contactPage:'add',contactSource:'book',sourceDraft:{cards:[],personaBook:'Book',personaEntries:[]},capture(){},notice(){}};
    const app={state:freshState(),ui,host,render(){},queueStorySync(){},job:async(label,fn)=>fn()};
    return {app,controller:new ContactsController(app),book,requests};
}

test('disabled extraction entries are selectable individually and by select-all without enabling lore',async()=>{
    const {app,controller,book,requests}=fixture();
    await controller.picker('entries');
    const html=contactsScreen(app.state,app.ui,app.host.context(),false);
    assert.match(html,/隐藏人设（已关闭）/);assert.doesNotMatch(html.match(/<button[^>]*data-id="2"[^>]*>/)[0],/\sdisabled(?:\s|>)/);
    await controller.handle('contact-picker-all',{});assert.deepEqual(app.ui.pickerSelection,['1','2','3']);
    await controller.handle('contact-picker-all',{});assert.deepEqual(app.ui.pickerSelection,[]);
    await controller.handle('contact-picker-toggle',{id:'2'});
    await controller.handle('contact-picker-done',{});
    assert.equal(app.ui.contactPage,'candidates');assert.equal(requests.length,1);
    assert.match(requests[0].prompt.at(-1).content,/Morty Smith的人设原文/);assert.doesNotMatch(requests[0].prompt.at(-1).content,/无关背景|另一份素材/);
    await controller.handle('contact-candidate',{index:'0'});await controller.create();
    const profile=app.state.profiles[0];assert.equal(profile.description,book.entries.off.content);assert.equal(profile.personaMode,'inherit');assert.equal(requests.length,1);
    assert.equal(profile.binding.includeDisabled,true);assert.deepEqual(profile.binding.books,[{name:'Book',ids:['2']}]);
    const restored=validateBackup(app.state).profiles[0];book.entries.off.content='Morty Smith更新后的原始人设。';
    const refreshed=await app.host.linkedDefinition(restored);assert.equal(refreshed.entries[0].content,book.entries.off.content);assert.equal(refreshed.entries.length,1);
    assert.equal(book.entries.off.disable,true);assert.equal(book.entries.off2.enabled,false);
    // Re-selecting the same source after upgrading retains the contact ID and existing content.
    const id=profile.id;profile.binding.includeDisabled=false;profile.description='已有的人设内容';
    app.ui.contactPage='add';await controller.identify();app.ui.candidateSelection=[0];await controller.create();
    assert.equal(app.state.profiles.length,1);assert.equal(app.state.threads.length,1);assert.equal(app.state.profiles[0].id,id);
    assert.equal(app.state.profiles[0].description,'已有的人设内容');assert.equal(app.state.profiles[0].binding.includeDisabled,true);
});

test('single selection from a disabled multi-person entry retains body headings and rejects other candidates atomically',async()=>{
    const {app,controller}=fixture('Morty Smith\nRick Sanchez');
    app.ui.sourceDraft.personaEntries=['2'];await controller.identify();app.ui.candidateSelection=[0];await controller.create();
    assert.equal(app.state.profiles.length,1);assert.equal(app.state.profiles[0].name,'Morty Smith');assert.equal(app.state.profiles[0].description,'【性格】\n谨慎。');
    const bad=fixture('Morty Smith\nRick Sanchez','【Morty Smith】\n人设。\n### Rick Sanchez\n未选角色。');
    bad.app.ui.sourceDraft.personaEntries=['2'];await bad.controller.identify();bad.app.ui.candidateSelection=[0];
    await assert.rejects(()=>bad.controller.create(),/未选中或姓名不同：Rick Sanchez/);assert.equal(bad.app.state.profiles.length,0);assert.equal(bad.app.state.threads.length,0);
});
