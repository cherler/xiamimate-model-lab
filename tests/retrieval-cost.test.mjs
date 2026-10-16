import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COST_METHODS,COST_PAIRS,selectCost,verifyCost,compareCost,equalCost} from '../apps/web/retrieval-cost-metrics.js';
import {costHtml,loadRetrievalCost} from '../apps/web/retrieval-cost.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
import {caseReading,readingHref} from '../apps/web/case-reading.js';
import {sectionHref} from '../apps/web/navigation-state.js';
const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url))),dir='apps/web/retrieval-cost-results/';
const m=read(dir+'manifest.json'),p=read(dir+m.path),pm=read('apps/web/retrieval-results/manifest.json'),parent=read('apps/web/retrieval-results/'+pm.path);
test('all five complete pipeline metrics, timing quantiles and losses are recomputed from300 queries',()=>{
 assert.equal(verifyCost(p,parent),p);assert.equal(p.costs.documents,5183);
 for(const m of Object.keys(COST_METHODS)){const same=compareCost(p.rows,m,m);assert.equal(same.delta,0);assert.equal(same.ties,300);assert.equal(same.lost_targets10,0);}
 assert.equal(p.audit_summary.targets_missing50,21);
 assert.equal(p.summary.outside50.colbert50.found10,0);
});
test('candidate restrictions, timing, labels and damaged summaries fail verification',()=>{
 const mutations=[x=>x.rows.pop(),x=>x.rows[0].timing.hybrid.total_ms=0,x=>x.rows[0].timing.hybrid.total_ms=NaN,x=>x.rows[0].metrics.colbert_full.ndcg_at_10+=.01,x=>x.summary.timing.hybrid.p95_ms+=1,x=>x.summary.comparisons[0].losses++,x=>x.rows[0].outside50.push('wrong'),x=>x.rows[0].rankings.colbert50[0]=x.rows[0].rankings.colbert50[99],x=>x.costs.documents--,x=>x.protocol.methods.pop()];
 for(const mutate of mutations){const x=structuredClone(p);mutate(x);assert.throws(()=>verifyCost(x,parent));}
 assert.throws(()=>equalCost(NaN,NaN));
});
test('every comparison and filter preserves overall evidence and shows honest timing scope',()=>{
 for(const pair of Object.keys(COST_PAIRS))for(const filter of ['all','outside','better','worse']){
  const params=new URLSearchParams({costPair:pair,costFilter:filter}),s=selectCost(p,params),html=costHtml({data:p,manifest:m},parent,params);
  for(const phrase of ['全部 300 条查询','5,183 篇文献','不是服务 SLA','不相加组件','同时丢失','未标注相关不等于确定无关','前 100']){
   if(phrase==='不相加组件')assert.match(html,/不把各阶段 P95 相加/);else assert.ok(html.includes(phrase),phrase);
  }
  if(filter==='outside')assert.equal(s.rows.length,21);
  if(filter==='worse')assert.equal(s.rows.length,s.comparison.losses);
 }
});
test('cost route and evidence links remain in E10; top-level methods round-trip restores cost view',()=>{
 const q=resolveRoute('#retrieve?case=scifact&view=costs').params;assert.equal(q.get('view'),'costs');
 assert.match(caseReading('retrieve',q).scope,/完整串行/);assert.match(readingHref('retrieve',q,'evidence'),/view=costs/);
 const to=sectionHref('models','retrieve',q),back=sectionHref('case','retrieve',new URLSearchParams(to.split('?')[1]));assert.match(back,/view=costs/);
});
test('unavailable and corrupt static exports do not fall back to old timing',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('',{status:404});await assert.rejects(loadRetrievalCost(parent),/尚未导出/);
  globalThis.fetch=async u=>String(u).endsWith('manifest.json')?Response.json(m):new Response('{}');await assert.rejects(loadRetrievalCost(parent),/校验失败/);
  globalThis.fetch=async u=>String(u).endsWith('manifest.json')?Response.json(m):new Response(fs.readFileSync(new URL('../'+dir+m.path,import.meta.url)));
  assert.equal((await loadRetrievalCost(parent)).data.run_id,p.run_id);
 }finally{globalThis.fetch=original;}
});
