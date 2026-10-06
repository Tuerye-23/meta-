import { AI_PROMPT, HEAD_PROMPT, EXTRACTION_PROMPT } from './prompts.js';
import { literalMacros, replaceNames, text } from './core.js';

export function targetNames(value) {
    const names = text(value).split(/[\n,，;；]+/).map(x=>x.trim()).filter(Boolean);
    if(!names.length)throw new Error('请填写要提取的角色姓名，每行一位。');
    if(names.length>20 || names.some(n=>n.length>160 || /[【】\r]/.test(n)))throw new Error('一次最多选择 20 位角色，姓名不能包含标题括号。');
    if(new Set(names).size!==names.length)throw new Error('角色姓名重复，请检查后再提取。');
    return names;
}

export function personaRequest(names,sources,settings,userName='用户') {
    const material=sources.map(s=>`[来源：${s.label}]\n${s.text}`).join('\n\n');
    if(material.length>150000)throw new Error('素材超过 15 万字符，请减少条目或分批提取。');
    const bind=value=>literalMacros(replaceNames(value,userName,names.join('、')));
    return {systemPrompt:bind(settings.headPrompt ?? HEAD_PROMPT),prompt:[
        {role:'assistant',content:bind(settings.aiPrompt ?? AI_PROMPT)},
        {role:'system',content:EXTRACTION_PROMPT},
        {role:'user',content:literalMacros(`所选角色：\n${names.join('\n')}\n\n请依次使用以下完整标题，每个标题后写该角色的人设正文：\n${names.map(name=>`【${name}】`).join('\n')}\n姓名照抄标题，不缩写、不翻译，不输出未选人物的独立人设。\n\n以下是原始素材：\n${material}`)},
    ],responseLength:4096};
}

// Body section headings are not additional contacts. Keep them in the original prose.
const PERSONA_SECTIONS=new Set(('身份 姓名 名字 别名 年龄 性别 种族 职业 外貌 外观 外貌特征 性格 性格特征 性格与行为习惯 背景 背景故事 背景设定 身世 经历 人物关系 关系 与用户的关系 能力 能力与限制 限制 弱点 语言习惯 说话方式 对话示例 喜好 爱好 习惯 动机 目标 设定 人设 基础信息 基本信息 个人信息 角色资料 角色描述 描述 补充设定 世界观 共同背景 当前处境 注意事项 name identity appearance personality background history relationships abilities limitations speech examples interests goals notes').split(' '));
const normalizeName=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();

export function parsePersonas(raw,names,knownNames=names) {
    const content=text(raw).replace(/\r\n?/g,'\n').trim().replace(/^```(?:text|markdown)?[ \t]*\n/i,'').replace(/\n```$/,'').trim();
    if(!content)throw new Error('模型没有返回人设正文。');
    const expected=new Map(names.map(name=>[normalizeName(name),name]));
    if(expected.size!==names.length)throw new Error('所选姓名无法明确区分，请分别提取。');
    const known=new Set(knownNames.map(normalizeName)),headings=[];
    for(const match of content.matchAll(/^([^\n]+)$/gm)) {
        const line=match[0].trim(),markdown=/^(?:#{1,6}\s+|\*\*|__)/.test(line);
        let label=line.replace(/^#{1,6}\s+/,'').replace(/\s+#+$/,'').replace(/^(\*\*|__)(.*?)\1$/,'$2').trim();
        const bracket=label.match(/^【([^【】]+)】$/);
        if(bracket)label=bracket[1].trim();
        else if(!markdown || !known.has(normalizeName(label)))continue;
        const key=normalizeName(label);
        if(!known.has(key) && PERSONA_SECTIONS.has(key))continue;
        headings.push({index:match.index,end:match.index+match[0].length,name:expected.get(key) || label});
    }
    const restoreNames=value=>value.replace(/｛｛(user|char)｝｝/gi,(_,name)=>'{{'+name.toLowerCase()+'}}');
    if(names.length===1 && !headings.length)return [{name:names[0],description:restoreNames(content)}];
    if(!headings.length || content.slice(0,headings[0].index).trim())throw new Error('提取结果缺少角色标题，或标题前包含额外文字；需要以【角色姓名】开始。未保存任何联系人，请重试。');
    const result=headings.map((h,i)=>({name:h.name,description:restoreNames(content.slice(h.end,headings[i+1]?.index ?? content.length).trim())}));
    const missing=names.filter(n=>!result.some(r=>r.name===n));
    const extra=[...new Set(result.filter(r=>!names.includes(r.name)).map(r=>r.name))];
    const duplicate=[...new Set(result.filter((r,i)=>result.findIndex(p=>p.name===r.name)!==i).map(r=>r.name))];
    const empty=result.filter(r=>!r.description).map(r=>r.name);
    const issues=[missing.length?`缺少：${missing.join('、')}`:'',extra.length?`未选中或姓名不同：${extra.join('、')}`:'',duplicate.length?`重复：${duplicate.join('、')}`:'',empty.length?`人设为空：${empty.join('、')}`:''].filter(Boolean);
    if(issues.length)throw new Error(`提取结果校验失败（${issues.join('；')}）。未保存任何联系人，请重试。`);
    return names.map(n=>result.find(r=>r.name===n));
}

export function definitionProfile(card,entries,userName,userPersona) {
    const format=list=>list.map(e=>`[${e.label}]\n${e.content}`).join('\n\n');
    return {name:card.name,description:card.description,personality:card.personality,scenario:card.scenario,speech:card.examples,
        sourceCharacterName:card.name,worldBefore:format(entries.filter(e=>e.position===0 || e.position==='before_char')),
        worldAfter:format(entries.filter(e=>e.position!==0 && e.position!=='before_char')),
        userName,userPersona,personaMode:'inherit',binding:card.binding,
        sourceText:[card.sourceText,format(entries)].filter(Boolean).join('\n\n'),sources:[`角色卡 ${card.name}`,...entries.map(e=>e.label)]};
}

export function recognitionRequest(sources,settings,userName='用户') {
    const request=personaRequest(['待识别人物'],sources,settings,userName);
    request.prompt[1].content=`识别以下素材中拥有实际人设的角色。只输出角色姓名，每行一位。合并同一人物的别名，不把世界书标题、用户、组织、场景或仅被提到的名字当成联系人。不写编号、解释或人设正文。不能确定任何角色时只输出“未识别到角色”。`;
    request.prompt[2].content=literalMacros('以下是待识别的原始素材：\n'+sources.map(s=>`[来源：${s.label}]\n${s.text}`).join('\n\n'));
    return request;
}
export function parseRecognizedNames(raw) {
    const content=text(raw).trim().replace(/^```(?:text)?\s*\n/i,'').replace(/\n```$/,'');
    if(!content || content==='未识别到角色')throw new Error('未识别到有明确人设的角色，请换一个条目或手动添加。');
    return targetNames(content);
}
