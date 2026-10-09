import test from 'node:test';
import assert from 'node:assert/strict';
import { storyFloors,storyPage } from '../story-ui.js';
import { createHost } from '../host.js';
import { freshState,normalizeProfile,newThread,buildPrompt } from '../core.js';

test('recent 12 floors are the complete browser and model window even with 1000 older floors',async()=>{
    let reads=0;const chat=Array.from({length:1000},(_,index)=>({name:'Rick',get mes(){reads++;return `正文楼层-${index}`;}}));
    const context={characterId:0,chatId:'bounded',name1:'恒',name2:'Rick',characters:[{name:'Rick',avatar:'rick.png'}],chat};
    const state=freshState(),p=normalizeProfile({name:'Rick'}),t=newThread(p.id);
    t.story=await createHost({SillyTavern:{getContext:()=>context}}).story(state.settings);
    assert.equal(reads,12);assert.equal(t.story.floors.length,12);assert.deepEqual(storyFloors(t.story,12).map(f=>f.index),Array.from({length:12},(_,i)=>988+i));
    const prompt=buildPrompt(p,t,state.settings).prompt.map(m=>m.content).join('\n');assert.match(prompt,/正文楼层-988/);assert.doesNotMatch(prompt,/正文楼层-987\b/);
    const oldCache={cutoff:999,floors:Array.from({length:1000},(_,index)=>({index,body:'正文'})),memoryText:'更早记忆'};
    assert.equal(storyFloors(oldCache,12).length,12);oldCache.floors[998].body='';assert.equal(storyFloors(oldCache,12).length,11);
});

test('reader preserves a paused floor, evicts it at the window boundary and follows only on request',()=>{
    const state=freshState(),p=normalizeProfile({name:'Rick'}),t=newThread(p.id),ui={storyPages:new Map()};
    state.profiles=[p];state.selected=p.id;state.threads=[t];state.settings.recentFloors=3;
    t.story={key:'chat-A',cutoff:9,floors:[7,8,9].map(index=>({index,body:'正文'}))};
    let page=storyPage(ui,state);assert.equal(page.floor.index,9);page.cursor.follow=false;page.cursor.index=8;
    t.story={...t.story,cutoff:10,floors:[8,9,10].map(index=>({index,body:'正文'}))};assert.equal(storyPage(ui,state).floor.index,8);
    t.story={...t.story,cutoff:11,floors:[9,10,11].map(index=>({index,body:'正文'}))};assert.equal(storyPage(ui,state).floor.index,9);
    page.cursor.follow=true;assert.equal(storyPage(ui,state).floor.index,11);
    t.story.key='chat-B';assert.equal(storyPage(ui,state).cursor.follow,true);
    state.settings.recentFloors=1;assert.equal(storyPage(ui,state).floors.length,1);
});
