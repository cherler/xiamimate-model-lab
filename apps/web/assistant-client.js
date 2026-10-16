import {PUBLIC_STATIC} from './public-build.js';
export async function assistantRequest(path,body,signal){
 if(PUBLIC_STATIC)throw new Error('当前公开版未开放在线 AI 服务；可浏览案例、查看固定分析流程，或通过方案与合作页联系。');
 if(location.protocol==='file:')throw new Error('当前为文件预览。请通过本地服务打开；案例静态内容仍可浏览。');
 const r=await fetch(new URL('./api/assistant/'+path,location.href),{signal,method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
 let data;try{data=await r.json();}catch{throw new Error('当前为静态预览，未连接 AI 服务；已有案例和方案整理仍可使用。');}
 if(!r.ok)throw Object.assign(new Error(data.error||'分析服务暂不可用'),{trace:data.trace||[],validation:data.validation||[]});return data;
}
