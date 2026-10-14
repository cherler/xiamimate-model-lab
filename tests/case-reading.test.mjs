import test from 'node:test';
import assert from 'node:assert/strict';
import {CASE_READINGS,READING_STEPS,readingHref,readingHtml,canShowReading} from '../apps/web/case-reading.js';
import {resolveRoute} from '../apps/web/case-navigation.js';
test('D8 reading paths cover seven business tasks and stay within each available case/view',()=>{
 assert.deepEqual([...new Set(Object.keys(CASE_READINGS).map(k=>k.split(':')[0]))].sort(),['anomaly','classify','decision','forecast','recommend','retrieve','segments']);
 for(const key of Object.keys(CASE_READINGS)){
  const [page,id]=key.split(':'),q=new URLSearchParams({case:id,view:'experience',model:'lightgbm',budget:'0.6',item:'22197'});
  for(const step of Object.keys(READING_STEPS)){
   const r=resolveRoute(readingHref(page,q,step));assert.equal(r.page,page);assert.equal(r.params.get('case'),id);assert.equal(r.params.get('view'),READING_STEPS[step].view);assert.equal(r.error,undefined);
   assert.equal(r.params.get('model'),'lightgbm');assert.equal(r.params.get('budget'),'0.6');assert.equal(r.params.has('item'),false);
  }
  assert.equal(q.get('item'),'22197');
 }
});
test('D8 cannot present the reading contract as loaded results during missing, stale or research-unavailable states',()=>{
 const host=text=>({querySelectorAll:()=>[{textContent:text}]});
 for(const text of ['案例不存在','UCI 案例暂不可用','正在读取并核验保存结果…','M5 案例暂未就绪','当前构建未包含本地研究结果。'])assert.equal(canShowReading(host(text)),false);
 assert.ok(canShowReading(host('科学文献检索与相关性排序')));
 assert.equal(readingHtml('forecast',new URLSearchParams({case:'nonexistent'})),'');
});
test('D8 research scope and public fallback contracts cannot be silently interchanged',()=>{
 for(const key of ['forecast:m5','recommend:dressipi']){const [page,id]=key.split(':'),html=readingHtml(page,new URLSearchParams({case:id}));assert.match(html,/仅限本地研究预览/);assert.match(html,/公开构建不包含本案例结果/);}
 assert.match(readingHtml('decision',new URLSearchParams({case:'retail'})),/事后模拟成本却退步/);
 assert.match(readingHtml('segments',new URLSearchParams({case:'retail'})),/轮廓分数不是准确率/);
 assert.match(readingHtml('retrieve',new URLSearchParams({case:'scifact'})),/没有本地微调/);
});
test('D8 escapes route content and opens applicability only for the requested reading step',()=>{
 const q=new URLSearchParams({case:'retail',walk:'fit',model:'"><script>alert(1)</script>'});
 const html=readingHtml('decision',q);assert.doesNotMatch(html,/<script>/);assert.match(html,/class="reading-fit" open/);assert.match(html,/aria-current="step"/);
 q.set('walk','unknown');assert.doesNotMatch(readingHtml('decision',q),/class="reading-fit" open/);
});
