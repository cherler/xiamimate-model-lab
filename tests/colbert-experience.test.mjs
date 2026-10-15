import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {colbertSelection,colbertExperienceHtml,colbertHref,COLBERT_PAIRS,retrievalExperiment} from '../apps/web/colbert-experience.js';
import {caseReading} from '../apps/web/case-reading.js';
const read=dir=>{const m=JSON.parse(fs.readFileSync(new URL(`../apps/web/${dir}/manifest.json`,import.meta.url)));return JSON.parse(fs.readFileSync(new URL(`../apps/web/${dir}/${m.path}`,import.meta.url)));};
const p=read('colbert-results'),parent=read('retrieval-results');
test('entry offers controlled study while explicit legacy method URLs retain original experiment',()=>{
 assert.equal(retrievalExperiment(new URLSearchParams()),true);
 assert.equal(retrievalExperiment(new URLSearchParams('model=rerank&baseline=bm25')),false);
 assert.equal(retrievalExperiment(new URLSearchParams('experiment=baseline')),false);
 assert.equal(retrievalExperiment(new URLSearchParams('experiment=colbert&model=rerank')),true);
 assert.equal(retrievalExperiment(new URLSearchParams(),'report'),false);
});
test('every contrast and filter partitions all queries without changing global aggregates',()=>{
 for(const pair of Object.keys(COLBERT_PAIRS)){
  const all=colbertSelection(p,new URLSearchParams({colbertPair:pair}));
  const groups=['better','worse','tied'].map(outcome=>colbertSelection(p,new URLSearchParams({colbertPair:pair,colbertOutcome:outcome})));
  assert.equal(groups.reduce((n,g)=>n+g.rows.length,0),300);assert.deepEqual(groups.map(g=>g.rows.length),[all.comparison.wins,all.comparison.losses,all.comparison.ties]);
  for(const g of groups){assert.equal(g.comparison,all.comparison);assert.ok(g.rows.includes(g.row));}
 }
 const defaults=colbertSelection(p,new URLSearchParams('colbertPair=bogus&colbertOutcome=bogus&query=bogus'));assert.equal(defaults.pair,'model_full');assert.equal(defaults.row.id,p.rows[0].id);
});
test('decline route restores matching query and contrast without substituting best sample',()=>{
 const s=colbertSelection(p,new URLSearchParams('colbertOutcome=worse'));
 const query=new URLSearchParams(colbertHref(s).split('?')[1]);assert.equal(colbertSelection(p,query).row.id,s.row.id);assert.equal(s.rows.length,31);
 assert.equal(query.get('experiment'),'colbert');assert.equal(query.get('colbertOutcome'),'worse');assert.ok(s.row.metrics.colbert_chunks.ndcg_at_10<s.row.metrics.cross_chunks.ndcg_at_10);
});
test('customer view uses saved global evidence and same-query titles, with costs and limits visible',()=>{
 const s=colbertSelection(p,new URLSearchParams('colbertOutcome=worse')),html=colbertExperienceHtml(p,parent,s);
 assert.match(html,/56 条改善、31 条退步、213 条持平/);assert.match(html,/0.6952 → 0.7183/);assert.match(html,/本查询 NDCG@10 退步/);
 assert.match(html,/804.5796 MiB/);assert.match(html,/809.57/);assert.match(html,/24.92/);assert.match(html,/不含候选召回/);assert.match(html,/同一查询前十篇对照/);assert.match(html,/原 51–100 不变/);assert.match(html,/未标注相关不等于确知无关/);
 for(const m of [s.comparison.model,s.comparison.baseline])for(const id of s.row.rankings[m].slice(0,10))assert.ok(html.includes(parent.documents[id].title.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;').replaceAll('<','&lt;').replaceAll('>','&gt;')));
 assert.doesNotMatch(html,/NaN|undefined|<details open/);
});
test('coverage contrast cannot be presented as pure model gain; evidence strings are escaped',()=>{
 const s=colbertSelection(p,new URLSearchParams('colbertPair=coverage_cross'));assert.match(colbertExperienceHtml(p,parent,s),/不能称作换模型增益/);
 const row={...s.row,text:'<img src=x onerror=x>'},html=colbertExperienceHtml(p,parent,{...s,row});assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
 assert.match(caseReading('retrieve',new URLSearchParams('case=scifact&experiment=colbert')).verdict,/同文本、同候选/);
});
