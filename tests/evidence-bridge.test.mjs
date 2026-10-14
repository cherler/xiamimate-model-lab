import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ablationEvidence,dressipiEvidence,intervalContext,m5Evidence} from '../apps/web/evidence-bridge.js';
const root=new URL('../apps/web/',import.meta.url);
const load=(kind,key)=>{const base=new URL(`${kind}-results/`,root);if(!fs.existsSync(new URL('manifest.json',base)))return null;const m=JSON.parse(fs.readFileSync(new URL('manifest.json',base)));return JSON.parse(fs.readFileSync(new URL(m.resources[key].path,base)));};
const study=load('dressipi','study'),coverage=load('m5','coverage');
test('fixed-candidate ablation preserves tradeoff and rejects mixed populations',{skip:!study},()=>{
 const e=ablationEvidence(study);assert.equal(e.n,1000);assert.ok(Math.abs(e.attributeGain-.064)<1e-12);assert.ok(Math.abs(e.crossGain+.005)<1e-12);assert.ok(e.crossMrr>0);
 const bad=structuredClone(study);bad.models.full.sessions--;assert.throws(()=>ablationEvidence(bad));
 const html=dressipiEvidence(study);assert.match(html,/586 \/ 1000/);assert.match(html,/不能证明属性在每个组都有效/);assert.match(html,/-0.50 个百分点/);
});
test('M5 interval evidence never falls back to another window/model/item',{skip:!coverage},()=>{
 const select={origin:1885,model:'lgbm_tweedie_core',level:'category',category:'FOODS'};
 const c=intervalContext(coverage,select);assert.equal(c.aggregate.metrics.n,28);assert.equal(c.reason,null);
 for(const patch of [{origin:1913},{origin:1801},{model:'weekday_median_8w'},{level:'item'}]){const x=intervalContext(coverage,{...select,...patch});assert.equal(x.aggregate,null);assert.ok(x.reason);}
 const html=m5Evidence(coverage,select);assert.match(html,/interval_window=1885/);assert.match(html,/interval_group=FOODS/);
 const unavailable=m5Evidence(coverage,{...select,origin:1913});assert.doesNotMatch(unavailable,/interval_window=/);assert.match(unavailable,/不代表当前曲线/);
});
