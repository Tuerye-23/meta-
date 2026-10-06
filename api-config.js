export const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const text=value=>typeof value==='string'?value:'';
export const API_PARAMETERS = [
    ['temperature','temperature','温度',0,2,false],
    ['topP','top_p','Top P',0,1,false],
    ['frequencyPenalty','frequency_penalty','频率惩罚',-2,2,false],
    ['presencePenalty','presence_penalty','存在惩罚',-2,2,false],
];
const defaults={temperature:'1',topP:'0.98',frequencyPenalty:'0',presencePenalty:'0',maxTokens:'12000',contextLimit:'',timeout:'120'};
export const apiParameters = provider => provider==='claude' ? API_PARAMETERS.slice(0,2).map(p=>p[0]==='temperature'?[...p.slice(0,4),1,p[5]]:p) : API_PARAMETERS;
export function apiDefaults(value={}) { return {...normalizeApi(value),...defaults}; }
const valueText=value=>value===null || value===undefined ? '' : String(value).trim();
export function normalizeApi(value={}) {
    if(!value || typeof value!=='object' || Array.isArray(value))value={};
    const api={provider:value.provider==='claude'?'claude':'openai',mode:value.mode==='independent'?'independent':'host',transport:value.transport==='direct'?'direct':'host',baseUrl:text(value.baseUrl).trim(),apiKey:text(value.apiKey).trim(),model:text(value.model).trim(),stream:value.stream===true};
    for(const key of Object.keys(defaults))api[key]=hasOwn(value,key)?valueText(value[key]):defaults[key];
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
    if(url.pathname==='/' && ['api.openai.com','api.anthropic.com'].includes(url.hostname))url.pathname='/v1';
    url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/(?:chat\/completions|messages)$/,'');
    return url.href.replace(/\/$/,'');
}
export function validateApi(value,requireModel=true) {
    const api=normalizeApi(value);
    api.baseUrl=apiBaseUrl(api.baseUrl);
    if(requireModel && !api.model)throw new Error('请选择或填写模型 ID。');
    for(const [key,,label,min,max,integer] of apiParameters(api.provider))optionalNumber(api[key],label,min,max,integer);
    optionalNumber(api.maxTokens,'输出上限',1,1000000,true);
    optionalNumber(api.contextLimit,'上下文检查上限',1,10000000,true);
    optionalNumber(api.timeout,'请求超时',1,3600,true);
    return {api};
}
