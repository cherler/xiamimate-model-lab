import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {documentTrace,pipelineCounts,termEvidence,traceView} from '../apps/web/retrieval-depth.js';
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
