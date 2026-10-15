import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classificationIncrement,incrementHtml} from '../apps/web/classification-increment.js';
const root=new URL('../apps/web/classification-results/',import.meta.url),m=JSON.parse(fs.readFileSync(new URL('manifest.json',root))),p=JSON.parse(fs.readFileSync(new URL(m.path,root)));
test('frozen strong baseline comparison retains workload as well as error changes',()=>{
 const x=classificationIncrement(p);assert.equal(x.logistic.fn-x.lightgbm.fn,29);assert.equal(x.logistic.fp-x.lightgbm.fp,2);assert.equal(x.lightgbm.selected-x.logistic.selected,27);
 const html=incrementHtml(p,{split:'test',mode:'threshold',share:.2});assert.match(html,/减少 29 条/);assert.match(html,/增加 27 条/);assert.match(html,/自定义阈值不改变/);
});
test('same-capacity contrast covers both partitions and zero/full budgets exactly',()=>{
 for(const split of ['validation','test'])for(const share of [0,.2,1]){const x=classificationIncrement(p,{split,mode:'capacity',share});for(const c of Object.values(x)){assert.equal(c.selected,Math.floor(p.rows[split].length*share));assert.equal(c.tp+c.fp+c.tn+c.fn,p.rows[split].length);}}
});
