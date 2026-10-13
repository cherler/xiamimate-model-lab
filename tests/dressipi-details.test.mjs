import test from 'node:test';
import assert from 'node:assert/strict';
import {failureCounts,DRESSIPI_FEATURES,STUDY_NAMES} from '../apps/web/dressipi-details.js';
import {CASES,resolveRoute} from '../apps/web/case-navigation.js';
import {readFileSync} from 'node:fs';
test('Dressipi sections resolve inside recommendation and every configured feature has a definition',()=>{
 const c=CASES.recommend.find(c=>c.id==='dressipi');
 for(const view of ['models','report','training']){
  assert.ok(c.views.includes(view));assert.equal(resolveRoute(`#recommend?case=dressipi&view=${view}`).params.get('view'),view);
 }
 const cfg=JSON.parse(readFileSync('services/competitions/dressipi-study.json'));
 for(const [name,features] of Object.entries(cfg.variants)){
  assert.ok(STUDY_NAMES[name]);for(const f of features)assert.ok(DRESSIPI_FEATURES[f],f);
 }
});
test('failure display keeps exhaustive counts and does not turn missing sessions into accuracy',()=>{
 const summary={sessions:1000,states:{not_retrieved:586,rank_after_100:49,rank_11_100:200,rank_1_10:165}};
 assert.equal(failureCounts(summary).reduce((s,x)=>s+x.count,0),1000);
 assert.equal(failureCounts(summary)[0].share,.586);
 assert.throws(()=>failureCounts({...summary,sessions:999}));
});
