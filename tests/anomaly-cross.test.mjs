import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {replayCross,evaluateCross,verifyCrossIndex,verifyCrossSeries,aggregateCross,pairedCross,isCrossContext} from '../apps/web/anomaly-cross-metrics.js';
import {crossOverview,crossTimeline} from '../apps/web/anomaly-cross.js';
import {caseReading,caseExercise} from '../apps/web/case-reading.js';
const root='apps/web/anomaly-cross-results/',manifest=JSON.parse(fs.readFileSync(root+'manifest.json')),p=JSON.parse(fs.readFileSync(root+manifest.path));
const rows=(v,step=3600000)=>v.map((x,i)=>({t:i*step,scores:x===null?null:{static:x}}));
test('rolling capacity boundary, strict threshold and cooldown use only emitted alerts',()=>{
 assert.deepEqual(replayCross(rows(Array(49).fill(2)),'static',1,1).alerts,[0,24,48]);assert.deepEqual(replayCross(rows([1,2,null,2]),'static',1,2).alerts,[1,3]);assert.deepEqual(replayCross(rows([2,2,2,2],1800000),'static',1).alerts,[0,2]);
 const r=[0,1430,1440].map(t=>({t:t*60000,scores:{static:2}}));assert.deepEqual(replayCross(r,'static',1).alerts,[0,1]);assert.deepEqual(replayCross(r,'static',1,1).alerts,[0,2]);
});
test('no-event and no-score cases retain undefined recall and missed windows',()=>{
 const r=rows([2,null,0,2]),w=[{start:3600000,end:3600000},{start:7200000,end:7200000},{start:10800000,end:10800000}];
 const x=evaluateCross(r,w,'static',1,1,1);assert.deepEqual(x.events.map(e=>e.miss_reason),['unscorable','no_signal','capacity']);assert.equal(x.missed,3);assert.equal(x.outside_alerts,1);assert.equal(evaluateCross(r,[],'static',1,1).recall,null);
});
test('all frozen results reconcile every event, alert and rolling capacity',()=>{
 verifyCrossIndex(p);
 for(const s of p.series){const full=JSON.parse(fs.readFileSync(root+s.asset.path));verifyCrossSeries(full,s,p.protocol);
  for(const B of [1,3,6])for(const m of ['static','rolling','isolation']){const r=full.results[B][m].capped,ev=full.rows.slice(full.meta.cal_end);assert.equal(r.alert_count,r.detected+r.duplicates+r.outside_alerts);assert.equal(r.detected+r.missed,r.event_count);const times=r.alerts.map(i=>ev[i].t);for(const t of times)assert.ok(times.filter(x=>x>t-86400000&&x<=t).length<=B);}
 }
});
test('all-series paired results preserve gains and losses, zero-event burden and old scope',()=>{
 for(const B of [1,3,6])for(const m of ['rolling','isolation']){const r=aggregateCross(p.series,B,m),b=aggregateCross(p.series,B,'static'),pair=pairedCross(p.series,B,m);assert.equal(pair.gained-pair.lost,r.detected-b.detected);assert.equal(Object.values(pair).reduce((a,b)=>a+b),r.event_count);}
 assert.equal(p.series.some(s=>p.protocol.legacy_excluded.includes(s.meta.path)),false);
 assert.ok(p.series.some(s=>!s.windows.length));assert.equal(isCrossContext(new URLSearchParams()),true);assert.equal(isCrossContext(new URLSearchParams('series=machine_temperature_system_failure')),false);assert.equal(isCrossContext(new URLSearchParams('scope=cross&series=old')),true);
});
test('client copy and context distinguish capacity, actual burden and legacy evidence',()=>{
 const s={family:'all',budget:3,model:'isolation'},html=crossOverview(p,s);assert.match(html,/额外发现/);assert.match(html,/实际告警数可以不同/);assert.match(html,/未经人工确认为误报/);assert.match(html,/67 \/ 78/);
 const params=new URLSearchParams('case=nab&scope=cross');assert.match(caseReading('anomaly',params).scope,/78/);assert.match(caseExercise('anomaly',params).metric,/处理额度/);assert.match(caseReading('anomaly',new URLSearchParams('case=nab&scope=legacy')).scope,/三条/);
 const full=JSON.parse(fs.readFileSync(root+p.series[0].asset.path));assert.match(crossTimeline(full,3),/先回放全部评估时段/);
});
test('tampered thresholds and incomplete summary fail verification',()=>{
 const bad=structuredClone(p);bad.series.pop();assert.throws(()=>verifyCrossIndex(bad));const s=p.series[0],full=JSON.parse(fs.readFileSync(root+s.asset.path));full.calibration['3'].static.threshold+=1;assert.throws(()=>verifyCrossSeries(full,s,p.protocol));
});
