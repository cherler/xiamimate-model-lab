import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {auditAlerts,seriesAudits,eventComparison,pointComparison,nearestWindow,burdenView,applicabilityView} from '../apps/web/anomaly-depth.js';
const root='apps/web/monitoring-results/',manifest=JSON.parse(fs.readFileSync(root+'manifest.json')),p=JSON.parse(fs.readFileSync(root+manifest.resources.anomaly.path));
test('all frozen series reconcile raw triggers, suppression, emitted and event categories',()=>{
 for(const series of p.series){const rows=series.rows.filter(r=>r.split==='evaluation'&&r.scores);for(const cooldown of [0,60,1440])for(const [model,a] of Object.entries(seriesAudits(series,1,cooldown))){
  const c=a.counts,m=a.metrics;assert.equal(Object.values(c).reduce((s,v)=>s+v,0),rows.length);assert.equal(c.first+c.repeat+c.outside,m.alert_count);assert.equal(c.first,m.detected_events);assert.equal(c.repeat,m.duplicate_event_alerts);assert.equal(c.outside,m.false_alerts);assert.equal(c.suppressed+m.alert_count,m.tp+m.fp);
  if(cooldown===60){for(const [key,v] of Object.entries(m)){const expected=series.metrics[model][key];if(typeof v==='number')assert.ok(Math.abs(v-expected)<1e-10);else assert.deepEqual(v,expected);}}
  for(const e of a.events)assert.equal(e.raw,e.suppressed+e.alerts);
  for(const d of a.decisions.filter(d=>d.state==='suppressed')){assert.ok(d.remaining>0);assert.ok(d.blockedBy<d.t);assert.ok(m.alerts.some(a=>a.t===d.blockedBy));}
 }}
});
test('cooldown carries across event boundaries and suppressed points do not reset it',()=>{
 const rows=Array.from({length:7},(_,i)=>({t:i*60000,scores:{static:[1,1,1,1,0,1,0][i]}})),windows=[{start:60000,end:120000},{start:180000,end:180000},{start:240000,end:240000}];
 const a=auditAlerts(rows,windows,'static',.5,3);assert.deepEqual(a.decisions.map(d=>d.state),['outside','suppressed','suppressed','first','quiet','suppressed','quiet']);
 assert.equal(a.events[0].miss,'cooldown');assert.equal(a.events[1].delay_minutes,0);assert.equal(a.events[2].miss,'no_signal');assert.equal(a.decisions[2].blockedBy,0);assert.equal(a.decisions[5].blockedBy,180000);
 const b=auditAlerts(rows,windows,'static',.5,0);assert.deepEqual([a.metrics.tp,a.metrics.fp,a.metrics.fn,a.metrics.tn,a.metrics.ap],[b.metrics.tp,b.metrics.fp,b.metrics.fn,b.metrics.tn,b.metrics.ap]);
 assert.equal(auditAlerts(rows,windows,'static',1,0).counts.quiet,7);
});
test('timeline retains default failure and interval semantics without claiming a fault cause',()=>{
 const series=p.series[0],audits=seriesAudits(series),html=eventComparison(series,audits,'0');assert.match(html,/先回放整段评估/);assert.match(html,/不能当作实际故障延迟/);assert.match(html,/事件首报/);assert.match(html,/灰竖线/);
 const point=series.rows.find(r=>r.split==='evaluation'),details=pointComparison(point,audits);assert.match(details,/只有新发出的告警重新计时/);assert.match(details,/不足以确认真实系统没有异常/);
});

test('nearest-window context respects inclusive boundaries and cannot infer a cause',()=>{
 const windows=[{start:60000,end:180000},{start:300000,end:360000}];
 assert.deepEqual(nearestWindow(0,windows),{event:0,relation:'before',minutes:1});assert.equal(nearestWindow(60000,windows).relation,'inside');assert.equal(nearestWindow(180000,windows).relation,'inside');assert.deepEqual(nearestWindow(240000,windows),{event:0,relation:'after',minutes:1});assert.equal(nearestWindow(400000,[]),null);
 const s=p.series[0],a=seriesAudits(s),point=s.rows.find(r=>r.split==='evaluation');assert.match(pointComparison(point,a,s.windows),/不能证明提前发现/);
});
test('policy replay preserves scores and separates no-signal misses from cooldown misses',()=>{
 const before=JSON.stringify(p);
 for(const series of p.series)for(const multiplier of [.25,1,4])for(const cooldown of [0,60,1440])for(const [model,a] of Object.entries(seriesAudits(series,multiplier,cooldown))){
  const misses=a.events.filter(e=>e.miss);assert.equal(misses.length,a.metrics.event_count-a.metrics.detected_events);
  for(const e of misses){assert.equal(e.first_alert,null);assert.equal(e.delay_minutes,null);if(e.miss==='cooldown'){assert.ok(e.raw>0);assert.equal(e.raw,e.suppressed);}else assert.equal(e.raw,0);}
  assert.ok(Math.abs(a.metrics.ap-series.metrics[model].ap)<1e-12);if(cooldown===0)assert.equal(a.counts.suppressed,0);
 }
 assert.equal(JSON.stringify(p),before);
});
test('burden and applicability preserve all defaults and make replay limits explicit',()=>{
 for(const series of p.series){const defaultView=burdenView(series,seriesAudits(series),'isolation');assert.match(defaultView,/当前为冻结默认策略/);assert.match(defaultView,/实际告警 = 事件首报/);assert.match(defaultView,/查看三条序列的固定策略/);assert.match(applicabilityView(series),/view=experience/);
 const replay=burdenView(series,seriesAudits(series,4,0),'isolation');assert.match(replay,/已知历史上的策略回放/);assert.match(replay,/不重训或更新正式报告/);}
 assert.match(applicabilityView(p.series[1]),/保留简单方法的优势/);
});
