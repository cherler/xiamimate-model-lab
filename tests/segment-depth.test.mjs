import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {distanceEvidence,overlapCounts,ruleTrace,customerPair,overlapView,alignAssignments,stabilityEvidence,temporalCustomer,migrationCohorts,customerEvolution,migrationExplorer,stabilitySummaryView,actionView} from '../apps/web/segment-depth.js';
import {ruleFor} from '../apps/web/monitoring-metrics.js';
const root='apps/web/monitoring-results/',m=JSON.parse(fs.readFileSync(root+'manifest.json')),p=JSON.parse(fs.readFileSync(root+m.resources.segments.path));
test('all saved customers reproduce nearest centers and signed feature distance differences',()=>{
 for(const snap of p.snapshots)for(const row of snap.rows){const e=distanceEvidence(p.model,row);assert.equal(e.winner.group,row.cluster);assert.ok(e.gap>=0);assert.ok(Math.abs(e.advantages.reduce((s,v)=>s+v,0)-e.gap)<1e-10);for(const c of e.centers)assert.equal(c.parts.reduce((s,v)=>s+v,0),c.squared);}
 const model={scaler_center:[0,0,0],scaler_scale:[1,1,1],centers:[[0,0,0],[2,0,0],[10,10,10],[20,20,20]]};const e=distanceEvidence(model,{rfm:[Math.E-1,0,0]});assert.equal(e.winner.group,0);assert.equal(e.runner.group,1);assert.equal(e.gap,0);
});
test('rule precedence preserves boundaries and amount does not influence fixed rules',()=>{
 for(const r of [0,30,31,90,91,179])for(const f of [1,2,3]){const row={rfm:[r,f,100]},trace=ruleTrace(row);assert.equal(trace.filter(x=>x.chosen).length,1);assert.equal(trace.findIndex(x=>x.chosen),ruleFor(row.rfm));assert.deepEqual(trace,ruleTrace({rfm:[r,f,100000]}));}
 assert.equal(ruleTrace({rfm:[91,1,10]})[1].result,'前项已命中，不再判断');
});
test('full population cross-tab reproduces both profile populations without accuracy claims',()=>{
 for(const snap of p.snapshots){const c=overlapCounts(snap.rows);assert.equal(c.matrix.flat().reduce((s,v)=>s+v,0),snap.rows.length);assert.deepEqual(c.rules,snap.profiles.rule.map(g=>g.n));assert.deepEqual(c.clusters,snap.profiles.cluster.map(g=>g.n));assert.match(overlapView(p,snap),/对角线不是准确率/);}
 assert.equal(overlapCounts([]).total,0);
});
test('pair uses same-time full profiles, preserves geometry limits and escapes identifiers',()=>{
 for(const snap of p.snapshots){const row=snap.rows[0],html=customerPair(p,snap,row);assert.match(html,/群画像来自本期全部/);assert.match(html,/不是置信度/);assert.match(html,/不是因果归因/);assert.ok(html.includes(`origin=${snap.origin}`));assert.match(customerPair(p,snap,{...row,id:'<script>'}),/&lt;script&gt;/);}
});

test('resampling alignment removes arbitrary label permutations before counting retention',()=>{
 const base=[0,0,1,1,2,2,3,3],changed=[2,2,0,0,3,3,1,1],a=alignAssignments(base,changed);assert.deepEqual(a.aligned,base);assert.equal(a.matched,8);
 const tie=alignAssignments([],[]);assert.deepEqual(tie.mapping,[0,1,2,3]);assert.equal(tie.ties,24);assert.throws(()=>alignAssignments([0],[4]));assert.throws(()=>alignAssignments([0],[]));
 const e=stabilityEvidence(p);for(const [i,trial] of e.trials.entries())for(let g=0;g<4;g++){const rows=e.people.filter(r=>r.group===g),retained=rows.filter(r=>trial.aligned[r.index]===g).length;assert.ok(Math.abs(retained/rows.length-p.stability[i].retention[g])<1e-12);}
 assert.equal(e.people.length,p.snapshots[0].rows.length);assert.equal(e.people.reduce((s,r)=>s+r.retained,0),e.trials.reduce((s,t)=>s+t.matched,0));
 for(const row of e.people)assert.equal(row.retained,e.trials.filter(t=>t.aligned[row.index]===row.group).length);
});
test('temporal cohorts partition the union and preserve fixed-center identities',()=>{
 const before=JSON.stringify(p);for(const method of ['rule','cluster']){const rows=migrationCohorts(p,method),t=p.transitions[method],counts=Object.fromEntries(['same','changed','entered','exited'].map(k=>[k,rows.filter(r=>r.kind===k).length]));
 assert.equal(rows.length,new Set(rows.map(r=>r.id)).size);assert.equal(counts.same+counts.changed,t.common);assert.equal(counts.entered,t.entered);assert.equal(counts.exited,t.exited);assert.equal(counts.same,t.matrix.reduce((s,r,i)=>s+r[i],0));
 for(const r of rows){const x=temporalCustomer(p,r.id);if(r.kind==='entered')assert.equal(x.a,null);if(r.kind==='exited')assert.equal(x.b,null);if(x.delta)x.delta.forEach((v,i)=>assert.equal(v,x.b.rfm[i]-x.a.rfm[i]));}}
 assert.equal(JSON.stringify(p),before);assert.equal(temporalCustomer(p,'absent'),null);
 const example=temporalCustomer(p,'12347');assert.deepEqual(example.delta,[30,0,0]);assert.equal(example.a.cluster,example.b.cluster);assert.notEqual(example.a.rule,example.b.rule);
});
test('new entrants lack initial resampling evidence and evolution does not invent purchases',()=>{
 const entrant=migrationCohorts(p,'cluster').find(r=>r.kind==='entered'),exited=migrationCohorts(p,'cluster').find(r=>r.kind==='exited');
 assert.match(customerEvolution(p,entrant.id),/未保存其 10 次重拟合归属/);assert.match(customerEvolution(p,exited.id),/不等同于永久流失/);assert.match(customerEvolution(p,'12347'),/不能仅靠差值拆出新订单/);assert.match(customerEvolution(p,'12347'),/群编号已固定/);
 const changed=structuredClone(p);for(const snap of changed.snapshots)for(const row of snap.rows){row.future_orders=999;row.future_gross=1e9;}
 assert.deepEqual(stabilityEvidence(changed).people,stabilityEvidence(p).people);assert.deepEqual(migrationCohorts(changed,'cluster'),migrationCohorts(p,'cluster'));
});
test('report explorers preserve method populations and action proposals remain untested',()=>{
 for(const method of ['cluster','rule'])for(const migration of ['all','same','changed','entered','exited']){const s={method,migration,person:'absent',origin:p.snapshots[0].origin},html=migrationExplorer(p,s);assert.ok(s.person);assert.ok(html.includes('person='+s.person));assert.match(html,/新增与离开不算入共同顾客/);}
 const empty=structuredClone(p);empty.snapshots[1].rows=structuredClone(empty.snapshots[0].rows);const html=migrationExplorer(empty,{method:'cluster',migration:'changed',person:'12347',origin:p.snapshots[0].origin});assert.match(html,/没有此类顾客/);assert.doesNotMatch(html,/segment-evolution/);
 assert.match(stabilitySummaryView(p),/至少有一次变化/);for(const snap of p.snapshots)for(const method of ['rule','cluster']){const view=actionView(p,snap,method);assert.match(view,/尚未开展触达或干预/);assert.match(view,/不能给出营销提升/);assert.match(view,/简单规则可能已经足够/);}
});
