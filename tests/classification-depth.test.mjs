import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {policyPair,pairForState,mailDuel} from '../apps/web/classification-depth.js';
import {scoreMetrics} from '../apps/web/classification-metrics.js';
const root='apps/web/classification-results/',m=fs.existsSync(root+'manifest.json')?JSON.parse(fs.readFileSync(root+'manifest.json')):null;
const p=m?JSON.parse(fs.readFileSync(root+m.path)):null;
test('paired migration partitions all rows and reconciles both confusion matrices',{skip:!p},()=>{
 for(const split of ['test','validation'])for(const model of ['rules','logistic','lightgbm'])for(const baseline of ['rules','logistic','lightgbm'])for(const mode of ['threshold','capacity'])for(const share of [0,.2,1]){
  const state={split,model,baseline,mode,share,threshold:p.report.thresholds[model],baseThreshold:p.report.thresholds[baseline]};
  const c=pairForState(p,state),n=c.counts;
  assert.equal(Object.values(n).reduce((a,b)=>a+b,0),p.rows[split].length);
  assert.equal(c.current.fp,c.base.fp-n.corrected_fp+n.new_fp);assert.equal(c.current.fn,c.base.fn-n.corrected_fn+n.new_fn);
  assert.equal(c.current.tp+c.current.fp,c.current.selected);
  if(mode==='capacity')assert.equal(c.current.selected,c.base.selected);
  if(model===baseline){assert.equal(n.corrected_fp+n.corrected_fn+n.new_fp+n.new_fn,0);}
  if(mode==='threshold'){assert.deepEqual(c.current,p.report[split][model].policy);assert.deepEqual(c.base,p.report[split][baseline].policy);}
 }
});
test('default comparison preserves new errors and uses exact rather than displayed thresholds',{skip:!p},()=>{
 const state={split:'test',model:'lightgbm',baseline:'rules',mode:'threshold',share:.2,threshold:p.report.thresholds.lightgbm,baseThreshold:p.report.thresholds.rules};
 const c=pairForState(p,state);assert.equal(c.base.fn-c.current.fn,149);assert.equal(c.current.fp-c.base.fp,4);assert.equal(c.counts.new_fp,4);
 assert.equal(c.counts.new_fn,0);assert.match(mailDuel(p.rows.test[0],state,c),/未导出逐样本特征贡献/);
 const before=scoreMetrics(p.rows.test,'lightgbm').ap;const original=JSON.stringify(p.rows.test);
 for(const threshold of [0,.5,1.000001])policyPair(p.rows.test,'lightgbm','rules',{threshold},{threshold:1.000001});
 assert.equal(scoreMetrics(p.rows.test,'lightgbm').ap,before);assert.equal(JSON.stringify(p.rows.test),original);
});

test('all six transition types have explicit witnesses',()=>{
 const rows=[[0,0,1],[1,1,0],[0,1,0],[1,0,1],[1,1,1],[1,0,0]].map(([label,a,b],i)=>({id:String(i),group:String(i),source_row:i,label,scores:{rules:b,lightgbm:a}}));
 const c=policyPair(rows,'lightgbm','rules',{threshold:.5},{threshold:.5});assert.deepEqual(Object.values(c.counts),[1,1,1,1,1,1]);
});
