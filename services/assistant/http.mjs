import {providerConfig,completionClient,runAssistant} from './runtime.mjs';
import {executeTool,runWorkflow} from './tools.mjs';
export function createAssistantHandler({config=providerConfig(),complete=config&&completionClient(config),execute=executeTool,workflow=runWorkflow}={}){
 let active=0,used=0,epoch=Date.now();
 return async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith('/api/assistant/'))return false;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  // This optional server is local-only. Do not expose it as an unauthenticated public proxy.
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')){send(403,{error:'仅供本机预览'});return true;}
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){send(403,{error:'不允许跨站调用'});return true;}
  if(path==='/api/assistant/status'&&req.method==='GET'){send(200,{configured:!!complete,model:config?.model||null,protocol:config?.protocol||null,maxTokens:config?.maxTokens||null,workflow:true,scope:'本机预览；真实模型任务成功率待评估'});return true;}
  if(path==='/api/assistant/options'&&req.method==='GET'){try{send(200,await execute('retail_options',{}));}catch{send(503,{error:'已保存补货数据不可用或校验失败'});}return true;}
  if(!['/api/assistant/run','/api/assistant/workflow'].includes(path)){send(404,{error:'接口不存在'});return true;}
  if(req.method!=='POST'){send(405,{error:'需要 POST'});return true;}
  if(!req.headers['content-type']?.startsWith('application/json')){send(415,{error:'需要 JSON 请求'});return true;}
  if(path.endsWith('/run')&&!complete){send(503,{error:'AI 服务尚未配置；可以查看案例证据或运行固定分析流程。'});return true;}
  if(Date.now()-epoch>3600000){used=0;epoch=Date.now();}
  if(active>=2||used>=20){send(429,{error:'本机演示额度或并发已达上限，请稍后再试'});return true;}
  active++;used++;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000),disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
  try{
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>48000)throw new Error('请求过长');chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8')),result=path.endsWith('/workflow')?await workflow(body):await runAssistant(body,{complete,execute,signal:controller.signal});
   send(200,{...result,model:path.endsWith('/workflow')?null:config?.model||'测试替身'});
  }catch(e){const known=/请求|参数|缺少|请填写|案例|组合|模型|工具|回答|任务|分析|补货|日期|服务|JSON|校验/.test(e.message);send(400,{error:controller.signal.aborted?'任务已取消或超时':known?e.message:'分析失败，请检查服务和结果文件后重试',trace:e.trace||[],validation:e.validation||[],usage:e.usage||null});}
  finally{clearTimeout(timer);res.off('close',disconnect);active--;}
  return true;
 };
}
