import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {resolveRoute} from '../apps/web/case-navigation.js';
import {sectionHref,navigationContext} from '../apps/web/navigation-state.js';
import {captureAssistantContext} from '../apps/web/assistant-context.js';
import {publishableWebPath} from '../scripts/publish-policy.mjs';
import {verifyAntiCheat,projectedAlerts} from '../apps/web/anticheat.js';
test('anti-cheat routes preserve case and selection across four sections',()=>{
 for(const mode of ['case','models','learn','expand']){
  const p=new URLSearchParams({case:'vizdoom',model:'temporal_cnn',scope:'gan_group1',sample:'window-40',view:'report'});
  const route=resolveRoute(sectionHref(mode,'anticheat',p));const ctx=navigationContext(route.page,route.params);
  assert.equal(ctx.business,'anticheat');assert.equal(ctx.mode,mode);assert.equal(ctx.caseId,'vizdoom');assert.equal(route.params.get('sample'),'window-40');
 }
 assert.match(captureAssistantContext('#anticheat?case=vizdoom').id,/^research:/);
});
test('anti-cheat local exports do not enter default or competition builds',()=>{
 const root=resolve('apps/web'),path='anticheat-results/1234567890abcdef/case.json';
 assert.equal(publishableWebPath(root,resolve(root,path),new Set([path])),false);
});
test('rare base rates expose review burden without confusing denominators',()=>{
 const r=projectedAlerts(.8,.01,.01);assert.equal(r.tp,80);assert.equal(r.fp,99);assert.equal(r.precision,80/179);
 assert.equal(projectedAlerts(0,0,0).precision,null);assert.throws(()=>projectedAlerts(.5,.1,2));
});
const manifest=resolve('apps/web/anticheat-results/manifest.json');
test('frozen display counts, hashes and additive explanations agree',{skip:!existsSync(manifest)},()=>{
 const m=JSON.parse(readFileSync(manifest)),bytes=readFileSync(resolve('apps/web/anticheat-results',m.path)),p=JSON.parse(bytes);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),m.sha256);assert.equal(verifyAntiCheat(p),p);
 const bad=structuredClone(p);bad.models.lightgbm.known.fp++;assert.throws(()=>verifyAntiCheat(bad));
 const invalid=structuredClone(p);delete invalid.models.lightgbm.known.recall;assert.throws(()=>verifyAntiCheat(invalid));
 const explain=structuredClone(p);explain.samples[0].lightgbm_base+=1;assert.throws(()=>verifyAntiCheat(explain));
});
