import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_ROADMAPS,modelRoadmapHtml} from '../apps/web/model-roadmap.js';
import {BUSINESSES} from '../apps/web/navigation-state.js';
test('all seven business plans describe data, outcomes and validation without invented scores',()=>{
 assert.deepEqual(Object.keys(MODEL_ROADMAPS).sort(),BUSINESSES.map(x=>x.id).sort());
 for(const {id} of BUSINESSES){
  const plan=MODEL_ROADMAPS[id];assert.equal(plan.paths.length,2);
  for(const p of plan.paths)for(const key of ['name','priority','problem','data','method','output','validation','limit'])assert.ok(p[key]?.length>3,`${id}: ${key}`);
  const html=modelRoadmapHtml(id);assert.match(html,/规划 · 尚未运行以下升级实验/);assert.equal((html.match(/<details/g)||[]).length,2);assert.equal((html.match(/<details open/g)||[]).length,1);
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
