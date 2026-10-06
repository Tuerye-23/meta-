import { literalMacros } from './core.js';

import { API_PARAMETERS, optionalNumber, validateApi } from './api-config.js';

export function independentBody(request,value) {
    const {api,extra}=validateApi(value);
    const messages=[];
    if(request.systemPrompt)messages.push({role:'system',content:literalMacros(request.systemPrompt)});
    for(const m of request.prompt || [])messages.push({role:m.role,content:literalMacros(m.content)});
    const body={...extra,model:api.model,messages,stream:false};
    for(const [key,wire,label,min,max,integer] of API_PARAMETERS) {
        const n=optionalNumber(api[key],label,min,max,integer);if(n!==undefined)body[wire]=n;
    }
    const max=optionalNumber(api.maxTokens,'输出上限',1,1000000,true);
    if(max!==undefined)body[api.maxTokenField]=max;
    return {api,body};
}
function proxyConfig(api,native) {
    // Native TT supports a per-request reverse proxy with no shared-secret fallback.
    // ST's custom endpoint accepts an explicit Authorization override, including an empty value.
    return {chat_completion_source:'custom',custom_url:native?'':api.baseUrl,reverse_proxy:native?api.baseUrl:'',proxy_password:native?api.apiKey:'',custom_include_headers:JSON.stringify(native?{}:{Authorization:api.apiKey?'Bearer '+api.apiKey:''})};
}
function redact(message,key) { return key ? message.split(key).join('[API Key]') : message; }
export function responseText(data) {
    const content=data?.choices?.[0]?.message?.content;
    if(typeof content==='string' && content.trim())return content.trim();
    if(Array.isArray(content)) {
        const result=content.filter(p=>p?.type==='text').map(p=>p.text || '').join('').trim();if(result)return result;
    }
    throw new Error('API 没有返回有效正文（choices[0].message.content）；请确认地址使用 OpenAI 兼容接口。');
}
export function createIndependentClient(root,context) {
    const requestJson=async(api,operation,body)=>{
        const c=context();const native=Boolean(root.__TAURITAVERN__ || root.__TAURITAVERN_MAIN_READY__);
        const headers={'Content-Type':'application/json'}; let url,options;
        if(api.transport==='host') {
            if(typeof c.getRequestHeaders!=='function')throw new Error('当前宿主未提供请求转发接口，请改选浏览器直连。');
            url='/api/backends/chat-completions/'+(operation==='models'?'status':'generate');
            const proxy=proxyConfig(api,native);
            const payload=operation==='models' ? proxy : {...body,...proxy,custom_include_body:JSON.stringify(body),custom_exclude_body:JSON.stringify([...API_PARAMETERS.map(p=>p[1]),'max_tokens','max_completion_tokens','logprobs','top_logprobs','n','stop','logit_bias'].filter(k=>!Object.hasOwn(body,k)))};
            options={method:'POST',headers:{...c.getRequestHeaders()},body:JSON.stringify(payload)};
        } else {
            url=api.baseUrl+(operation==='models'?'/models':'/chat/completions');
            if(api.apiKey)headers.Authorization='Bearer '+api.apiKey;
            options={method:operation==='models'?'GET':'POST',headers,credentials:'omit',...(operation==='models'?{}:{body:JSON.stringify(body)})};
        }
        const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),(Number(api.timeout)||120)*1000);
        try {
            const response=await root.fetch(url,{...options,signal:controller.signal});
            const raw=await response.text();let data;
            try{data=JSON.parse(raw);}catch{throw new Error(`API 返回 ${response.status}，内容不是有效 JSON。`);}
            if(!response.ok || data?.error) {
                const detail=typeof data.error==='string'?data.error:data.error?.message || data.message || response.statusText || '请求失败';
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
                const material=body.messages.map(m=>m.content).join('\n');
                const c=context();const estimate=typeof c.getTokenCountAsync==='function'?await c.getTokenCountAsync(material):Math.ceil(material.length/2);
                if(estimate+(Number(api.maxTokens)||0)>Number(api.contextLimit))throw new Error(`本次估算输入约 ${estimate} tokens，超过你设置的独立 API 上下文检查上限（${api.contextLimit}）。可调大或清空此项。`);
            }
            return responseText(await requestJson(api,'generate',body));
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
