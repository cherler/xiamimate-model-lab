import test from 'node:test';
import assert from 'node:assert/strict';
import {seriesMetrics,frozenBaseline,m5Chart} from '../apps/web/m5.js';
test('view metrics use selected-series totals and zero actual is inapplicable',()=>{
 assert.deepEqual(seriesMetrics([0,10],[5,5]),{wape:1,bias:0,mae:5,total:10,predicted:10});
 assert.deepEqual(seriesMetrics([0,0],[1,3]),{wape:null,bias:null,mae:2,total:0,predicted:4});
 for(const [a,p] of [[[],[]],[[1],[1,2]],[[NaN],[1]],[[1],[-1]]])assert.throws(()=>seriesMetrics(a,p));
});
test('baseline is chosen from development scores, regardless of reserved results',()=>{
 const data={selection:{scores:{lgbm_tweedie_core:.3,weekday_mean_8w:.5,weekday_median_8w:1,seasonal_naive:.8}},windows:[{models:{weekday_mean_8w:{wape:1},weekday_median_8w:{wape:.1}}}]};
 assert.equal(frozenBaseline(data),'weekday_mean_8w');
});
test('chart keeps past and future separate and has a textual description',()=>{
 const s={history:Array(28).fill(2),actual:Array(28).fill(0),predictions:{model:Array(28).fill(1),base:Array(28).fill(0)}};
 const w={dates:Array(28).fill('2016-04-25'),history_dates:Array(28).fill('2016-03-28')};
 const svg=m5Chart(s,'model','base',w,27);
 assert.match(svg,/role="img"/);assert.match(svg,/已知历史/);assert.match(svg,/28 天预测与实际对照/);assert.ok(!/NaN|Infinity/.test(svg));
});
