import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {verifyUciManifest,verifyUciCustomer} from '../apps/web/uci-static.js';
const near=(a,b)=>{if(a===null||b===null){if(a!==b)throw new Error('UCI 空分母不一致');}else if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>Math.max(1e-9,Math.abs(b)*1e-8))throw new Error('UCI 指标不一致');};
export function forecastMetrics(actual,pred){const total=actual.reduce((a,b)=>a+b,0),error=actual.reduce((s,v,i)=>s+Math.abs(v-pred[i]),0),delta=actual.reduce((s,v,i)=>s+pred[i]-v,0);return {wape:total?error/total:null,mae:error/actual.length,bias:total?delta/total:null};}
export async function verifyUciStatic(root,showcase){
 const manifest=verifyUciManifest(JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'))),loaded={};
 for(const [name,spec] of Object.entries(manifest.files)){const bytes=await readFile(resolve(root,manifest.version,name));if(bytes.length!==spec.bytes||createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error('UCI 静态文件校验失败：'+name);if(name.endsWith('.json'))loaded[name]=JSON.parse(bytes);}
 const report=loaded['report.json'];if(report.run_id!==manifest.run_id||report.schema_version!==3)throw new Error('UCI 报告版本错误');
 const entry=showcase?.cases?.find(c=>c.id==='uci');if(showcase&&(!entry||entry.run_id!==manifest.run_id||entry.report_sha256!==manifest.files['report.json'].sha256||entry.mode!=='saved_replay'))throw new Error('案例目录与 UCI 静态版本不一致');
 const customers=loaded['customers.json'];if(customers.run_id!==manifest.run_id||customers.as_of!==manifest.as_of||JSON.stringify(customers.customers)!==JSON.stringify(manifest.customers))throw new Error('UCI 样本目录不一致');
 for(const id of [...manifest.customers,'new']){const p=verifyUciCustomer(loaded[`customer-${id}.json`],manifest);if(p.customer_id!==id)throw new Error('UCI 样本文件不一致');}
 for(const [name,key,expectedCount,horizon] of [['forecast-series.json','forecast',36,28],['weekly-series.json','weekly',144,1]]){
  const rows=loaded[name],summary=report[key],models=Object.keys(summary.models),scope=new Set();if(rows.length!==expectedCount)throw new Error('UCI 预测范围不完整');
  for(const row of rows){const id=row.origin+':'+row.item;if(scope.has(id)||!summary.windows.some(w=>w.origin===row.origin)||row.history_dates.some(day=>day>=row.origin))throw new Error('UCI 预测时间或商品范围无效');scope.add(id);
   const a=[row.actual].flat();if(a.length!==horizon||!a.every(v=>Number.isFinite(v)&&v>=0))throw new Error('UCI 真实销量无效');
   for(const model of models){const pred=[row.predictions[model]].flat();if(pred.length!==horizon||!pred.every(v=>Number.isFinite(v)&&v>=0))throw new Error('UCI 预测无效');if(key==='forecast')for(const [k,v] of Object.entries(forecastMetrics(a,pred)))near(v,row.metrics[model][k]);}
  }
  for(const origin of [null,...summary.windows.map(w=>w.origin)]){const part=origin?rows.filter(r=>r.origin===origin):rows,actual=part.flatMap(r=>r.actual);if(origin&&part.length!==12)throw new Error('UCI 窗口商品数不一致');for(const model of models){const metrics=forecastMetrics(actual,part.flatMap(r=>r.predictions[model])),saved=origin?summary.windows.find(w=>w.origin===origin).models[model]:summary.models[model].metrics;for(const [k,v] of Object.entries(metrics))near(v,saved[k]);}}
 }
 for(const [name,digest] of Object.entries(loaded['checksums.json']))if(manifest.files[name]&&name!=='checksums.json'&&manifest.files[name].sha256!==digest)throw new Error('UCI 导出与原训练文件不一致');
 return manifest;
}
