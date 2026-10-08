import { literalMacros } from './core.js';
import { multimodalContent } from './chat-media.js';

import { hasOwn, API_PARAMETERS, apiParameters, optionalNumber, validateApi } from './api-config.js';

export function independentBody(request,value) {
    const {api}=validateApi(value);
    const messages=[],system=[];
    if(request.systemPrompt)system.push(literalMacros(request.systemPrompt));
    for(const m of request.prompt || []) {
        if(m.role==='system' && api.provider==='claude'){system.push(literalMacros(m.content));continue;}
        if(!['system','user','assistant'].includes(m.role))throw new Error('API 消息只能使用 system、user 或 assistant 角色。');
        messages.push({role:m.role,content:multimodalContent({...m,content:literalMacros(m.content)},api.provider)});
    }
    // Older Claude gateways require a user turn before the assistant acknowledgement.
    if(api.provider==='claude' && messages[0]?.role==='assistant')messages.unshift({role:'user',content:'[后台任务开始] 请执行系统中的任务说明。'});
    if(api.provider==='claude' && messages.at(-1)?.role==='assistant')messages.push({role:'user',content:'[后台生成触发] 请继续当前任务。'});
    if(api.provider!=='claude' && system.length)messages.unshift({role:'system',content:system.join('\n\n')});
    const body={model:api.model,messages,stream:api.stream};
    if(api.provider==='claude' && system.length)body.system=system.join('\n\n');
    for(const [key,wire,label,min,max,integer] of apiParameters(api.provider)) {
        const n=optionalNumber(api[key],label,min,max,integer);if(n!==undefined)body[wire]=n;
    }
    // Native Claude accepts one sampling control; temperature takes precedence.
    if(api.provider==='claude' && hasOwn(body,'temperature'))delete body.top_p;
    const max=optionalNumber(api.maxTokens,'输出上限',1,1000000,true);
    if(max!==undefined)body[api.provider==='claude' || !/^(?:o[134](?:-|$)|gpt-5(?:-|$))/.test(api.model)?'max_tokens':'max_completion_tokens']=max;
    if(api.provider==='claude' && !Number.isInteger(body.max_tokens))throw new Error('Claude 必须填写输出上限（max_tokens）。可点击「恢复默认」。');
    if(api.provider==='claude') {
        optionalNumber(body.max_tokens,'输出上限',1,1000000,true);
        for(const [,wire,label,min,max,integer] of apiParameters('claude'))if(hasOwn(body,wire))body[wire]=optionalNumber(body[wire],label,min,max,integer);
    }
    return {api,body};
}
function proxyConfig(api,native,operation) {
    // Native TT supports a per-request reverse proxy with no shared-secret fallback.
    // ST's custom endpoint accepts an explicit Authorization override, including an empty value.
    if(api.provider==='claude' && !native && operation==='generate')return {chat_completion_source:'claude',reverse_proxy:api.baseUrl,proxy_password:api.apiKey,use_sysprompt:true};
    return {chat_completion_source:'custom',custom_api_format:api.provider==='claude'?'claude_messages':'openai_compat',custom_url:native?'':api.baseUrl,reverse_proxy:native?api.baseUrl:'',proxy_password:native?api.apiKey:'',custom_include_headers:JSON.stringify(native?{}:api.provider==='claude'?{Authorization:'','x-api-key':api.apiKey,'anthropic-version':'2023-06-01'}:{Authorization:api.apiKey?'Bearer '+api.apiKey:''})};
}
function redact(message,key) { return key ? message.split(key).join('[API Key]') : message; }
export function responseText(data) {
    const block=data?.promptFeedback?.blockReason || data?.choices?.[0]?.finish_reason;
    if(block && /PROHIBITED_CONTENT|SAFETY|content_filter/i.test(block))throw new Error(`模型服务拦截了内容：${block}。更换 API 来源不会自动解除内容拦截。`);
    if(Array.isArray(data?.content)) {
        const result=data.content.filter(p=>p?.type==='text').map(p=>p.text || '').join('').trim();if(result)return result;
    }
    const content=data?.choices?.[0]?.message?.content;
    if(typeof content==='string' && content.trim())return content.trim();
    if(Array.isArray(content)) {
        const result=content.filter(p=>p?.type==='text').map(p=>p.text || '').join('').trim();if(result)return result;
    }
    throw new Error('API 没有返回有效正文；请核对 API 来源、地址及模型。');
}
export function createIndependentClient(root,context) {
    const requestJson=async(api,operation,body,onText)=>{
        const c=context();const native=Boolean(root.__TAURITAVERN__ || root.__TAURITAVERN_MAIN_READY__);
        const headers={'Content-Type':'application/json'}; let url,options;
        if(api.transport==='host') {
            if(typeof c.getRequestHeaders!=='function')throw new Error('当前宿主未提供请求转发接口，请改选浏览器直连。');
            url='/api/backends/chat-completions/'+(operation==='models'?'status':'generate');
            const proxy=proxyConfig(api,native,operation);
            const routed=api.provider==='claude' && body ? {...body,use_sysprompt:true,messages:[...(body.system?[{role:'system',content:body.system}]:[]),...body.messages]}:body;
            const payload=operation==='models' ? proxy : {...routed,...proxy,custom_include_body:JSON.stringify(body),custom_exclude_body:JSON.stringify([...API_PARAMETERS.map(p=>p[1]),'top_k','seed','repetition_penalty','system','max_tokens','max_completion_tokens','logprobs','top_logprobs','n','stop','stop_sequences','logit_bias'].filter(k=>!hasOwn(body,k)))};
            options={method:'POST',headers:{...c.getRequestHeaders()},body:JSON.stringify(payload)};
        } else {
            url=api.baseUrl+(operation==='models'?'/models':api.provider==='claude'?'/messages':'/chat/completions');
            if(api.provider==='claude'){headers['anthropic-version']='2023-06-01';if(api.apiKey)headers['x-api-key']=api.apiKey;}
            else if(api.apiKey)headers.Authorization='Bearer '+api.apiKey;
            options={method:operation==='models'?'GET':'POST',headers,credentials:'omit',...(operation==='models'?{}:{body:JSON.stringify(body)})};
        }
        const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),(Number(api.timeout)||120)*1000);
        try {
            const response=await root.fetch(url,{...options,signal:controller.signal});
            if(response.ok && operation==='generate' && /text\/event-stream/i.test(response.headers.get('content-type') || ''))return {choices:[{message:{content:await readEventStream(response,onText)}}]};
            const raw=await response.text();let data;
            try{data=JSON.parse(raw);}catch{throw new Error(`API 返回 ${response.status}，内容不是有效 JSON。`);}
            if(!response.ok || data?.error) {
                const detail=typeof data.error==='string'?data.error:[data.error?.type,data.error?.message].filter(Boolean).join(': ') || data.message || response.statusText || '请求失败';
                throw new Error(`API 请求失败（${response.status}）：${redact(String(detail),api.apiKey).slice(0,600)}`);
            }
            return data;
        } catch(error) {
            if(controller.signal.aborted)throw new Error('API 请求超时，请检查连接或调整请求超时。');
            if(error instanceof TypeError)throw new Error(api.transport==='direct'?'API 连接失败；浏览器直连可能受跨域限制，可改用酒馆转发。':'API 转发连接失败，请检查地址及网络。');
            throw new Error(redact(error?.message || String(error),api.apiKey));
        } finally{clearTimeout(timeout);}
    };
    return {
        async generate(request,value) {
            const {api,body}=independentBody(request,value);
            if(api.contextLimit) {
                const material=[body.system || '',...body.messages.map(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):m.content)].join('\n');
                const c=context();const imageCount=body.messages.reduce((n,m)=>n+(Array.isArray(m.content)?m.content.filter(p=>['image','image_url'].includes(p.type)).length:0),0);const estimate=(typeof c.getTokenCountAsync==='function'?await c.getTokenCountAsync(material):Math.ceil(material.length/2))+imageCount*1600;
                if(estimate+(Number(api.maxTokens)||0)>Number(api.contextLimit))throw new Error(`本次估算输入约 ${estimate} tokens，超过你设置的独立 API 上下文检查上限（${api.contextLimit}）。可调大或清空此项。`);
            }
            return responseText(await requestJson(api,'generate',body,request.onText));
        },
        async models(value) {
            const {api}=validateApi(value,false);const result=await requestJson(api,'models');
            const data=Array.isArray(result)?result:result?.data || result?.models;
            if(!Array.isArray(data))throw new Error('API 未提供可用的模型列表，仍可手动填写模型 ID。');
            const ids=[...new Set(data.map(m=>typeof m==='string'?m:m?.id).filter(id=>typeof id==='string' && id.trim()))].sort();
            if(!ids.length)throw new Error('模型列表为空，仍可手动填写模型 ID。');return ids;
        },
    };
}

// Handles SSE frames split across arbitrary UTF-8/network chunk boundaries.
export async function readEventStream(response,onText,extract=null) {
    if(!response.body?.getReader)throw new Error('API 未提供可读取的流。');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let pending='',result='',finished=false;
    const frame=value=>{
        const raw=value.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
        if(!raw)return;
        if(raw==='[DONE]'){finished=true;return;}
        let data;try{data=JSON.parse(raw);}catch{throw new Error('API 流式响应包含无效数据。');}
        if(data.error || data.type==='error')throw new Error(typeof data.error==='string'?data.error:data.error?.message || data.message || 'API 流式请求失败。');
        const reason=data.promptFeedback?.blockReason || data.choices?.[0]?.finish_reason;
        if(reason && /PROHIBITED_CONTENT|SAFETY|content_filter/i.test(reason))throw new Error('模型服务拦截了内容：'+reason);
        if(data.type==='message_stop')finished=true;
        const content=data.choices?.[0]?.delta?.content;
        const delta=extract?extract(data):data.type==='content_block_delta' && data.delta?.type==='text_delta'?data.delta.text:data.type==='content_block_start' && data.content_block?.type==='text'?data.content_block.text:typeof content==='string'?content:Array.isArray(content)?content.filter(b=>b.type==='text').map(b=>b.text || '').join(''):'';
        if(delta){result+=delta;onText?.(result);}
    };
    try {
        while(!finished) {
            const {done,value}=await reader.read();
            pending+=decoder.decode(value || new Uint8Array(),{stream:!done});
            // Normalize CRLF only after receiving a full frame, retaining split CR/LF.
            let match;while(!finished && (match=/\r?\n\r?\n/.exec(pending))){frame(pending.slice(0,match.index).replace(/\r\n/g,'\n'));pending=pending.slice(match.index+match[0].length);}
            if(done){if(pending.trim())frame(pending.replace(/\r\n/g,'\n'));if(!finished)throw new Error('流式连接提前结束，回复未保存，请重试。');break;}
        }
        if(!result.trim())throw new Error('API 没有返回有效正文。');
        return result.trim();
    } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
