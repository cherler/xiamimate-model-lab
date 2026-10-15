import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {providerConfig,completionClient,runAssistant} from '../services/assistant/runtime.mjs';
try{process.loadEnvFile(new URL('../.env',import.meta.url));}catch(e){if(e.code!=='ENOENT')throw e;}
const config=providerConfig();if(!config)throw new Error('真实模型评估未运行：请先配置 .env 中的 AI 服务。离线测试不能代替任务成功率。');
const taskPath=new URL('../services/assistant/evaluation-tasks.json',import.meta.url),tasks=JSON.parse(await readFile(taskPath));
const ids=process.argv.slice(2);if(ids.some(id=>!tasks.some(t=>t.id===id)))throw new Error('未知评估任务 ID');
const files=['services/assistant/runtime.mjs','services/assistant/tools.mjs','services/assistant/provider.mjs','services/assistant/evidence.mjs','services/assistant/evaluation-tasks.json','apps/web/case-reading.js','apps/web/model-roadmap.js'];
const sourceHashes={};for(const file of files)sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
const folder=new URL('../artifacts/assistant-runs/',import.meta.url);await mkdir(folder,{recursive:true});const name=new Date().toISOString().replace(/[:.]/g,'-')+'.json',results=[];
for(const {review,...task} of tasks.filter(t=>!ids.length||ids.includes(t.id))){
 const {id,...body}=task;if(body.mode==='agent')body.selection={origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5};
 const start=performance.now();try{const output=await runAssistant(body,{complete:completionClient(config),signal:AbortSignal.timeout(90000)});results.push({id,request:body,output,reviewCriterion:review,humanVerdict:'待复核'});}
 catch(e){results.push({id,request:body,error:e.message,ms:Math.round(performance.now()-start),trace:e.trace||[],validation:e.validation||[],usage:e.usage||null,reviewCriterion:review,humanVerdict:'待复核'});}
 await writeFile(new URL(name,folder),JSON.stringify({version:'assistant-eval-v2',model:config.model,protocol:config.protocol,maxTokens:config.maxTokens,thinking:config.thinking,sourceHashes,scope:'已知任务开发联调；需要逐任务复核，不是独立测试或稳定成功率。',results},null,2));
 console.log(id+': '+(results.at(-1).error?'失败，记录已保留':'已返回，待复核'));
}
console.log('真实调用记录已保存：artifacts/assistant-runs/'+name+'；需要核对数值、来源、完整性和失败处理。');
