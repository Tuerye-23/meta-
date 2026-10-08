import { avatarSource } from './images.js';

export function chatImageSource(value,sticker=false) {
    if(sticker && typeof value==='string' && value.length<=1600000 && /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/.test(value))return value;
    return avatarSource(value);
}
export function normalizeAttachment(value) {
    const kind=value?.kind==='sticker'?'sticker':value?.kind==='image'?'image':null;
    const source=kind && chatImageSource(value.source,kind==='sticker');
    if(!source)throw new Error('图片或表情包地址无效。');
    return {kind,source,name:String(value.name || (kind==='sticker'?'表情包':'图片')).slice(0,160)};
}
export function normalizeStickers(value=[]) {
    if(!Array.isArray(value) || value.length>200)throw new Error('表情包列表格式有误，最多保存 200 个。');
    const ids=new Set();return value.map(item=>{
        if(typeof item?.id!=='string' || !item.id || ids.has(item.id))throw new Error('表情包 ID 无效或重复。');
        ids.add(item.id);return {id:item.id,...normalizeAttachment({...item,kind:'sticker'})};
    });
}
export function normalizeOutbox(value=[]) {
    if(!Array.isArray(value) || value.length>50)throw new Error('待发送消息格式有误，最多暂存 50 条。');
    const ids=new Set();return value.map(item=>{
        if(typeof item?.id!=='string' || !item.id || ids.has(item.id) || typeof item.text!=='string')throw new Error('待发送消息格式有误。');
        ids.add(item.id);const attachment=item.attachment?normalizeAttachment(item.attachment):null;
        if(!item.text.trim() && !attachment)throw new Error('待发送消息为空。');
        return {id:item.id,role:'user',text:item.text,kind:attachment?.kind || 'chat',createdAt:Number(item.createdAt)||0,...(attachment?{attachment}:{})};
    });
}
export function multimodalContent(message,provider='openai') {
    const images=(message.images || []).map(source=>chatImageSource(source)).filter(Boolean);
    if(!images.length)return message.content;
    const parts=[{type:'text',text:message.content || '[图片]'}];
    for(const source of images) {
        if(provider==='claude') {
            const data=source.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
            parts.push({type:'image',source:data?{type:'base64',media_type:data[1],data:data[2]}:{type:'url',url:source}});
        } else parts.push({type:'image_url',image_url:{url:source}});
    }
    return parts;
}
export const attachmentText=attachment=>`[${attachment.kind==='sticker'?'表情包':'图片'}：${attachment.name}]`;

export async function readChatImage(file,sticker=false) {
    if(!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type) || !sticker && file.type==='image/gif')throw new Error(sticker?'请选择 JPG、PNG、WebP 或 GIF 表情包。':'请选择 JPG、PNG 或 WebP 图片。');
    if(file.size>12*1024*1024)throw new Error('请选择小于 12 MB 的图片。');
    const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败。'));reader.readAsDataURL(file);});
    if(sticker && file.type==='image/gif') {if(!chatImageSource(source,true))throw new Error('GIF 表情包过大，请选择小于 1 MB 的文件。');return source;}
    const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片无法解码。'));image.src=source;});
    const size=sticker?512:1440,scale=Math.min(1,size/img.width,size/img.height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前环境无法处理图片。');if(!sticker){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL(sticker?'image/png':'image/jpeg',.82);if(!chatImageSource(result,sticker))throw new Error('处理后的图片仍过大，请换一张较小的图片。');return result;
}
