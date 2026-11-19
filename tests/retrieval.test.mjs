import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {retrievalMetrics,rrf,percentile,compareQueries,verifyRetrieval} from '../apps/web/retrieval-metrics.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
test('retrieval metric math includes unretrieved relevant targets',()=>{
 const m=retrievalMetrics(['x','a','z'],{a:1,missing:1});
 assert.equal(m.recall,.5);assert.equal(m.mrr,.5);
 assert.ok(Math.abs(m.ndcg-(1/Math.log2(3))/(1+1/Math.log2(3)))<1e-12);
 assert.equal(retrievalMetrics(['x'],{a:1}).ndcg,0);
 assert.throws(()=>retrievalMetrics(['a','a'],{a:1}));assert.throws(()=>retrievalMetrics(['a'],{}));
});
test('RRF merges only input candidates with stable lexical ties',()=>{
 assert.deepEqual(rrf(['b','a'],['c','a']),['a','b','c']);
 assert.deepEqual(rrf(['z'],['a']),['a','z']);
 assert.equal(percentile([1,2,3,4],.95),3.8499999999999996);
});
test('query comparison keeps regressions and same-model ties',()=>{
 const queries=[1,0,-1].map(d=>({metrics:{a:{ndcg_at_10:.5+d*.1},b:{ndcg_at_10:.5}}}));
 assert.deepEqual(compareQueries(queries,'a','b'),{improved:1,tied:1,worse:1});
 assert.deepEqual(compareQueries(queries,'a','a'),{improved:0,tied:3,worse:0});
});
test('retrieval routes retain case selection and canonicalize views',()=>{
 const r=resolveRoute('#retrieve');assert.equal(r.page,'retrieve');assert.equal(r.params.get('case'),'scifact');assert.equal(r.params.get('view'),'experience');
 assert.equal(resolveRoute('#retrieve?case=unknown&view=bad').params.get('case'),'unknown');
 assert.equal(resolveRoute('#retrieve?view=bad').params.get('view'),'experience');
});
test('all exported retrieval rows recompute and preserve hashes and attribution',async()=>{
 const root=new URL('../apps/web/retrieval-results/',import.meta.url);
 let manifest;try{manifest=JSON.parse(await readFile(new URL('manifest.json',root)));}catch(e){if(e.code==='ENOENT')throw new Error('Run npm run export:search before retrieval integration tests');throw e;}
 const bytes=await readFile(new URL(manifest.path,root)),p=JSON.parse(bytes);
 const digest=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(digest(bytes),manifest.sha256);verifyRetrieval(p);
 const notice=await readFile(new URL(manifest.notice,root));assert.equal(notice.toString(),p.notice);assert.equal(digest(notice),manifest.notice_sha256);
 const changed=structuredClone(p);changed.queries[0].metrics.bm25.ndcg_at_10+=.01;assert.throws(()=>verifyRetrieval(changed));
 const pool=structuredClone(p);[pool.queries[0].rankings.rerank[0],pool.queries[0].rankings.rerank[99]]=[pool.queries[0].rankings.rerank[99],pool.queries[0].rankings.rerank[0]];assert.throws(()=>verifyRetrieval(pool));
 const sum=structuredClone(p);sum.report.summary.dense.recall_at_10+=.1;assert.throws(()=>verifyRetrieval(sum));
});

test('retrieval source audit matches frozen local rankings, documents and protocol',{
 skip:!existsSync(new URL('../artifacts/retrieval-runs/',import.meta.url))?'Requires local training artifacts, not included in the display release':false
},async()=>{
 const root=new URL('../apps/web/retrieval-results/',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('manifest.json',root)));
 const p=JSON.parse(await readFile(new URL(manifest.path,root)));
 const digest=b=>createHash('sha256').update(b).digest('hex');
 const local=new URL(`../artifacts/retrieval-runs/${manifest.run_id}/`,import.meta.url);
 const rankings=await readFile(new URL('rankings.json',local));assert.equal(digest(rankings),p.report.rankings_sha256);
 assert.equal(digest(await readFile(new URL('documents.json',local))),p.report.documents_sha256);
 assert.equal(digest(await readFile(new URL('protocol.json',local))),p.report.protocol_sha256);
 const original=JSON.parse(rankings);assert.equal(original.length,p.queries.length);
 for(let i=0;i<original.length;i++)for(const key of Object.keys(original[i]))assert.deepEqual(original[i][key],p.queries[i][key]);
});

test('missing retrieval results fail visibly and stale routes are not overwritten',async()=>{
 const saved=globalThis.fetch;
 try{
  globalThis.fetch=async()=>({ok:false});
  const {renderRetrieval}=await import('../apps/web/retrieval.js');
  const host={innerHTML:''};
  await renderRetrieval(host,()=>true,new URLSearchParams({case:'scifact',view:'experience'}));
  assert.match(host.innerHTML,/检索结果暂不可用/);
  await renderRetrieval(host,()=>false,new URLSearchParams({case:'scifact',view:'experience'}));
  assert.doesNotMatch(host.innerHTML,/检索结果暂不可用/);
  await renderRetrieval(host,()=>true,new URLSearchParams({case:'unknown'}));
  assert.match(host.innerHTML,/检索案例不存在/);
 }finally{globalThis.fetch=saved;}
});
