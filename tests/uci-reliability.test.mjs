import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyUciReliability,reliabilityHtml,pointStabilityHtml,residualQuantile,loadUciReliability} from '../apps/web/uci-reliability.js';
const read=p=>JSON.parse(fs.readFileSync('apps/web/'+p));
const m=read('uci-results/manifest.json'),em=read('uci-reliability-results/manifest.json'),p=read('uci-reliability-results/'+em.path),r=read(`uci-results/${m.version}/report.json`),parent={series:read(`uci-results/${m.version}/weekly-series.json`)};
test('all exported intervals reconstruct from only earlier complete windows and both summary scopes reconcile',()=>{
 assert.equal(verifyUciReliability(p,parent,m),p);assert.equal(p.summary.lightgbm.interval.covered,86);
 for(const w of p.windows){assert.ok(w.calibration_end===null||w.calibration_end<w.origin);assert.equal(w.eligible,w.calibration_n>=48);}
 assert.equal(p.summary.lightgbm.all_point.n,144);assert.equal(p.summary.lightgbm.eligible_point.n,96);
});
test('altered bounds, future pool, metric counts, sources or protocol are rejected',()=>{
 for(const mutate of [x=>x.records[48].intervals.lightgbm.upper+=1,x=>x.records[0].intervals={},x=>x.windows[4].calibration_origins.push('2011-11-01'),x=>x.windows[4].quantiles.lightgbm+=.1,x=>x.summary.lightgbm.interval.covered++,x=>x.records.pop(),x=>x.sources['weekly-series.json']='wrong',x=>x.protocol.target_coverage=.95,x=>x.by_item[Object.keys(x.by_item)[0]].lightgbm.n++]){
  const copy=structuredClone(p);mutate(copy);assert.throws(()=>verifyUciReliability(copy,parent,m),/校验失败/);
 }
});
test('nominal quantile uses finite sample correction and insufficient pools yield no range',()=>{assert.equal(residualQuantile(Array.from({length:48},(_,i)=>i)),44);assert.equal(residualQuantile([1,2]),null);});
test('experience retains warmup and explicitly labels coverage, width, failure and non-guarantees',()=>{
 const first=parent.series[0],later=parent.series.find(x=>x.origin==='2011-10-01');
 assert.match(reliabilityHtml(p,first,'lightgbm','four_week_median',r.weekly),/积累不足/);
 const html=reliabilityHtml(p,later,'lightgbm','four_week_median',r.weekly);
 for(const text of ['86/96','88/96','区间分数','既有选模反馈','不能解释成','跨商品'])assert.ok(html.includes(text),text);
 const miss=p.records.find(x=>x.intervals&&x.actual>x.intervals.lightgbm.upper);
 assert.match(reliabilityHtml(p,miss,'lightgbm','four_week_median',r.weekly),/实际超过上界/);
 assert.match(reliabilityHtml(null,first,'lightgbm','four_week_median',r.weekly,'bad bytes'),/bad bytes/);
 assert.match(pointStabilityHtml(r.forecast,'lightgbm','weekday_median','daily_sales'),/不提供逐日预测区间/);
});
test('static loader fails closed on corrupt assets then retries verified replay',async()=>{
 const original=global.fetch;let corrupt=true,missing=true;
 try{
  global.fetch=async url=>{
   assert.ok(String(url).startsWith('./uci-'));
   if(missing&&String(url)==='./uci-reliability-results/manifest.json')return new Response('',{status:404});
   if(corrupt&&String(url)===`./uci-reliability-results/${em.path}`)return new Response('{}');
   return new Response(fs.readFileSync('apps/web/'+String(url).slice(2)));
  };
  await assert.rejects(loadUciReliability(),/尚未导出/);missing=false;
  await assert.rejects(loadUciReliability(),/校验失败/);corrupt=false;
  assert.equal((await loadUciReliability()).schema,'uci-reliability-v1');
 }finally{global.fetch=original;}
});
