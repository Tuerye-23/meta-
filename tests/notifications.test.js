import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, normalizeProfile, newThread, addMessage, removeMessage, validateBackup } from '../core.js';
import { hasUnread, receiveMessages, markRead, notificationPreferences, MessageSound } from '../notifications.js';
import { homeScreen } from '../phone-ui.js';
import { chatScreen } from '../chat-ui.js';

test('unread replies survive backup, stay per contact, and old history is already read',()=>{
    const state=freshState();state.profiles=['A','B'].map(name=>normalizeProfile({name}));state.threads=state.profiles.map(p=>newThread(p.id));
    const [a,b]=state.threads;const messages=[addMessage(a,'assistant','第一句'),addMessage(a,'assistant','第二句')];
    receiveMessages(a,messages);receiveMessages(a,messages);assert.equal(a.unreadIds.length,2);assert.equal(hasUnread(b),false);
    const restored=validateBackup(JSON.parse(JSON.stringify(state)));assert.deepEqual(restored.threads[0].unreadIds,a.unreadIds);
    restored.threads[0].unreadIds.push('missing',addMessage(restored.threads[0],'user','用户消息').id);
    assert.deepEqual(validateBackup(restored).threads[0].unreadIds,a.unreadIds);
    assert.match(homeScreen(true),/有未读消息/);assert.match(chatScreen(state,{chatPage:'list'},false),/mc-conversation-unread/);
    assert.equal(markRead(a),true);assert.equal(markRead(a),false);assert.equal(hasUnread(a),false);
    delete restored.threads[0].unreadIds;assert.equal(hasUnread(validateBackup(restored).threads[0]),false);
});

test('viewed replies and deleted unread messages do not leave stale dots',()=>{
    const t=newThread('A');const first=addMessage(t,'assistant','消息');receiveMessages(t,[first]);removeMessage(t,first.id);assert.equal(hasUnread(t),false);
    receiveMessages(t,[addMessage(t,'assistant','现在看到的回复')],true);assert.equal(hasUnread(t),false);
    receiveMessages(t,[addMessage(t,'note','戳一戳')]);assert.equal(hasUnread(t),false);
});

test('sound preferences migrate and clamp while mute remains explicit',()=>{
    assert.deepEqual(notificationPreferences(),{notificationTone:'chime',notificationVolume:.5});
    const state=freshState();state.settings.notificationTone='none';state.settings.notificationVolume=.23;
    assert.deepEqual(notificationPreferences(validateBackup(state).settings),{notificationTone:'none',notificationVolume:.23});
    assert.equal(notificationPreferences({notificationTone:'invalid',notificationVolume:99}).notificationVolume,1);
    assert.equal(notificationPreferences({notificationVolume:-1}).notificationVolume,0);
    assert.equal(notificationPreferences({notificationVolume:'garbage'}).notificationVolume,.5);
});

test('audio mute never creates a context and unavailable or denied audio does not reject',async()=>{
    let created=0;class DeniedAudio {constructor(){created++;this.state='suspended';}async resume(){throw Error('NotAllowedError');}}
    const sound=new MessageSound({AudioContext:DeniedAudio});
    assert.equal(await sound.play({notificationTone:'none'}),true);assert.equal(created,0);
    assert.equal(await sound.play({notificationVolume:0}),true);assert.equal(created,0);
    assert.equal(await sound.play({}),false);assert.equal(created,1);
    assert.equal(await new MessageSound({}).play({}),false);
});
