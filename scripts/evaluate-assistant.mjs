import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {providerConfig,completionClient,runAssistant} from '../services/assistant/runtime.mjs';
try{process.loadEnvFile(new URL('../.env',import.meta.url));}catch(e){if(e.code!=='ENOENT')throw e;}
const config=providerConfig();if(!config)throw new Error('真实模型评估未运行：请先配置 .env 中的 AI 服务。离线测试不能代替任务成功率。');
const tasks=JSON.parse(await readFile(new URL('../services/assistant/evaluation-tasks.json',import.meta.url))),results=[];
for(const {review,...task} of tasks){const {id,...body}=task;if(body.mode==='agent')body.selection={origin:'2011-09-01',model:'lightgbm',budget:1,capacity:1.25,shortage:1.5};try{const r=await runAssistant(body,{complete:completionClient(config),signal:AbortSignal.timeout(90000)});results.push({id,request:body,output:r,reviewCriterion:review,humanVerdict:'待复核'});}catch(e){results.push({id,error:e.message,trace:e.trace||[],reviewCriterion:review,humanVerdict:'待复核'});}}
const folder=new URL('../artifacts/assistant-runs/',import.meta.url);await mkdir(folder,{recursive:true});const name=new Date().toISOString().replace(/[:.]/g,'-')+'.json';await writeFile(new URL(name,folder),JSON.stringify({version:'assistant-eval-v1',model:config.model,scope:'真实调用记录；尚未完成人工逐任务评分，不能汇总成任务成功率。',results},null,2));console.log('真实调用记录已保存：artifacts/assistant-runs/'+name+'；需要人工核对数值、来源、完整性和失败处理。');
