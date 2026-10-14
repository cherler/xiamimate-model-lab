import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {documentTrace,pipelineCounts,termEvidence,traceView,GROUPS,queryGroup,groupedQueries,groupSummary,groupView,pipelineView} from '../apps/web/retrieval-depth.js';
const root='apps/web/retrieval-results/',m=JSON.parse(fs.readFileSync(root+'manifest.json')),p=JSON.parse(fs.readFileSync(root+m.path));
test('every relevant document has one pipeline stage and reranking preserves candidate recall',()=>{
 for(const k of [5,10]){
  const c=pipelineCounts(p.queries,k);assert.equal(Object.values(c.counts).reduce((a,b)=>a+b,0),c.total);
  let before=0,after=0;
  for(const q of p.queries)for(const id of Object.keys(q.relevant)){
   const t=documentTrace(q,id,k);assert.equal(t.rrf,t.contributions.bm25+t.contributions.dense);
   if(q.rankings.hybrid.slice(0,k).includes(id))before++;if(q.rankings.rerank.slice(0,k).includes(id))after++;
   assert.equal(t.stage==='hit',q.rankings.rerank.slice(0,k).includes(id));
   if(t.stage==='pool_cut')assert.equal(t.ranks.hybrid,t.ranks.rerank);
  }
  assert.equal(after-before,c.promoted-c.removed);assert.equal(after,c.counts.hit);
 }
});
test('trace separates all candidate cutoffs and lexical evidence is literal',()=>{
 const q={rankings:{bm25:['union','pool','rank','hit'],dense:[],hybrid:['hit','rank',...Array.from({length:48},(_,i)=>String(i)),'pool'],rerank:['hit',...Array.from({length:9},(_,i)=>String(i)),'rank',...Array.from({length:39},(_,i)=>String(i+9)),'pool']}};
 assert.equal(documentTrace(q,'none').stage,'not_recalled');assert.equal(documentTrace(q,'union').stage,'fusion_cut');assert.equal(documentTrace(q,'pool').stage,'pool_cut');assert.equal(documentTrace(q,'rank').stage,'rank_cut');assert.equal(documentTrace(q,'hit').stage,'hit');
 assert.deepEqual(termEvidence('Cell CELL no 2-way',{title:'CELL 2',text:'way differs'}),{queryTerms:['cell','no','2','way'],title:['cell','2'],body:['way'],missing:['no']});
 assert.throws(()=>documentTrace(q,'hit',50));
});
test('trace does not fabricate unannotated negatives or token attributions',()=>{
 const q=p.queries[0],s={k:10,model:'rerank',base:'bm25',document:q.rankings.bm25.find(id=>!Object.hasOwn(q.relevant,id))};
 const html=traceView(p,q,s);assert.match(html,/不能认定它确实无关/);assert.match(html,/未导出 token 截断位置/);assert.match(html,/view=report/);
 const changed=structuredClone(p);changed.documents[s.document].title='<script>alert(1)</script>';assert.match(traceView(changed,q,s),/&lt;script&gt;/);
});

test('query groups depend only on text, are exhaustive, and preserve all 300 queries',()=>{
 for(const [dimension,config] of Object.entries(GROUPS)){
  const groups=Object.keys(config.groups).map(key=>groupedQueries(p.queries,dimension,key));
  assert.equal(groups.flat().length,300);assert.equal(new Set(groups.flat().map(q=>q.id)).size,300);
  const altered=p.queries.map(q=>({id:q.id,text:q.text,relevant:{},metrics:{},milliseconds:{},rankings:{}}));
  for(const key of Object.keys(config.groups))assert.deepEqual(groupedQueries(altered,dimension,key).map(q=>q.id),groupedQueries(p.queries,dimension,key).map(q=>q.id));
 }
 assert.equal(queryGroup('a '.repeat(10),'length'),'short');assert.equal(queryGroup('a '.repeat(11),'length'),'medium');assert.equal(queryGroup('a '.repeat(21),'length'),'long');
 assert.equal(queryGroup('NOT-a signal','negation'),'yes');assert.equal(queryGroup('notable signal','negation'),'no');assert.equal(queryGroup('IL-2','digits'),'yes');
 assert.throws(()=>groupedQueries(p.queries,'length','absent'));
});
test('group weighted means reconstruct the full benchmark and timing uses individual totals',()=>{
 for(const k of [5,10])for(const model of ['bm25','dense','hybrid','rerank'])for(const base of ['bm25','dense','hybrid','rerank']){
  const all=groupSummary(p.queries,model,base,k);assert.equal(all.improved+all.tied+all.worse,300);
  if(model===base){assert.equal(all.tied,300);assert.equal(all.improved+all.worse,0);}
  if(k===10)assert.ok(Math.abs(all[model].ndcg-p.report.summary[model].ndcg_at_10)<1e-12);
  for(const [dimension,config] of Object.entries(GROUPS)){
   const groups=Object.keys(config.groups).map(key=>groupSummary(groupedQueries(p.queries,dimension,key),model,base,k));
   for(const metric of ['ndcg','recall','mrr'])assert.ok(Math.abs(groups.reduce((sum,g)=>sum+(g.n?g[model][metric]*g.n:0),0)/300-all[model][metric])<1e-12);
   for(const metric of ['improved','tied','worse'])assert.equal(groups.reduce((sum,g)=>sum+g[metric],0),all[metric]);
  }
 }
 const q=p.queries[0],fake=[1,3,100].map(ms=>({...q,milliseconds:{bm25:ms,rerank:ms+10}}));
 const a=groupSummary(fake,'rerank','bm25');assert.equal(a.bm25.p50,3);assert.ok(Math.abs(a.bm25.p95-90.3)<1e-10);assert.equal(a.rerank.p50,13);
 const empty=groupSummary([],'rerank','bm25');assert.equal(empty.n,0);assert.equal(empty.rerank.ndcg,null);assert.equal(empty.bm25.p95,null);
 assert.throws(()=>groupSummary(p.queries,'fake','bm25'));assert.throws(()=>groupSummary(p.queries,'bm25','bm25',100));
});
test('diagnostic views declare denominators, descriptive rules and empty groups honestly',()=>{
 const s={model:'rerank',base:'hybrid',k:5,groupBy:'length',group:'long'};
 const html=groupView(p,s);assert.match(html,/事后描述性诊断/);assert.match(html,/NDCG@5/);assert.match(html,/未做显著性检验/);
 const small={queries:[p.queries[0]]};assert.match(groupView(small,s),/没有查询，不生成指标/);
 assert.match(pipelineView(p,5),/不等于逐查询平均 Recall/);assert.match(pipelineView(p,5),/前 5/);
});
