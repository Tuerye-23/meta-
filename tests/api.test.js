import test from 'node:test';
import assert from 'node:assert/strict';
import { apiDefaults, normalizeApi, validateApi, apiBaseUrl } from '../api-config.js';
import { independentBody, createIndependentClient, responseText } from '../api.js';
import { createHost } from '../host.js';
import { freshState, validateBackup } from '../core.js';
const config={mode:'independent',transport:'direct',baseUrl:'https://example.test/v1',apiKey:'test-secret',model:'test-model',temperature:'',topP:'',frequencyPenalty:'',presencePenalty:'',maxTokens:''};
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
 assert.equal(set.temperature,0);assert.equal(set.top_p,0.95);assert.equal(set.presence_penalty,0);assert.equal(set.max_tokens,4000);for(const key of ['seed','top_k','repetition_penalty','reasoning_effort','max_completion_tokens'])assert.equal(key in set,false);
});
test('invalid numeric values are rejected',()=>{
 for(const values of [{temperature:'abc'},{topP:'1.5'},{frequencyPenalty:'3'},{maxTokens:'0'}])assert.throws(()=>validateApi({...config,...values}));
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
test('presets preserve connection fields and do not modify existing configurations',()=>{
 const old={...config,temperature:'',maxTokens:''};assert.equal(normalizeApi(old).maxTokens,'');
 const preset=apiDefaults({...old,model:'gpt-5-mini',topP:'0.9',extraBody:'{"x":1}'});
 assert.equal(preset.baseUrl,config.baseUrl);assert.equal(preset.apiKey,config.apiKey);assert.equal(preset.temperature,'1');assert.equal(preset.maxTokens,'12000');assert.equal(preset.maxTokenField,undefined);assert.equal(preset.topP,'0.98');assert.equal(preset.extraBody,undefined);
 const claude=apiDefaults({...old,provider:'claude'});assert.equal(claude.temperature,'1');assert.equal(claude.timeout,'120');
});
test('Claude builds native system and messages, requires output limit and omits OpenAI parameters',()=>{
 const c={...config,provider:'claude',maxTokens:'4096',maxTokenField:'max_completion_tokens',frequencyPenalty:'bad',seed:'123'};
 const {body}=independentBody({...prompt,prompt:[{role:'system',content:'second system'},...prompt.prompt]},c);
 assert.equal(body.max_tokens,4096);assert.equal(body.messages[0].role,'user');assert.match(body.system,/second system/);assert.equal('seed' in body,false);assert.equal('frequency_penalty' in body,false);assert.equal('max_completion_tokens' in body,false);
 assert.throws(()=>independentBody(prompt,{...c,maxTokens:''}),/必须填写输出上限/);assert.throws(()=>independentBody(prompt,{...c,temperature:'1.1'}),/温度/);assert.equal(validateApi({...c,extraBody:'{"seed":1}'}).api.extraBody,undefined);
 assert.equal(apiBaseUrl('https://api.anthropic.com/v1/messages/'),'https://api.anthropic.com/v1');assert.equal(apiBaseUrl('https://api.anthropic.com'),'https://api.anthropic.com/v1');
 assert.equal(apiBaseUrl('https://example.test/messages'),'https://example.test');assert.equal(apiBaseUrl('https://example.test'),'https://example.test');
});
test('Claude direct requests use Messages authentication and parse only text blocks',async()=>{
 const {root,calls}=fixture();root.fetch=async(url,opts)=>{calls.push({url,opts,body:JSON.parse(opts.body)});return reply({content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'Claude '},{type:'text',text:'answer'}]});};
 assert.equal(await createHost(root).generate(prompt,{...config,provider:'claude',maxTokens:'4096'}),'Claude answer');
 assert.equal(calls[0].url,'https://example.test/v1/messages');assert.equal(calls[0].opts.headers['x-api-key'],config.apiKey);assert.equal(calls[0].opts.headers['anthropic-version'],'2023-06-01');assert.equal(calls[0].opts.headers.Authorization,undefined);assert.equal(calls[0].body.messages[0].role,'user');
 assert.throws(()=>responseText({content:[{type:'thinking',thinking:'hidden'}]}),/没有返回有效正文/);
});
test('TT Claude forwarding selects native format and exact upstream body without shared credentials',async()=>{
 const {root,calls}=fixture();root.__TAURITAVERN__={};const c={...config,provider:'claude',transport:'host',maxTokens:'4096',extraBody:'{"thinking":{"type":"disabled"}}'};
 await createHost(root).generate(prompt,c);const body=calls[0].body;assert.equal(body.chat_completion_source,'custom');assert.equal(body.custom_api_format,'claude_messages');assert.equal(body.custom_url,'');assert.equal(body.proxy_password,config.apiKey);assert.equal(body.use_sysprompt,true);
 const upstream=JSON.parse(body.custom_include_body);assert.equal(upstream.messages[0].role,'user');assert.match(upstream.system,/system/);assert.equal(upstream.thinking,undefined);assert.ok(JSON.parse(body.custom_exclude_body).includes('temperature'));
 root.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return reply({data:[{id:'claude-test'}]});};assert.deepEqual(await createHost(root).models({...c,model:'',maxTokens:''}),['claude-test']);assert.equal(calls.at(-1).body.custom_api_format,'claude_messages');
});
test('ST Claude uses its Claude route for generation and explicit headers for models',async()=>{
 const {root,calls}=fixture();const c={...config,provider:'claude',transport:'host',maxTokens:'4096'};
 await createHost(root).generate(prompt,c);assert.equal(calls[0].body.chat_completion_source,'claude');assert.equal(calls[0].body.reverse_proxy,config.baseUrl);assert.equal(calls[0].body.messages[0].role,'system');
 await createHost(root).generate(prompt,{...c,extraBody:'{"thinking":{"type":"disabled"}}'});assert.equal(calls[1].body.thinking,undefined);
 root.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return reply({data:[{id:'claude-test'}]});};await createHost(root).models(c);const headers=JSON.parse(calls.at(-1).body.custom_include_headers);assert.equal(headers['x-api-key'],config.apiKey);assert.equal(headers.Authorization,'');
});
test('content filter reasons are distinct from malformed responses',()=>{
 assert.throws(()=>responseText({promptFeedback:{blockReason:'PROHIBITED_CONTENT'}}),/模型服务拦截/);assert.throws(()=>responseText({choices:[{finish_reason:'content_filter',message:{content:''}}]}),/模型服务拦截/);
});

test('new default requests and reset preserve the connection and streaming preference',()=>{
 const value={baseUrl:config.baseUrl,model:'gpt-5-mini',stream:true};
 const {body}=independentBody(prompt,value);assert.equal(body.temperature,1);assert.equal(body.top_p,0.98);assert.equal(body.frequency_penalty,0);assert.equal(body.presence_penalty,0);assert.equal(body.max_completion_tokens,12000);assert.equal(body.stream,true);
 const reset=apiDefaults({...config,stream:true});assert.equal(reset.baseUrl,config.baseUrl);assert.equal(reset.apiKey,config.apiKey);assert.equal(reset.stream,true);assert.equal(reset.maxTokens,'12000');
 const restored=validateBackup(freshState());assert.equal(restored.settings.api.topP,'0.98');assert.equal(restored.settings.storyLimit,undefined);assert.equal(restored.settings.replyTokens,undefined);
});
const sse=(frames,split=3)=>{const bytes=new TextEncoder().encode(frames);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=split)c.enqueue(bytes.slice(i,i+split));c.close();}}),{headers:{'content-type':'text/event-stream'}});};
test('independent OpenAI and native Claude streaming decode split Unicode and omit reasoning',async()=>{
 for(const provider of ['openai','claude']) {
  const {root,calls}=fixture(),updates=[];
  root.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return provider==='claude'?sse('event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"秘密"}}\r\n\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\r\n\r\ndata: {"type":"message_stop"}\r\n\r\n',1):sse('data: {"choices":[{"delta":{"reasoning_content":"秘密"}}]}\n\ndata: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n',2);};
  const result=await createHost(root).generate({...prompt,onText:t=>updates.push(t)},{...config,provider,maxTokens:'12000',stream:true});assert.equal(result,'你好');assert.equal(updates.at(-1),'你好');assert.equal(calls[0].stream,true);assert.ok(updates.every(t=>!t.includes('秘密')));
 }
});
test('failed or incomplete streaming never returns a successful partial reply',async()=>{
 const {root}=fixture();root.fetch=async()=>sse('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n');await assert.rejects(()=>createHost(root).generate(prompt,{...config,stream:true}),/提前结束/);
 root.fetch=async()=>sse('data: {"error":{"message":"bad test-secret"}}\n\n');await assert.rejects(()=>createHost(root).generate(prompt,{...config,stream:true}),e=>e.message.includes('bad')&&!e.message.includes('test-secret'));
});
test('host streaming uses a private copy of host settings and its existing output limit',async()=>{
 const {root,c,calls}=fixture();c.mainApi='openai';c.oai_settings={max_tokens:9876,temperature:0.4,stream_openai:false,chat_completion_source:'custom'};const before=structuredClone(c.oai_settings);
 c.getChatCompletionModel=()=> 'host-model';c.createGenerationParameters=async(settings,model,type,messages)=>{assert.equal(type,'quiet');return {generate_data:{...settings,messages,model,stream:false}};};c.getStreamingReply=data=>data.choices?.[0]?.delta?.content || '';
 root.fetch=async(url,opts)=>{calls.push(JSON.parse(opts.body));return sse('data: {"choices":[{"delta":{"content":"宿主回复"}}]}\n\ndata: [DONE]\n\n');};
 assert.equal(await createHost(root).generate(prompt,{mode:'host',stream:true}),'宿主回复');assert.equal(calls[0].max_tokens,9876);assert.equal(calls[0].stream,true);assert.deepEqual(c.oai_settings,before);
});

test('Claude default sampling sends temperature alone and Top P after temperature is cleared',()=>{
 const defaults=apiDefaults({...config,provider:'claude'});const body=independentBody(prompt,defaults).body;assert.equal(body.temperature,1);assert.equal('top_p' in body,false);assert.equal(body.max_tokens,12000);
 const top=independentBody(prompt,{...defaults,temperature:''}).body;assert.equal('temperature' in top,false);assert.equal(top.top_p,0.98);
});
test('the old stock preset upgrades once while deliberately blank or custom output limits survive',()=>{
 const state=freshState();state.version='0.5.0';state.settings.api={...config,temperature:'1',maxTokens:'4096',timeout:'120'};assert.equal(validateBackup(state).settings.api.maxTokens,'12000');
 state.settings.api.maxTokens='6000';assert.equal(validateBackup(state).settings.api.maxTokens,'6000');state.settings.api.maxTokens='';assert.equal(validateBackup(state).settings.api.maxTokens,'');
});
