import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {distanceEvidence,overlapCounts,ruleTrace,customerPair,overlapView} from '../apps/web/segment-depth.js';
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
