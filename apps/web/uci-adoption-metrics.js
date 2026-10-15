import {UCI_MODELS} from './uci-static.js';
export const ADOPTION_GROUPS=['cold','1–5','6–20','21+'];
export const adoptionGroup=n=>n===0?'cold':n<=5?'1–5':n<=20?'6–20':'21+';
const sum=a=>a.reduce((x,y)=>x+y,0);
const mean=a=>a.length?sum(a)/a.length:null;
const near=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=1e-8;
export function verifyAdoption(p,manifest,report){
 const fail=why=>{throw new Error('UCI 推荐采用证据校验失败：'+why);};
 if(p?.schema!=='uci-adoption-v1'||p.parent_run!==manifest.run_id||p.parent_version!==manifest.version||p.protocol?.parent_version!==manifest.version||p.protocol.parent_run!==manifest.run_id||p.protocol.schema!=='uci-adoption-protocol-v1'||JSON.stringify(p.protocol.models)!==JSON.stringify(UCI_MODELS)||JSON.stringify(p.protocol.groups)!==JSON.stringify(ADOPTION_GROUPS)||p.protocol.policy.k!==10||p.protocol.policy.exclude_purchased!==false||p.protocol.policy.exploration!==0)fail('协议或父版本');
 const sources=['report.json','diagnostics.json','recommendation-diagnostics.csv.gz',...UCI_MODELS.map(m=>`validation-predictions-${m}.csv.gz`)];
 if(sources.length!==Object.keys(p.protocol.sources||{}).length||sources.some(n=>p.protocol.sources[n]!==manifest.files[n]?.sha256||p.audit.sources[n]!==manifest.files[n]?.sha256))fail('源文件');
 if(p.audit.protocol_sha256!==p.protocol_sha256||p.audit.parent_version!==manifest.version||p.audit.parent_run!==manifest.run_id||p.audit.rows_per_method!==4280||p.audit.unique_customers!==2845||p.audit.model_count!==9||p.records?.length!==4280)fail('审计');
 const keys=new Set(),customers=new Set();
 for(const r of p.records){
  const key=r.origin+':'+r.customer;if(keys.has(key)||!p.protocol.origins.includes(r.origin)||!/^\d+$/.test(r.customer)||!ADOPTION_GROUPS.includes(r.activity))fail('顾客窗口');keys.add(key);customers.add(r.customer);
  if(![r.targets,r.oov,r.repeat,r.novel].every(x=>Number.isSafeInteger(x)&&x>=0)||!r.targets||r.oov>r.targets||r.repeat+r.novel!==r.targets||r.activity==='cold'&&r.repeat!==0)fail('目标分母');
  if(JSON.stringify(Object.keys(r.methods).sort())!==JSON.stringify([...UCI_MODELS].sort()))fail('方法范围');
  for(const model of UCI_MODELS){const v=r.methods[model];
   if(!v||!Number.isFinite(v.ndcg)||v.ndcg<0||v.ndcg>1+1e-12||![v.hits,v.repeat_hits,v.novel_hits].every(x=>Number.isInteger(x)&&x>=0)||v.hits>Math.min(10,r.targets-r.oov)||v.repeat_hits>r.repeat||v.novel_hits>r.novel||v.repeat_hits+v.novel_hits!==v.hits||typeof v.fallback!=='boolean')fail('指标或命中数');
   if(r.activity==='cold'&&(model!=='popular'&&!v.fallback||!near(v.ndcg,r.methods.popular.ndcg)||v.hits!==r.methods.popular.hits))fail('冷启动回退');
  }
 }
 if(customers.size!==2845)fail('独立顾客数');
 for(const group of ADOPTION_GROUPS)if(p.records.filter(r=>r.activity===group).length!==p.audit.groups[group])fail('历史分组');
 for(const model of UCI_MODELS)for(const w of report.recommendation.models[model].windows){
  const rows=p.records.filter(r=>r.origin===w.origin);
  if(rows.length!==w.users||rows.length!==p.audit.origins[w.origin]||!near(mean(rows.map(r=>r.methods[model].ndcg)),w.ndcg)||!near(mean(rows.map(r=>r.methods[model].hits/r.targets)),w.recall)||!near(mean(rows.map(r=>Number(r.methods[model].hits>0))),w.hit_rate))fail('原窗口成绩');
 }
 return p;
}
function metrics(rows,model){
 return {ndcg:mean(rows.map(r=>r.methods[model].ndcg)),recall:mean(rows.map(r=>r.methods[model].hits/r.targets)),hits:sum(rows.map(r=>r.methods[model].hits)),fallback:rows.filter(r=>r.methods[model].fallback).length,
  repeat_recall:mean(rows.filter(r=>r.repeat).map(r=>r.methods[model].repeat_hits/r.repeat)),novel_recall:mean(rows.filter(r=>r.novel).map(r=>r.methods[model].novel_hits/r.novel))};
}
export function adoptionPair(records,model,baseline,group='all',origin=null){
 if(!UCI_MODELS.includes(model)||!UCI_MODELS.includes(baseline)||!['all',...ADOPTION_GROUPS].includes(group))throw new Error('不支持的推荐配对');
 const rows=records.filter(r=>(group==='all'||r.activity===group)&&(!origin||r.origin===origin));
 const gains=rows.map(r=>r.methods[model].ndcg-r.methods[baseline].ndcg),current=metrics(rows,model),base=metrics(rows,baseline);
 return {n:rows.length,customers:new Set(rows.map(r=>r.customer)).size,targets:sum(rows.map(r=>r.targets)),oov:sum(rows.map(r=>r.oov)),capacity_loss:sum(rows.map(r=>Math.max(0,r.targets-r.oov-10))),ideal_recall:mean(rows.map(r=>Math.min(10,r.targets-r.oov)/r.targets)),repeat_rows:rows.filter(r=>r.repeat).length,novel_rows:rows.filter(r=>r.novel).length,repeat_targets:sum(rows.map(r=>r.repeat)),novel_targets:sum(rows.map(r=>r.novel)),
  current,base,ndcg_delta:rows.length?current.ndcg-base.ndcg:null,recall_delta:rows.length?current.recall-base.recall:null,
  wins:gains.filter(x=>x>1e-12).length,ties:gains.filter(x=>Math.abs(x)<=1e-12).length,losses:gains.filter(x=>x< -1e-12).length};
}
export function adoptionConclusion(pair,windows,{cold=false,same=false,matched=true}={}){
 if(!matched)return '当前经营规则未评估；不能用默认 Top 10 的人群成绩判断当前设置是否更好。';
 if(!pair.n)return '这组没有可评分样本，采用依据不足。';
 if(same)return '当前与对照为同一方法，不产生增量。';
 if(cold)return '无可用历史时，已核验各方法实际返回同一热门列表；适用的是热门回退，尚无个性化增益依据。';
 const gains=windows.filter(w=>w.n&&w.ndcg_delta>1e-12).length,losses=windows.filter(w=>w.n&&w.ndcg_delta< -1e-12).length;
 if(pair.ndcg_delta>1e-12)return losses?`平均排序质量有增益，但 ${losses} 个窗口退步；只作为进一步验证的候选，不自动替换规则。`:`${gains} 个窗口观察到排序增益；可优先验证当前方案，仍不能据此承诺某位顾客会改善。`;
 if(pair.ndcg_delta< -1e-12)return '当前方法平均排序质量低于对照；现有证据支持保留对照方案，不因模型更复杂而替换。';
 return '这组平均排序质量持平，尚无增加模型复杂度的增益依据。';
}
