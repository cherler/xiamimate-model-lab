import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CONDITIONS,CONDITION_MODELS,preOriginSignals,conditionAdvice,diagnoseConditions} from '../apps/web/uci-conditions-metrics.js';
import {conditionsHtml} from '../apps/web/uci-conditions.js';
import {conditionsReport} from '../scripts/report-uci-conditions.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const parent=read('apps/web/uci-results/manifest.json'),rows=read(`apps/web/uci-results/${parent.version}/weekly-series.json`),report=read(`apps/web/uci-results/${parent.version}/report.json`);
const rm=read('apps/web/uci-reliability-results/manifest.json'),reliability=read('apps/web/uci-reliability-results/'+rm.path);
const d=diagnoseConditions(rows,reliability);
const fixture=(history,prediction=7)=>({...structuredClone(rows[0]),history,predictions:{...rows[0].predictions,lightgbm:prediction}});

test('diagnostic conventions and complete real summary remain bound to committed audit',async()=>{
 const protocol=read('services/reliability/uci-conditions-protocol.json');assert.deepEqual(CONDITIONS,protocol.constants);
 assert.deepEqual(await conditionsReport(),read('docs/evaluation/uci-conditions-v1.json'));
 for(const m of CONDITION_MODELS){
  const x=d.summary[m];assert.equal(x.all.n,144);assert.equal(x.all.interval_n,96);
  assert.equal(x.all.misses,96-reliability.summary[m].interval.covered);
  for(const group of Object.values(x.groups)){
   for(const k of ['n','large','spikes','interval_n','misses','broad'])assert.equal(group.flagged[k]+group.unflagged[k],x.all[k]);
  }
  assert.equal(x.windows.reduce((s,w)=>s+w.large,0),x.all.large);
 }
 assert.equal(d.summary.lightgbm.groups.combined.flagged.n,60);
 assert.equal(d.summary.lightgbm.groups.combined.flagged.large,11);
 assert.equal(d.summary.lightgbm.groups.combined.unflagged.large,12);
 assert.equal(d.summary.lightgbm.groups.combined.unflagged.misses,7);
});
test('future labels and target mistakes cannot change any pre-origin signals or advice',()=>{
 for(const row of rows)for(const model of CONDITION_MODELS){
  const old=preOriginSignals(row,model),changed={...row,actual:999999999,actual_days:[NaN],end:'2099-12-31'};
  assert.deepEqual(preOriginSignals(changed,model),old);
  const interval=d.records.find(r=>r.origin===row.origin&&r.item===row.item).models[model].interval;
  assert.deepEqual(conditionAdvice(preOriginSignals(changed,model),interval),conditionAdvice(old,interval));
 }
});
test('hand-calculated history checks distinguish zero base, inclusive marks and strict range/error boundaries',()=>{
 const flat=preOriginSignals(fixture(Array(56).fill(1)), 'lightgbm');
 assert.equal(flat.mean,7);assert.equal(flat.cv,0);assert.equal(flat.flags.combined,false);
 const zero=preOriginSignals(fixture(Array(56).fill(0),0),'lightgbm');
 assert.equal(zero.ratio,null);assert.equal(zero.cv,null);assert.equal(zero.scale,1);assert.equal(zero.direction,null);assert.equal(zero.flags.extrapolation,false);
 // Prior weekly mean 10, recent 20, exact +10 and 2x boundary.
 const trend=preOriginSignals(fixture([...Array(42).fill(10/7),...Array(14).fill(20/7)],20),'lightgbm');
 assert.ok(Math.abs(trend.recent-20)<1e-12); // integer daily alternative below avoids binary equality drift.
 const exact=preOriginSignals(fixture([...Array(42).fill(2),...Array(14).fill(4)],28),'lightgbm');assert.equal(exact.direction,'up');
 const low=preOriginSignals(fixture([...Array(42).fill(4),...Array(14).fill(2)],14),'lightgbm');assert.equal(low.direction,'down');
 const start=preOriginSignals(fixture([...Array(42).fill(0),...Array(14).fill(2)],14),'lightgbm');assert.equal(start.direction,'up');
 const sparse=preOriginSignals(fixture([...Array(28).fill(0),...Array(28).fill(1)],7),'lightgbm');assert.equal(sparse.flags.sparse,true);assert.equal(sparse.cv,1);assert.equal(sparse.flags.volatile,true);
 assert.equal(preOriginSignals(fixture(Array(56).fill(1),7.01),'lightgbm').flags.extrapolation,true);
 assert.equal(conditionAdvice(flat,{width_scale:2}).interval.includes('至少'),true);
 assert.equal(conditionAdvice(flat,null).interval.includes('无法提供'),true);
});
test('missing histories, duplicate inventory, changed dates and mismatched reliability fail closed',()=>{
 for(const alter of [r=>r.history.pop(),r=>r.history_dates[55]=r.origin,r=>r.history[2]=NaN,r=>r.history[0]=-1,r=>delete r.predictions.lightgbm]){
  const row=structuredClone(rows[0]);alter(row);assert.throws(()=>preOriginSignals(row,'lightgbm'),/校验失败/);
 }
 assert.throws(()=>diagnoseConditions([...rows.slice(0,-1),rows[0]],reliability),/范围/);
 const changed=structuredClone(reliability);changed.records[0].actual++;
 assert.throws(()=>diagnoseConditions(rows,changed),/父记录/);
 const noIntervals=diagnoseConditions(rows,null);assert.equal(noIntervals.summary.lightgbm.all.interval_n,0);
});
test('large errors and spikes are scored after signals, including errors exactly at scale and zero actual',()=>{
 const altered=structuredClone(rows);
 const first=altered[0],mean=first.history.reduce((s,v)=>s+v,0)/8;
 first.predictions.lightgbm=mean;first.actual=0;
 const result=diagnoseConditions(altered,null).records[0].models.lightgbm;
 assert.equal(result.large,false);assert.equal(result.error,mean);
 first.actual=3*mean;
 const after=diagnoseConditions(altered,null).records[0].models.lightgbm;
 assert.deepEqual(after.signals,result.signals);assert.equal(after.large,true);
});
test('UI separates information time and hindsight, retains misses, same-model and warmup/missing boundaries',()=>{
 const sample=rows.find(r=>r.item==='84077'&&r.origin==='2011-10-22');
 const html=conditionsHtml(rows,reliability,sample,'lightgbm','four_week_median',report.weekly);
 for(const phrase of ['预测时可见','事后核验','没有核查标记，但实际发生较大误差','60 条','49 条','12 条较大误差','7 条越界','业务可接受误差','不是订货建议','未提供','不是独立重复试验'])assert.ok(html.includes(phrase),phrase);
 assert.equal((html.match(/<a href="#forecast\?/g)||[]).length,144);
 assert.match(conditionsHtml(rows,reliability,rows[0],'lightgbm','lightgbm',report.weekly),/无法提供范围参考/);
 const missing=conditionsHtml(rows,null,sample,'lightgbm','zero',report.weekly,'<missing>');
 assert.ok(missing.includes('&lt;missing&gt;'));assert.ok(!missing.includes('残差积累不足，未提供区间'));// unavailable is different from warmup
 const zeroHtml=conditionsHtml(rows,reliability,sample,'zero','zero',report.weekly);
 assert.ok(zeroHtml.includes('没有无标记样本'));assert.ok(!zeroHtml.includes('0/0'));
 assert.match(conditionsHtml(rows.slice(1),reliability,sample,'lightgbm','zero',report.weekly),/暂不可用/);
});
