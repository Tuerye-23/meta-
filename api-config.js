const text=value=>typeof value==='string'?value:'';
export const API_PARAMETERS = [
    ['temperature','temperature','温度',0,2,false],
    ['topP','top_p','Top P',0,1,false],
    ['topK','top_k','Top K',0,1000000,true],
    ['frequencyPenalty','frequency_penalty','频率惩罚',-2,2,false],
    ['presencePenalty','presence_penalty','存在惩罚',-2,2,false],
    ['repetitionPenalty','repetition_penalty','重复惩罚',0,10,false],
    ['seed','seed','随机种子',-2147483648,2147483647,true],
];
const optionalFields=[...API_PARAMETERS.map(p=>p[0]),'maxTokens','contextLimit','timeout'];
const valueText=value=>value===null || value===undefined ? '' : String(value).trim();
export function normalizeApi(value={}) {
    if(!value || typeof value!=='object' || Array.isArray(value))value={};
    const api={mode:value.mode==='independent'?'independent':'host',transport:value.transport==='direct'?'direct':'host',baseUrl:text(value.baseUrl).trim(),apiKey:text(value.apiKey).trim(),model:text(value.model).trim(),maxTokenField:value.maxTokenField==='max_completion_tokens'?'max_completion_tokens':'max_tokens',extraBody:text(value.extraBody).trim()};
    for(const key of optionalFields)api[key]=valueText(value[key]);
    return api;
}
export function optionalNumber(value,label,min,max,integer=false) {
    if(value==='')return undefined;
    const n=Number(value);
    if(!Number.isFinite(n) || n<min || n>max || (integer&&!Number.isInteger(n)))throw new Error(`${label}需为 ${min}～${max} ${integer?'之间的整数':'之间的数字'}，也可留空。`);
    return n;
}
export function apiBaseUrl(value) {
    let url;
    try{url=new URL(value);}catch{throw new Error('请填写完整 API 地址，例如 https://example.com/v1。');}
    if(!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)throw new Error('API 地址需为 HTTP / HTTPS 地址，Key 请填在独立字段中。');
    url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
    return url.href.replace(/\/$/,'');
}
export function validateApi(value,requireModel=true) {
    const api=normalizeApi(value);
    api.baseUrl=apiBaseUrl(api.baseUrl);
    if(requireModel && !api.model)throw new Error('请选择或填写模型 ID。');
    for(const [key,,label,min,max,integer] of API_PARAMETERS)optionalNumber(api[key],label,min,max,integer);
    optionalNumber(api.maxTokens,'输出上限',1,1000000,true);
    optionalNumber(api.contextLimit,'上下文检查上限',1,10000000,true);
    optionalNumber(api.timeout,'请求超时',1,3600,true);
    let extra={};
    if(api.extraBody) {
        try{extra=JSON.parse(api.extraBody);}catch{throw new Error('自定义请求参数需为有效 JSON 对象。');}
        if(!extra || typeof extra!=='object' || Array.isArray(extra))throw new Error('自定义请求参数需为 JSON 对象。');
        const reserved=['messages','model','stream','chat_completion_source','custom_url','custom_api_format','reverse_proxy','proxy_password','custom_include_headers','custom_include_body','custom_exclude_body','secret_id'];
        if(reserved.some(k=>Object.hasOwn(extra,k)))throw new Error('自定义参数不能覆盖模型、消息、流式设置或连接配置。');
    }
    return {api,extra};
}
