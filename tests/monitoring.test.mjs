import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {alertMetrics,segmentProfiles,ruleFor,adjustedRand,segmentTransitions,verifyMonitoring} from '../apps/web/monitoring-metrics.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
test('alert cooldown never point-adjusts labels or raw confusion counts',()=>{
 const rows=Array.from({length:10},(_,i)=>({t:i*60000,scores:{static:[1,2,4,7].includes(i)?1:0}})),windows=[{start:120000,end:240000},{start:480000,end:540000}];
 const a=alertMetrics(rows,windows,'static',.5,0),b=alertMetrics(rows,windows,'static',.5,3);
 assert.deepEqual([a.tp,a.fp,a.fn,a.tn],[2,2,3,3]);assert.equal(b.tp,a.tp);assert.equal(b.alert_count,3);assert.equal(b.events[0].delay_minutes,2);assert.equal(b.events[1].delay_minutes,null);assert.equal(a.duplicate_event_alerts,1);
 const empty=alertMetrics(rows,[],'static',1,60);assert.equal(empty.event_recall,null);assert.equal(empty.precision,null);assert.equal(empty.ap,null);assert.throws(()=>alertMetrics(rows,windows,'static',NaN));
});
test('RFM rules, profiles and transitions preserve population denominators',()=>{
 assert.deepEqual([[91,1],[90,1],[30,3],[31,3]].map(ruleFor),[0,1,2,3]);
 const rows=[{id:'a',rfm:[1,2,100],cluster:0,future_orders:1,future_gross:20},{id:'b',rfm:[3,1,300],cluster:0,future_orders:0,future_gross:0}];
 assert.equal(segmentProfiles(rows,'cluster')[0].future_return_rate,.5);assert.equal(segmentProfiles(rows,'cluster')[1].median_rfm,null);
 const t=segmentTransitions(rows,[{id:'a',cluster:1},{id:'c',cluster:0}],'cluster');assert.equal(t.common,1);assert.equal(t.entered,1);assert.equal(t.exited,1);assert.equal(t.same_share,0);
});
test('ARI ignores arbitrary cluster IDs and handles degenerate partitions',()=>{
 assert.equal(adjustedRand([0,0,1,1],[3,3,2,2]),1);assert.equal(adjustedRand([0,0,0],[1,1,1]),1);assert.equal(adjustedRand([0,0,1,1],[0,1,0,1]),-.49999999999999994);
});
test('R5 routes canonicalize without substituting unknown cases',()=>{
 for(const [kind,id] of [['anomaly','nab'],['segments','retail']]){const r=resolveRoute('#'+kind);assert.equal(r.page,kind);assert.equal(r.params.get('case'),id);assert.equal(resolveRoute('#'+kind+'?case=bad&view=bad').params.get('case'),'bad');}
});
test('saved R5 scores, groups, projections, profiles, stability and silhouette recompute',async()=>{
 const root=new URL('../apps/web/monitoring-results/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root)));
 for(const kind of ['anomaly','segments']){const spec=manifest.resources[kind],bytes=await readFile(new URL(spec.path,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);const p=JSON.parse(bytes);verifyMonitoring(p,{deep:true});
  const broken=structuredClone(p);if(kind==='anomaly')broken.series[0].metrics.static.false_alerts++;else broken.snapshots[0].rows[0].cluster=(broken.snapshots[0].rows[0].cluster+1)%4;assert.throws(()=>verifyMonitoring(broken));
 }
});
test('missing R5 results fail visibly and an obsolete route cannot overwrite its successor',async()=>{
 const old=globalThis.fetch;try{globalThis.fetch=async()=>({ok:false});const {renderMonitoring}=await import('../apps/web/monitoring.js');const host={innerHTML:''};
 await renderMonitoring(host,()=>true,new URLSearchParams({case:'nab'}),'anomaly');assert.match(host.innerHTML,/暂不可用/);
 await renderMonitoring(host,()=>false,new URLSearchParams({case:'retail'}),'segments');assert.doesNotMatch(host.innerHTML,/暂不可用/);
 }finally{globalThis.fetch=old;}
});
