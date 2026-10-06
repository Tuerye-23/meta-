import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApi, validateApi, apiBaseUrl } from '../api-config.js';
import { independentBody, createIndependentClient } from '../api.js';
import { createHost } from '../host.js';
import { freshState, validateBackup } from '../core.js';
const config={mode:'independent',transport:'direct',baseUrl:'https://example.test/v1',apiKey:'test-secret',model:'test-model'};
const prompt={systemPrompt:'system {{setvar::a::1}}',prompt:[{role:'user',content:'hello'}],responseLength:3000};
const reply=body=>new Response(JSON.stringify(body),{status:200});
const fixture=()=>{
 const calls=[];const c={maxContext:1,getTokenCountAsync:async()=>{throw Error('must not use main-model budget');},getRequestHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'test-csrf'})};
 const root={SillyTavern:{getContext:()=>c},fetch:async(url,opts)=>{calls.push({url,opts,body:opts.body?JSON.parse(opts.body):null});return reply({choices:[{message:{content:' test answer '}}]});}};
 return {c,root,calls};
};
test('optional API parameters remain absent, including max tokens despite internal responseLength',()=>{
 const {body}=independentBody(prompt,config);assert.deepEqual(Object.keys(body).sort(),['messages','model','stream']);assert.match(body.messages[0].content,/｛｛setvar/);assert.equal(body.messages[1].content,'hello');
 const set=independentBody(prompt,{...config,temperature:'0',topP:' 0.95 ',topK:'20',frequencyPenalty:'-0.5',presencePenalty:'0',repetitionPenalty:'1.1',seed:'0',maxTokens:'4000',maxTokenField:'max_completion_tokens',extraBody:'{"reasoning_effort":"low"}'}).body;
 assert.equal(set.temperature,0);assert.equal(set.top_p,0.95);assert.equal(set.presence_penalty,0);assert.equal(set.seed,0);assert.equal(set.max_completion_tokens,4000);assert.equal(set.repetition_penalty,1.1);assert.equal(set.reasoning_effort,'low');assert.equal('max_tokens' in set,false);
});
test('invalid numeric values and malformed or routing-changing JSON are rejected',()=>{
 for(const values of [{temperature:'abc'},{topP:'1.5'},{seed:'0.5'},{maxTokens:'0'},{extraBody:'[]'},{extraBody:'{"messages":[]}'},{extraBody:'{"reverse_proxy":"https://elsewhere.test"}'}])assert.throws(()=>validateApi({...config,...values}));
 assert.equal(validateApi({...config,temperature:'  '}).api.temperature,'');assert.throws(()=>apiBaseUrl('javascript:alert(1)'));assert.equal(apiBaseUrl('https://example.test/v1/chat/completions/'),'https://example.test/v1');
});
test('direct API uses separate endpoint and key without host parameters or tokenizer defaults',async()=>{
 const {root,calls}=fixture();const result=await createHost(root).generate(prompt,config);assert.equal(result,'test answer');assert.equal(calls[0].url,'https://example.test/v1/chat/completions');assert.equal(calls[0].opts.headers.Authorization,'Bearer test-secret');assert.equal(calls[0].opts.credentials,'omit');assert.deepEqual(Object.keys(calls[0].body).sort(),['messages','model','stream']);
});
test('native TT forwards independent requests without shared secrets, and forces omitted parameters to stay omitted',async()=>{
 const {root,calls}=fixture();root.__TAURITAVERN__={};const client=createIndependentClient(root,()=>root.SillyTavern.getContext());await client.generate(prompt,{...config,transport:'host',temperature:'0'});
 const call=calls[0];assert.equal(call.url,'/api/backends/chat-completions/generate');assert.equal(call.body.custom_url,'');assert.equal(call.body.reverse_proxy,config.baseUrl);assert.equal(call.body.proxy_password,config.apiKey);assert.equal(call.opts.headers['X-CSRF-Token'],'test-csrf');assert.equal(call.body.temperature,0);
 const excluded=JSON.parse(call.body.custom_exclude_body);assert.ok(excluded.includes('max_tokens'));assert.ok(excluded.includes('top_p'));assert.ok(!excluded.includes('temperature'));assert.equal(JSON.parse(call.body.custom_include_body).temperature,0);
 await client.generate(prompt,{...config,apiKey:'',transport:'host'});assert.equal(calls[1].body.proxy_password,'');assert.equal(calls[1].body.custom_url,'');
});
test('ST forwarding explicitly overrides custom-endpoint credentials instead of editing host settings',async()=>{
 const {root,c,calls}=fixture();const settings={temperature:0.5,model:'main'};c.chatCompletionSettings=settings;await createHost(root).generate(prompt,{...config,transport:'host'});
 assert.equal(calls[0].body.custom_url,config.baseUrl);assert.deepEqual(JSON.parse(calls[0].body.custom_include_headers),{Authorization:'Bearer test-secret'});assert.deepEqual(settings,{temperature:0.5,model:'main'});
});
test('models can load before selecting a model and unsupported lists retain manual entry',async()=>{
 const {root,calls}=fixture();root.fetch=async(url,opts)=>{calls.push({url,opts});return reply({data:[{id:'b'},{id:'a'},{id:'b'}]});};assert.deepEqual(await createHost(root).models({...config,model:''}),['a','b']);assert.equal(calls[0].url,'https://example.test/v1/models');assert.equal(calls[0].opts.method,'GET');assert.equal(calls[0].opts.body,undefined);
 root.fetch=async()=>reply({data:[]});await assert.rejects(()=>createHost(root).models(config),/手动填写/);
});
test('independent token checks are opt-in and report the configured limit',async()=>{
 const {root,c,calls}=fixture();c.getTokenCountAsync=async()=>100;await assert.rejects(()=>createHost(root).generate(prompt,{...config,contextLimit:'90'}),/你设置的独立 API/);assert.equal(calls.length,0);
 await createHost(root).generate(prompt,{...config,contextLimit:''});assert.equal(calls.length,1);
});
test('API errors are visible but redact keys, and empty or reasoning-only replies never become messages',async()=>{
 const {root}=fixture();root.fetch=async()=>new Response(JSON.stringify({error:{message:'invalid test-secret'}}),{status:401});await assert.rejects(()=>createHost(root).generate(prompt,config),error=>error.message.includes('401')&&!error.message.includes('test-secret'));
 root.fetch=async()=>reply({choices:[{message:{content:null,reasoning_content:'hidden reasoning'}}]});await assert.rejects(()=>createHost(root).generate(prompt,config),/没有返回有效正文/);
});
test('API config persists blank values and migrates existing installations to host mode',()=>{
 const state=freshState();state.settings.api=normalizeApi({...config,temperature:0,topP:'',maxTokens:''});const restored=validateBackup(JSON.parse(JSON.stringify(state)));assert.equal(restored.settings.api.temperature,'0');assert.equal(restored.settings.api.topP,'');assert.equal(restored.settings.api.apiKey,'test-secret');delete state.settings.api;assert.equal(validateBackup(state).settings.api.mode,'host');
});
