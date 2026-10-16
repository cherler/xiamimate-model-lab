import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {pairedChoice,partitionARI,conditionFlags,buildChoiceWindow,verifyChoice} from '../apps/web/segment-choice-metrics.js';
const cfg=JSON.parse(fs.readFileSync('services/segment_choice/protocol.json'));
function fixture(){
 const rows=['A','B','C'].map((id,i)=>({id,labels:{rfm:i%2,kmeans:i%2,leiden:i%2,matched:i%2,hdbscan:i===0?0:-1},rfm:[1,i===0?1:3,10],catalog_items:1,total_items:i===0?4:1,kmeans_distances:[.95,1]}));
 const future=Object.fromEntries(cfg.methods.map(m=>[m,{returning:2,rows:rows.slice(0,2).filter(r=>r.labels[m]>=0).map((r,i)=>({id:r.id,group:r.labels[m],targets:i===0?2:1,group_hits:m==='hdbscan'?1:m==='rfm'?0:i===0?0:1,global_hits:0}))}]));
 return {origin:'toy',all_customers:4,excluded_ids:['D'],rows,future};
}
test('paired evidence averages people rather than pooled items; keeps losses and undefined empty group',()=>{
 const r=pairedChoice([{id:'A',targets:2,model_hits:1,baseline_hits:0},{id:'B',targets:1,model_hits:0,baseline_hits:1}]);assert.equal(r.model,.25);assert.equal(r.baseline,.5);assert.equal(r.delta,-.25);assert.deepEqual([r.wins,r.losses,r.ties],[1,1,0]);assert.equal(pairedChoice([]).delta,null);assert.throws(()=>pairedChoice([{id:'A',targets:1,model_hits:2,baseline_hits:0}]));
});
test('fallback keeps unassigned identity and includes full returners without treating nonreturners as zero hits',()=>{
 const w=fixture(),before=JSON.stringify(w),r=buildChoiceWindow(w,cfg);assert.equal(r.eligible,3);assert.equal(r.excluded,1);assert.equal(r.not_returning,1);assert.equal(r.fallback.group_only.model,.5);assert.equal(r.fallback.vs_global.model,.25);assert.equal(r.fallback.vs_kmeans.baseline,.5);assert.equal(r.fallback.global_used,1);assert.equal(r.coverage.hdbscan.historical,1);assert.equal(JSON.stringify(w),before);
 assert.equal(r.cohorts.low_catalog.paired.n,1);assert.equal(r.tiers.reduce((n,t)=>n+t.paired.n,0),2);
});
test('mixed denominators, missing assigned records and wrong popular reference are rejected',()=>{
 for(const change of [w=>w.future.leiden.rows[0].targets++,w=>w.future.hdbscan.rows[0].global_hits++,w=>w.future.kmeans.rows.pop()]){const w=fixture();change(w);assert.throws(()=>buildChoiceWindow(w,cfg));}
});
test('observed condition boundaries and label-invariant stability are explicit',()=>{
 const r=fixture().rows[0];assert.deepEqual(conditionFlags(r,cfg),{single_invoice:true,low_catalog:true,near_kmeans:true});r.catalog_items=2;r.kmeans_distances=[.1,1];assert.equal(conditionFlags(r,cfg).low_catalog,false);assert.equal(conditionFlags(r,cfg).near_kmeans,false);
 assert.equal(partitionARI([0,0,1,1],[3,3,8,8]),1);assert.ok(Math.abs(partitionARI([0,0,1,1],[0,1,0,1])+.5)<1e-12);assert.equal(partitionARI([-1,-1],[-1,-1]),1);assert.equal(partitionARI([0],[1]),null);
});
test('complete frozen source replays with matched populations and honest missing stability',()=>{
 const pm=JSON.parse(fs.readFileSync('apps/web/preference-results/manifest.json')),parent=JSON.parse(fs.readFileSync('apps/web/preference-results/'+pm.path)),m=JSON.parse(fs.readFileSync('apps/web/segment-choice-results/manifest.json')),p=JSON.parse(fs.readFileSync('apps/web/segment-choice-results/'+m.path));verifyChoice(p,parent,pm);
 assert.equal(p.result.newcomers.new_to_snapshot,356);assert.equal(p.result.newcomers.frozen_assignment_validated,false);assert.equal(p.result.stability.matched.available,false);
 for(const w of p.result.windows){assert.equal(w.comparisons.features.n,w.returning);assert.equal(w.comparisons.algorithm.n,w.returning);assert.equal(w.fallback.group_used+w.fallback.global_used,w.returning);assert.equal(w.cohorts.low_catalog.paired.n,0);assert.equal(w.cohorts.low_catalog.paired.model,null);for(const c of Object.values(w.comparisons))assert.equal(c.wins+c.losses+c.ties,c.n);}
 const bad=structuredClone(p);bad.result.windows[0].fallback.vs_global.model+=.01;assert.throws(()=>verifyChoice(bad,parent,pm));
});

test('customer view connects scheme choice, historical conditions and unavailable evidence without defaulting to zero',async()=>{
 const {renderPreference}=await import('../apps/web/preference-segments.js');const {choicePerson}=await import('../apps/web/segment-choice.js');
 const pm=JSON.parse(fs.readFileSync('apps/web/preference-results/manifest.json')),parent=JSON.parse(fs.readFileSync('apps/web/preference-results/'+pm.path)),manifest=JSON.parse(fs.readFileSync('apps/web/segment-choice-results/manifest.json')),choice={manifest,data:JSON.parse(fs.readFileSync('apps/web/segment-choice-results/'+manifest.path))};
 for(const w of parent.windows){
  const report=renderPreference(parent,{origin:w.origin,prefMethod:'hdbscan',prefGroup:'all'},'report',choice);assert.match(report,/同一价值层内/);assert.match(report,/一期一升一降|两期一升一降/);assert.match(report,/本协议未评估/);assert.match(report,/低目录覆盖组两期都没有回访样本/);assert.equal((report.match(/<h2>未归群顾客与回退代价<\/h2>/g)||[]).length,1);
  const returning=new Set(w.future.rfm.rows.map(r=>r.id));assert.match(choicePerson(choice,w,w.rows.find(r=>!returning.has(r.id))),/个人重合差值未评估/);assert.match(choicePerson(choice,w,w.rows.find(r=>returning.has(r.id))),/没有用于分群或选择对照顾客/);
 }
});
