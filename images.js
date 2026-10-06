const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function avatarSource(value) {
    if(typeof value!=='string')return '';
    const source=value.trim();
    if(source.length<=1600000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(source))return source;
    if(source.length>4096 || !/^https?:\/\//i.test(source))return '';
    try {const url=new URL(source);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password?url.href:'';}catch{return '';}
}
export function avatarMarkup(name,source='',action='',attrs='') {
    const image=avatarSource(source),tag=action?'button':'span';
    return `<${tag} class="mc-avatar" ${action?`type="button" data-action="${action}"`:''} ${attrs}><span class="mc-avatar-fallback">${esc(name?.slice(0,1) || '我')}</span>${image?`<img data-mc-avatar src="${esc(image)}" alt="${esc(name || '我')}的头像" referrerpolicy="no-referrer" loading="lazy">`:''}</${tag}>`;
}

// Resize locally before persistence; never upload the selected image to an API.
export async function readLocalImage(file, size=1440) {
    if(!file || !/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('请选择 JPG、PNG 或 WebP 图片。');
    if(file.size>12*1024*1024)throw new Error('请选择小于 12 MB 的图片。');
    const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败。'));reader.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('图片无法解码。'));img.src=source;});
    const scale=Math.min(1,size/img.width,size/img.height);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前环境无法处理图片。');ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL('image/jpeg',0.82);if(result.length>1600000)throw new Error('处理后的图片仍过大，请换一张较小的图片。');return result;
}
