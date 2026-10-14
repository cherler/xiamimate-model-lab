import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_ROADMAPS,modelRoadmapHtml} from '../apps/web/model-roadmap.js';
import {BUSINESSES} from '../apps/web/navigation-state.js';
test('all seven business plans describe data, outcomes and validation without invented scores',()=>{
 assert.deepEqual(Object.keys(MODEL_ROADMAPS).sort(),BUSINESSES.map(x=>x.id).sort());
 for(const {id} of BUSINESSES){
  const plan=MODEL_ROADMAPS[id];assert.equal(plan.paths.length,2);
  for(const p of plan.paths)for(const key of ['name','priority','problem','data','method','output','validation','limit'])assert.ok(p[key]?.length>3,`${id}: ${key}`);
  const html=modelRoadmapHtml(id);assert.match(html,id==='segments'?/本轮已实现 · 保存结果见案例报告/:id==='retrieve'?/同池重排开发评估已完成/:id==='recommend'?/适配审查已完成 · 模型效果尚待验证/:/规划 · 尚未运行以下升级实验/);assert.equal((html.match(/<details/g)||[]).length,3);assert.equal((html.match(/<details[^>]* open/g)||[]).length,0);assert.doesNotMatch(html,/scenario-expansion|data-scenario-jump/);
  assert.doesNotMatch(html,/已超越|已提升|准确率达到|<script|NaN|undefined/);
 }
 assert.equal(modelRoadmapHtml('unknown'),'');
});
test('plans preserve material case-specific boundaries and distinguish method from representation',()=>{
 assert.match(modelRoadmapHtml('recommend'),/不按商品编号伪造先后/);
 assert.match(modelRoadmapHtml('forecast'),/24 商品/);
 assert.match(modelRoadmapHtml('classify'),/以数值特征为主/);
 assert.match(modelRoadmapHtml('retrieve'),/300 条已知评估查询/);
 assert.match(modelRoadmapHtml('anomaly'),/三条独立 NAB 单变量/);
 assert.match(modelRoadmapHtml('segments'),/PCA 只用于展示/);
 assert.match(modelRoadmapHtml('segments'),/相同偏好特征上的 K-means 与 Leiden/);
 assert.match(modelRoadmapHtml('decision'),/当前已将销量预测、需求场景/);
 assert.match(modelRoadmapHtml('decision'),/仿真收益不能当成客户收益/);
});

import {readinessModule} from '../scripts/export-model-readiness.mjs';
import {readFile} from 'node:fs/promises';
import {MODEL_READINESS} from '../apps/web/model-readiness.js';
test('readiness figures remain bound to actual audits and separate from quality claims',async()=>{
 assert.equal(await readFile(new URL('../apps/web/model-readiness.js',import.meta.url),'utf8'),await readinessModule());
 const r=MODEL_READINESS.retrieval,s=MODEL_READINESS.sequence;
 assert.match(modelRoadmapHtml('recommend'),new RegExp(s.uci.customers.toLocaleString('zh-CN')));
 assert.match(modelRoadmapHtml('retrieve'),new RegExp(r.truncated.toLocaleString('zh-CN')));
 assert.match(modelRoadmapHtml('retrieve'),/不是端到端延迟/);assert.match(modelRoadmapHtml('recommend'),/未训练 SASRec/);
 assert.match(modelRoadmapHtml('retrieve'),/未做领域微调、质量评分或官方 PLAID 验收/);
 assert.doesNotMatch(modelRoadmapHtml('forecast'),/readiness-review/);
});

import {SCENARIO_EXPANSIONS,scenarioExpansionHtml} from '../apps/web/scenario-expansion.js';
test('scenario reports distinguish unverified business settings from local evidence',()=>{
 assert.deepEqual(Object.keys(SCENARIO_EXPANSIONS).sort(),BUSINESSES.map(x=>x.id).sort());
 const ids=new Set();
 for(const {id} of BUSINESSES){
  const html=scenarioExpansionHtml(id);assert.match(html,/以下扩展场景尚未实证/);assert.match(html,/不能替代这些扩展场景的验证/);
  for(const s of SCENARIO_EXPANSIONS[id].scenarios){
   for(const key of ['title','signal','data','baseline','method','deliverable','validation','limit'])assert.ok(s[key]?.length>(key==='title'?5:15),`${id}.${s.id}.${key}`);
   const anchor=`scenario-${id}-${s.id}`;assert.ok(!ids.has(anchor));ids.add(anchor);
   assert.ok(html.includes(`id="${anchor}"`));assert.ok(html.includes(`data-scenario-jump="${id}-${s.id}"`));assert.equal(new URL(s.source).protocol,'https:');
  }
 }
 assert.equal(ids.size,21);assert.equal(scenarioExpansionHtml('missing'),'');
 assert.match(scenarioExpansionHtml('recommend'),/真实时间戳/);assert.match(scenarioExpansionHtml('recommend'),/不自动建模实际时间间隔/);
 assert.match(scenarioExpansionHtml('segments'),/不是另一种聚类算法/);
 assert.match(scenarioExpansionHtml('decision'),/非预知约束/);
});

import {renderScenarioExpansion} from '../apps/web/scenario-expansion.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
import {navigationContext} from '../apps/web/navigation-state.js';
test('standalone scenario reports link back to the same business and preserve case selection',()=>{
 for(const {id,caseId} of BUSINESSES){
  const host={innerHTML:'',querySelectorAll:()=>[]};
  renderScenarioExpansion(host,id,new URLSearchParams({case:caseId,model:'chosen',item:'84077',experienceView:'report'}));
  assert.match(host.innerHTML,/<h1>场景扩展<\/h1>/);assert.doesNotMatch(host.innerHTML,/class="model-roadmap/);
  for(const match of host.innerHTML.matchAll(/href="(#[^"]+)"/g)){
   const r=resolveRoute(match[1].replaceAll('&amp;','&'));if(r.page==='delivery')continue;
   assert.equal(navigationContext(r.page,r.params).business,id);
   for(const [key,value] of Object.entries({case:caseId,model:'chosen',item:'84077'}))assert.equal(r.params.get(key),value);
   if(r.page===id)assert.equal(r.params.get('view'),'report');
  }
 }
});
