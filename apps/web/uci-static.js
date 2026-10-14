const required=['report.json','forecast-series.json','weekly-series.json','diagnostics.json','customers.json','checksums.json','NOTICE.txt','forecast-predictions.csv.gz','weekly-predictions.csv.gz','recommendation-diagnostics.csv.gz'];
export const UCI_MODELS=['popular','itemcf','basket','als','ease','personal_frequency','personal_recent','personal_decay','hybrid'];
export function verifyUciManifest(m){
 if(m.schema!=='uci-static-v1'||m.run_id!=='retail-20261012T001149Z'||m.as_of!=='2011-11-01'||!/^[a-f0-9]{16}$/.test(m.version)||m.max_limit!==20||JSON.stringify(m.models)!==JSON.stringify(UCI_MODELS)||JSON.stringify(m.exploration)!==JSON.stringify(Array.from({length:11},(_,i)=>i*10)))throw new Error('UCI 静态版本或支持范围不一致');
 if(m.customers?.length!==24||new Set(m.customers).size!==24||!m.customers.every(id=>/^\d{1,10}$/.test(id)))throw new Error('UCI 顾客范围不完整');
 const names=[...required,...UCI_MODELS.map(id=>`validation-predictions-${id}.csv.gz`),...[...m.customers,'new'].map(id=>`customer-${id}.json`)];
 if(Object.keys(m.files||{}).length!==names.length||names.some(n=>!m.files[n]||!/^[a-f0-9]{64}$/.test(m.files[n].sha256)||!Number.isSafeInteger(m.files[n].bytes)||m.files[n].bytes<1))throw new Error('UCI 资源清单不完整');
 if(m.source_checksums_sha256!==m.files['checksums.json'].sha256)throw new Error('UCI 原产物清单不一致');return m;
}
export function verifyUciCustomer(p,m){
 if(p.schema!=='uci-customer-v1'||p.run_id!==m.run_id||p.as_of!==m.as_of||![...m.customers,'new'].includes(p.customer_id)||!Array.isArray(p.history)||!Number.isInteger(p.history_items)||p.history_items<0)throw new Error('UCI 顾客版本不一致');
 if(p.history.some(r=>typeof r.name!=='string'||!Number.isFinite(r.quantity)||r.quantity<0||typeof r.date!=='string'||r.date.slice(0,10)>=m.as_of))throw new Error('UCI 历史记录无效');
 if(p.customer_id==='new'&&(p.history.length||p.history_items))throw new Error('新客不应有历史');
 for(const id of UCI_MODELS){const entry=p.models?.[id];if(!entry||typeof entry.fallback!=='boolean'||Object.keys(entry.variants||{}).length!==22)throw new Error('UCI 模型回放不完整');
  for(const exclude of [0,1])for(const explore of m.exploration){const v=entry.variants[`${exclude}:${explore}`];if(!v||v.ids.length>m.max_limit||v.ids.length!==v.scores.length||new Set(v.ids).size!==v.ids.length||!v.scores.every(Number.isFinite))throw new Error('UCI 排名无效');
   for(let i=0;i<v.ids.length;i++){const row=entry.products[v.ids[i]];if(!row||row.id!==v.ids[i]||typeof row.name!=='string'||typeof row.purchased_before!=='boolean'||!row.reason?.type||exclude&&row.purchased_before||i>0&&v.scores[i]>v.scores[i-1])throw new Error('UCI 推荐商品无效');}
  }
 }return p;
}
export function replayUci(p,m,body){
 const {customer_id='new',strategy='itemcf',limit=10,exclude_purchased=false,exploration=0}=body||{};
 if(customer_id!==p.customer_id||!m.models.includes(strategy)||!Number.isInteger(limit)||limit<1||limit>m.max_limit||typeof exclude_purchased!=='boolean'||!m.exploration.includes(exploration))throw new Error('不支持的 UCI 回放参数');
 const method=p.models[strategy],variant=method.variants[`${Number(exclude_purchased)}:${exploration}`];
 const items=variant.ids.slice(0,limit).map((id,i)=>{const row=method.products[id],reason={...row.reason};if(Object.hasOwn(reason,'exploration'))reason.exploration=exploration;return {...row,reason,score:variant.scores[i]};});
 return {run_id:m.run_id,as_of:m.as_of,data_origin:'public',customer_id,strategy,fallback:method.fallback,fallback_reason:method.fallback?'No usable history or similarity signal':null,
  evaluation_policy_matches:!exclude_purchased&&exploration===0&&limit===10,history:p.history,history_items:p.history_items,items,replay:true};
}
let manifestPromise,manifest;const resources=new Map();
async function loadManifest(){if(!manifestPromise)manifestPromise=(async()=>{const r=await fetch('./uci-results/manifest.json');if(!r.ok)throw new Error('UCI 静态案例包缺失，请恢复已核验的发布产物。');manifest=verifyUciManifest(await r.json());return manifest;})().catch(e=>{manifestPromise=null;throw e;});return manifestPromise;}
async function resource(name){const m=await loadManifest();if(!Object.hasOwn(m.files,name))throw new Error('UCI 资源不存在');if(!resources.has(name))resources.set(name,(async()=>{const r=await fetch(`./uci-results/${m.version}/${name}`);if(!r.ok)throw new Error(`UCI 文件缺失：${name}`);const bytes=await r.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(bytes.byteLength!==m.files[name].bytes||hash!==m.files[name].sha256)throw new Error(`UCI 文件校验失败：${name}`);return JSON.parse(new TextDecoder().decode(bytes));})().catch(e=>{resources.delete(name);throw e;}));return resources.get(name);}
export async function loadUciReport(expectedRun,expectedHash){const m=await loadManifest();if(expectedRun&&expectedRun!==m.run_id||expectedHash&&expectedHash!==m.files['report.json'].sha256)throw new Error('UCI 静态包与案例目录版本不同');const p=await resource('report.json');if(p.run_id!==m.run_id||p.schema_version!==3)throw new Error('UCI 报告版本不同');return p;}
export async function uciData(path,body){const m=await loadManifest();
 if(path==='experiments/latest')return loadUciReport();
 if(path==='customers'){const p=await resource('customers.json');if(p.run_id!==m.run_id||p.as_of!==m.as_of||JSON.stringify(p.customers)!==JSON.stringify(m.customers))throw new Error('UCI 顾客目录版本不同');return p;}
 if(path==='recommendations'){const id=body?.customer_id??'new';if(![...m.customers,'new'].includes(id))throw new Error('请选择已导出的公开顾客样本');const p=verifyUciCustomer(await resource(`customer-${id}.json`),m);return replayUci(p,m,body);}
 if(path==='forecasts'||path==='weekly-forecasts'){const report=await loadUciReport(),weekly=path==='weekly-forecasts';return {summary:report[weekly?'weekly':'forecast'],series:await resource(weekly?'weekly-series.json':'forecast-series.json'),run_id:m.run_id};}
 if(path==='diagnostics')return {diagnostics:await resource('diagnostics.json'),run_id:m.run_id};
 throw new Error('未知 UCI 静态资源');
}
export function uciDownload(name){if(!manifest||!Object.hasOwn(manifest.files,name))throw new Error('下载文件不在 UCI 清单内');return `./uci-results/${manifest.version}/${name}`;}
export function uciAttribution(){return '<p class="small-note">保存结果回放 · <a href="https://doi.org/10.24432/C5CG6D">UCI Online Retail II，Chen (2012)</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>。本站进行了清洗、训练和历史评估；网页不进行在线训练，规则切换不会生成新的验证成绩。</p>';}
