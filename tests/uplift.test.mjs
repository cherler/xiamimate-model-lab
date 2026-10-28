import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {verifyUplift,upliftConclusion} from '../apps/web/uplift.js';
import {UPLIFT_METHODS,UPLIFT_SCENARIOS} from '../apps/web/uplift-content.js';
import {navigationContext,sectionHref} from '../apps/web/navigation-state.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
import {captureAssistantContext} from '../apps/web/assistant-context.js';
import {publishableWebPath} from '../scripts/publish-policy.mjs';
const root=resolve('apps/web'),manifest=resolve(root,'uplift-results/manifest.json');
test('new causal workspace retains its identity and selections through all reading modes',()=>{
 let params=new URLSearchParams({case:'hillstrom',target:'spend',model:'x',cap:'.3',sample:'row-8'});
 for(const mode of ['case','models','learn','expand']){
  const route=resolveRoute(sectionHref(mode,'uplift',params));
  assert.equal(route.error,undefined);
  const context=navigationContext(route.page,route.params);
  assert.equal(context.business,'uplift');assert.equal(context.mode,mode);assert.equal(context.caseId,'hillstrom');
  for(const key of ['target','model','cap','sample'])assert.equal(route.params.get(key),params.get(key));
  params=route.params;
 }
});
test('deep causal roadmap stays separate from measured models and unsupported marketing tasks',()=>{
 for(const name of ['tarnet','dragonnet','descn'])assert.match(UPLIFT_METHODS[name].status,/未运行/);
 assert.equal(Object.values(UPLIFT_METHODS).filter(m=>m.status==='已运行').length,5);
 assert.equal(UPLIFT_SCENARIOS.length,6);
 assert.match(UPLIFT_SCENARIOS.find(s=>s.name==='渠道择优').covered,/历史购买渠道/);
 assert.match(captureAssistantContext('#uplift?case=hillstrom').id,/^research:/);
});
test('public builds exclude research samples even if a competition allowlist includes them',()=>{
 const path='uplift-results/1234567890abcdef/case.json';
 assert.equal(publishableWebPath(root,resolve(root,path),new Set([path])),false);
});
test('paired intervals determine the claim, not a positive mean alone',()=>{
 const row=d=>({outcomes:{visit:{vs_response:d}}});
 assert.match(upliftConclusion(row({mean:.1,lo:-.1,hi:.3}),'visit'),/没有充分证据/);
 assert.match(upliftConclusion(row({mean:-.2,lo:-.3,hi:-.1}),'visit'),/弱于/);
 assert.match(upliftConclusion(row({mean:.2,lo:.1,hi:.3}),'visit'),/仍需新活动验证/);
});
test('saved local bundle has complete comparisons and rejects damaged evidence',{skip:!existsSync(manifest)},()=>{
 const m=JSON.parse(readFileSync(manifest)),bytes=readFileSync(resolve(root,'uplift-results',m.path));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),m.sha256);
 const p=verifyUplift(JSON.parse(bytes));
 let changed=structuredClone(p);changed.targets.visit.rows.pop();assert.throws(()=>verifyUplift(changed));
 changed=structuredClone(p);changed.targets.visit.rows[0].arms[0]++;assert.throws(()=>verifyUplift(changed));
 changed=structuredClone(p);changed.targets.visit.rows[0].outcomes.visit.increment.lo=Infinity;assert.throws(()=>verifyUplift(changed));
 changed=structuredClone(p);changed.targets.visit.rows[0]=changed.targets.visit.rows[1];assert.throws(()=>verifyUplift(changed));
});
