import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {publishableWebPath} from '../scripts/publish-policy.mjs';
const root=resolve('apps/web/m5-results');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const manifest=existsSync(`${root}/manifest.json`)?read(`${root}/manifest.json`):null;
const resource=k=>read(`${root}/${manifest.resources[k].path}`);
const overview=manifest?resource('overview'):null,catalog=manifest?resource('catalog'):null;
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('M5 export binds all resources to verified source and stays local-only',{skip:!manifest},()=>{
 const pointer=read('artifacts/competition-m5.json');
 assert.equal(manifest.run_id,pointer.run_id);assert.equal(manifest.source_report_sha256,pointer.report_sha256);
 assert.equal(manifest.public_export_allowed,false);assert.equal(overview.public_export_allowed,false);
 for(const spec of Object.values(manifest.resources)){
  assert.match(spec.path,new RegExp(`^${manifest.version}/[a-z0-9-]+\\.json$`));
  assert.equal(createHash('sha256').update(readFileSync(`${root}/${spec.path}`)).digest('hex'),spec.sha256);
 }
 assert.equal(catalog.length,3049);assert.equal(new Set(catalog.map(v=>v.id)).size,3049);
 assert.deepEqual(overview.windows.map(w=>w.origin),[1857,1885,1913]);
 const report=read(`artifacts/competition-runs/${pointer.run_id}/report.json`);
 overview.windows.forEach((w,i)=>assert.deepEqual(w.models,[...report.folds,report.final][i].models));
 assert.ok(!/official_score|leaderboard_score|official_rank/.test(JSON.stringify(overview)));
});
test('all 3049 item predictions reproduce category/store series and item-day metrics',{skip:!manifest},()=>{
 for(const w of overview.windows){
  const bundles=new Map();
  for(const c of catalog)if(!bundles.has(c.shard)){
   const b=resource(`items-${w.origin}-${c.shard}`);assert.equal(b.run_id,manifest.run_id);assert.equal(b.origin,w.origin);bundles.set(c.shard,b.items);
  }
  const sums={},errors={},totals={};
  for(const group of Object.keys(w.groups))sums[group]={history:Array(28).fill(0),actual:Array(28).fill(0),predictions:Object.fromEntries(Object.keys(w.models).map(k=>[k,Array(28).fill(0)]))};
  for(const c of catalog){
   const s=bundles.get(c.shard)[c.id];assert.equal(s.series,1);
   for(const g of ['store',c.category])for(let d=0;d<28;d++){
    sums[g].history[d]+=s.history[d];sums[g].actual[d]+=s.actual[d];
    for(const k of Object.keys(w.models))sums[g].predictions[k][d]+=s.predictions[k][d];
   }
   for(const k of Object.keys(w.models))for(let d=0;d<28;d++){
    assert.ok(Number.isFinite(s.predictions[k][d])&&s.predictions[k][d]>=0);
    errors[k]=(errors[k]||0)+Math.abs(s.actual[d]-s.predictions[k][d]);totals[k]=(totals[k]||0)+s.predictions[k][d];
   }
  }
  for(const [g,s] of Object.entries(sums)){
   for(const key of ['history','actual'])s[key].forEach((v,i)=>near(v,w.groups[g][key][i]));
   for(const k of Object.keys(w.models))s.predictions[k].forEach((v,i)=>near(v,w.groups[g].predictions[k][i],.01));
  }
  const total=sums.store.actual.reduce((a,b)=>a+b,0);
  for(const k of Object.keys(w.models)){near(errors[k]/total,w.models[k].wape);near((totals[k]-total)/total,w.models[k].bias);}
 }
});
test('public build excludes M5 bundle at directory and file level',()=>{
 const web=resolve('apps/web');
 for(const name of ['m5-results','m5-results/manifest.json',`m5-results/1234567890abcdef/overview.json`])assert.equal(publishableWebPath(web,resolve(web,name)),false);
 for(const name of ['','m5.js','m5.css','showcase/manifest.json'])assert.equal(publishableWebPath(web,resolve(web,name)),true);
});
