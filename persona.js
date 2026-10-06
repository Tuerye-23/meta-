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
        {role:'user',content:literalMacros(`所选角色：\n${names.join('\n')}\n\n以下是原始素材：\n${material}`)},
    ],responseLength:4096};
}

export function parsePersonas(raw,names) {
    const content=text(raw).trim().replace(/^```(?:text)?\s*\n/i,'').replace(/\n```$/,'');
    if(!content)throw new Error('模型没有返回人设正文。');
    const headings=[...content.matchAll(/^【([^\n【】]+)】\s*$/gm)];
    const restoreNames=value=>value.replace(/｛｛(user|char)｝｝/gi,(_,name)=>'{{'+name.toLowerCase()+'}}');
    if(names.length===1 && !headings.length)return [{name:names[0],description:restoreNames(content)}];
    if(!headings.length || content.slice(0,headings[0].index).trim())throw new Error('批量结果需要以【角色姓名】分隔，请重试。');
    const result=headings.map((h,i)=>({name:h[1].trim(),description:restoreNames(content.slice(h.index+h[0].length,headings[i+1]?.index ?? content.length).trim())}));
    if(result.length!==names.length || new Set(result.map(r=>r.name)).size!==result.length || result.some(r=>!names.includes(r.name) || !r.description) || names.some(n=>!result.some(r=>r.name===n)))throw new Error('提取结果的姓名或数量与所选角色不一致，未保存任何联系人，请重试。');
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
