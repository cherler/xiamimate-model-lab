import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalChart, RETRIEVAL_NAMES } from '../apps/web/coverage-studies.js';

test('interval chart separates the uncertainty band from point and observed curves',()=>{
 const series={actual:Array(28).fill(3),prediction:Array(28).fill(2),lower:Array(28).fill(1),upper:Array(28).fill(4)};
 const dates=Array.from({length:28},(_,i)=>`2016-01-${String(i+1).padStart(2,'0')}`);
 const html=intervalChart(series,dates,'90');
 assert.match(html,/90% 名义预测区间/);assert.equal((html.match(/<polygon/g)||[]).length,1);
 assert.equal((html.match(/<polyline/g)||[]).length,2);assert.match(html,/01-28/);
 assert.throws(()=>intervalChart({...series,upper:Array(28).fill(0)},dates,'90'),/区间数据无效/);
 assert.throws(()=>intervalChart({...series,actual:[3]},dates,'90'),/区间数据无效/);
});

test('retrieval labels expose the different candidate capacities',()=>{
 assert.deepEqual(Object.keys(RETRIEVAL_NAMES),['original','wide','wide_idf']);
 assert.match(RETRIEVAL_NAMES.wide_idf,/300.*200/);
});
