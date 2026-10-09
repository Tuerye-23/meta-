import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, StateStore } from '../host.js';
import { freshState, normalizeProfile } from '../core.js';

function fixture() {
    const writes=new Map();const c={name1:'恒',name2:'测试卡',characterId:0,chatId:'故事',characters:[{name:'测试卡',avatar:'card.png',description:'{{user}}认识A和B',data:{character_book:{entries:[{name:'A',content:'A冷淡',enabled:true},{name:'隐藏',content:'隐藏角色',enabled:false}]}}}],chat:Array.from({length:8},(_,i)=>({name:i%2?'A':'恒',is_user:i%2===0,mes:`正文${i}`})),generateRaw:async p=>p.prompt[0].content,accountStorage:{getItem:k=>writes.get(k)||null,setItem:(k,v)=>writes.set(k,v)},powerUserSettings:{persona_description:'主角设定'},maxContext:10000,getTokenCountAsync:async()=>100,eventTypes:{},getWorldInfoNames:()=>['设定'],loadWorldInfo:async()=>({entries:{0:{comment:'B',content:'B聪明'},1:{content:'关闭的内容',disable:true}}})};
    const root={SillyTavern:{getContext:()=>c},localStorage:{getItem:k=>writes.get(k)||null,setItem:(k,v)=>writes.set(k,v)}};return{c,root,writes};
}
test('sources include selected cards, embedded and external lorebooks; disabled entries excluded',async()=>{
    const{root}=fixture();const h=createHost(root);const r=await h.sources(['0'],['设定']);const joined=r.sources.map(s=>s.text).join('');assert.match(joined,/恒认识A和B/);assert.match(joined,/A冷淡/);assert.match(joined,/B聪明/);assert.doesNotMatch(joined,/隐藏角色|关闭的内容/);
    assert.match((await h.sources(['0'],['设定'],true)).sources.map(s=>s.text).join(''),/隐藏角色/);
});
test('BaiBai reads latest history and snapshot; prose uses original messages without mutating them',async()=>{
    const{c,root}=fixture();const calls=[];
    root.STBaiBaiBook={apiVersion:1,pluginVersion:'1.2.9',getHistory:({before})=>{calls.push(['history',before]);return{text:`历史至${before}`,coverage:{complete:true}};},getSnapshot:({floor})=>{calls.push(['snapshot',floor]);return{state:{time:`时间${floor}`},coverage:{complete:true}};},getFloor:i=>{calls.push(['floor',i]);return{body:`清洗${i}`,omitted:i===2};}};
    const r=await createHost(root).story({...freshState().settings,recentFloors:3});
    assert.deepEqual(calls,[['history',5],['snapshot',7]]);assert.deepEqual(r.floors.map(f=>f.index),[5,6,7]);assert.match(r.text,/正文7|时间7/);assert.equal(c.chat.length,8);assert.equal(r.frozen,false);
});

test('worldbook memory reads selected UID and does not touch BaiBai',async()=>{
    const{c,root}=fixture();let calls=0;c.loadWorldInfo=async()=>({entries:{4:{uid:123,comment:'剧情记忆',content:'{{user}}和A昨天约好见面'}}});
    root.STBaiBaiBook={apiVersion:1,getHistory:()=>{calls++;throw Error('should not run');}};
    const h=createHost(root);assert.equal((await h.memoryEntries('设定'))[0].id,'123');
    const r=await h.story({...freshState().settings,storyMemorySource:'worldbook',memoryBook:'设定',memoryEntry:'123'});assert.match(r.text,/恒和A昨天/);assert.equal(calls,0);
    await assert.rejects(()=>h.story({...freshState().settings,storyMemorySource:'worldbook',memoryBook:'设定',memoryEntry:'missing'}),/不存在/);
});
test('enabled regex selection extracts assistant prose, keeps user input and excludes reasoning',async()=>{
    const{c,root}=fixture();c.chat=c.chat.slice(-2);c.chat[1].mes='<think><正文>假的</正文></think><正文>真的</正文><状态栏>不读</状态栏>';
    const scripts=[{id:'body',scriptName:'正文',findRegex:'/<正文>([\\s\\S]*?)<\\/正文>/g',placement:[2],disabled:false},{id:'off',findRegex:'x',placement:[2],disabled:true}];
    c.getRegexScripts=({allowedOnly})=>{assert.equal(allowedOnly,true);return scripts;};const h=createHost(root);
    assert.deepEqual((await h.enabledRegexes()).map(s=>s.id),['body']);
    const r=await h.story({...freshState().settings,regexIds:['body']});assert.equal(r.floors[0].body,'正文6');assert.equal(r.floors[1].body,'真的');
    scripts[0].disabled=true;await assert.rejects(()=>h.story({...freshState().settings,regexIds:['body']}),/已关闭/);
});
test('without BaiBai the extension reads recent raw dialogue, strips reasoning, and does not mutate main chat',async()=>{
    const{c,root}=fixture();c.chat[7].mes='<think>secret</think>正文7';const before=JSON.stringify(c.chat);const r=await createHost(root).story({...freshState().settings,recentFloors:2});assert.equal(r.floors.length,2);assert.doesNotMatch(r.text,/secret/);assert.match(r.text,/正文7/);assert.equal(JSON.stringify(c.chat),before);
});
test('host mode delegates token limits to the host instead of blocking on its displayed context setting',async()=>{
    const{c,root}=fixture();let calls=0;c.generateRaw=async()=>{calls++;return'hi';};c.maxContext=1000;c.getTokenCountAsync=async()=>950;
    assert.equal(await createHost(root).generate({systemPrompt:'a',prompt:[{role:'user',content:'hello'}],responseLength:128}),'hi');assert.equal(calls,1);
});
test('raw generation receives literal macros and cannot execute source variable commands',async()=>{
    const{c,root}=fixture();let sent;c.generateRaw=async r=>{sent=r;return'hi';};
    await createHost(root).generate({systemPrompt:'{{setvar::x::1}}',prompt:[{role:'user',content:'{{getvar::x}}'}]});
    assert.equal(sent.systemPrompt,'｛｛setvar::x::1｝｝');assert.equal(sent.prompt[0].content,'｛｛getvar::x｝｝');assert.equal(sent.trimNames,false);
});
test('state persistence survives restart and serializes overlapping saves in order',async()=>{
    const{root}=fixture();const host=createHost(root);const store=new StateStore(host,root);const state=await store.init();const p=normalizeProfile({name:'A'});state.profiles.push(p);state.selected=p.id;
    const first=store.save(state);state.profiles[0].name='B';const second=store.save(state);await Promise.all([first,second]);const restarted=await new StateStore(host,root).init();assert.equal(restarted.profiles[0].name,'B');assert.equal(restarted.threads.length,1);
});

test('current chat automatically collects embedded, primary, extra and chat lorebooks without reading unrelated books',async()=>{
    const {c,root}=fixture();c.characters[0].data.extensions={world:'主世界'};c.worldInfo={charLore:[{name:'card',extraBooks:['附加世界','主世界']},{name:'other',extraBooks:['别的卡']} ]};c.chatMetadata={world_info:'聊天世界'};
    const loaded=[];c.loadWorldInfo=async name=>{loaded.push(name);return{entries:{0:{content:name+'的设定'},1:{content:'关闭条目',disable:true}}};};
    const data=await createHost(root).currentSources();assert.deepEqual(loaded,['主世界','附加世界','聊天世界']);assert.equal(data.originKey,'card:card.png');assert.match(data.sources.map(s=>s.text).join(''),/A冷淡|聊天世界的设定/);assert.doesNotMatch(data.sources.map(s=>s.text).join(''),/关闭条目/);
});
test('group chat automatically reads all member cards and their bound worlds',async()=>{
    const {c,root}=fixture();c.characters[0].data.extensions={world:'第一本'};c.characters.push({avatar:'b.png',name:'B卡',description:'B的设定',data:{extensions:{world:'第二本'}}});c.worldInfo={};c.groupId='group';c.characterId=undefined;c.groups=[{id:'group',members:['card.png','b.png','missing.png']}];
    const loaded=[];c.loadWorldInfo=async name=>{loaded.push(name);return{entries:{0:{content:name}}};};const data=await createHost(root).currentSources();assert.equal(data.originKey,'group:group');assert.deepEqual(loaded,['第一本','第二本']);assert.match(data.chunks.join(''),/B的设定/);
});
test('switching chat while reading automatic sources rejects the stale result',async()=>{
    const {c,root}=fixture();c.worldInfo={};c.characters[0].data.extensions={world:'主世界'};c.loadWorldInfo=async()=>{c.chatId='另一段聊天';return{entries:{0:{content:'世界设定'}}};};await assert.rejects(()=>createHost(root).currentSources(),/切换/);
});

test('QR persistence waits for successful backend save and rejects HTTP failures for retry',async()=>{
    const {root,c}=fixture();const calls=[];c.getRequestHeaders=()=>({'Content-Type':'application/json'});let refreshed=0;const set={toJSON:()=>({version:2,name:'映间小手机',qrList:[{label:'映间',message:'/meta'}]}),rerender:()=>refreshed++};
    root.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return new Response('',{status:503});};await assert.rejects(()=>createHost(root).saveQRSet(set),/保存失败/);assert.equal(refreshed,0);
    root.fetch=async()=>new Response('',{status:200});await createHost(root).saveQRSet(set);assert.equal(refreshed,1);assert.equal(calls[0].url,'/api/quick-replies/save');assert.equal(calls[0].body.qrList[0].message,'/meta');
});


test('HTML comment removal rules keep prose and unmatched floors without requiring a capture group',async()=>{
    const {c,root}=fixture(),h=createHost(root);
    const cleaner={id:'comments',scriptName:'HTML注释-去除',findRegex:'/<!--\\s*([\\s\\S]*?)\\s*-->/g',replaceString:'',placement:[2],disabled:false,markdownOnly:true,promptOnly:true};
    c.getRegexScripts=()=>[cleaner];c.chat=[{is_user:true,name:'恒',mes:'用户正文'},{name:'Rick',mes:'前半段<!-- Prism检查: 问题=无;\n下一段=痕迹的积累 -->后半段<!-- 累计:738/不限 -->结尾'},{name:'Rick',mes:'没有注释的正文'}];
    const original=JSON.stringify(c.chat),story=await h.story({...freshState().settings,regexIds:['comments'],regexCapture:20});
    assert.deepEqual(story.floors.map(f=>f.body),['用户正文','前半段后半段结尾','没有注释的正文']);assert.equal(JSON.stringify(c.chat),original);
    assert.equal((await h.enabledRegexes())[0].scriptName,'HTML注释-去除');
});

test('cleanup precedes extraction, tag selection works with $1, and per-rule modes survive backups',async()=>{
    const {c,root}=fixture();c.chat=[{name:'Rick',mes:'<think><正文>假的</正文></think><正文>真正<!-- 备注 -->正文</正文><状态栏>秘密</状态栏>'}];
    c.getRegexScripts=()=>[{id:'body',scriptName:'正文',findRegex:'/<正文>([\\s\\S]*?)<\\/正文>/g',replaceString:'<script>不要执行</script>',placement:[2]},{id:'comments',findRegex:'/<!--[\\s\\S]*?-->/g',replaceString:'',placement:[2]}];
    const state=freshState();Object.assign(state.settings,{includeTags:'正文',excludeTags:'状态栏',regexIds:['body','comments'],regexModes:{body:'extract',comments:'remove'},regexCapture:1});
    const story=await createHost(root).story(state.settings);assert.deepEqual(story.floors.map(f=>f.body),['真正正文']);assert.doesNotMatch(story.text,/假的|秘密|备注|script/);
    const {validateBackup}=await import('../core.js');assert.deepEqual(validateBackup(state).settings.regexModes,{body:'extract',comments:'remove'});
    delete state.settings.regexModes;assert.deepEqual(validateBackup(state).settings.regexModes,{});
});

test('cleanup obeys placement and depth, and empty-replacement rules can explicitly extract prose',async()=>{
    const {c,root}=fixture();c.chat=[{name:'恒',is_user:true,mes:'用户<!-- 留下 -->'},{name:'Rick',mes:'较早<!-- 去除 -->'},{name:'Rick',mes:'最新<!-- 留下 -->'}];
    c.getRegexScripts=()=>[{id:'comments',findRegex:'/<!--[\\s\\S]*?-->/g',replaceString:'',placement:[2],minDepth:1,maxDepth:1}];
    const h=createHost(root),settings={...freshState().settings,regexIds:['comments']};assert.deepEqual((await h.story(settings)).floors.map(f=>f.body),['用户<!-- 留下 -->','较早','最新<!-- 留下 -->']);
    c.chat=[{name:'Rick',mes:'<正文>只保留这个</正文>其他'}];c.getRegexScripts=()=>[{id:'body',findRegex:'/<正文>([\\s\\S]*?)<\\/正文>/g',replaceString:'',placement:[2]}];
    assert.equal((await h.story({...settings,regexIds:['body'],regexModes:{body:'extract'}})).floors[0].body,'只保留这个');
});
