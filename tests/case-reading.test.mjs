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

test('D8 calculations route to real supported views without mixing cases or teaching denominators',async()=>{
 const {CASE_EXERCISES,exerciseHref}=await import('../apps/web/case-exercises.js');
 assert.deepEqual(Object.keys(CASE_EXERCISES).sort(),Object.keys(CASE_READINGS).sort());
 for(const [key,e] of Object.entries(CASE_EXERCISES)){
  const [page,id]=key.split(':'),q=new URLSearchParams({case:id,view:'data',origin:'2011-09-01'}),r=resolveRoute(exerciseHref(page,q));assert.equal(r.error,undefined);
  if(e.href){assert.equal(r.page,'learn');assert.equal(r.params.get('lesson'),page);}else{assert.equal(r.page,page);assert.equal(r.params.get('case'),id);assert.equal(r.params.get('view'),e.view);assert.equal(r.params.get('walk'),'calculation');assert.equal(r.params.get('origin'),'2011-09-01');}
  assert.match(readingHtml(page,q),/计算与实验阅读/);assert.ok(e.failure.length>10);
 }
 assert.equal(exerciseHref('decision',new URLSearchParams({case:'bad'})),null);
});
test('D8 delivery entry leads to seven available public evidence paths, not research-only scores',async()=>{
 const {deliveryCaseLinks}=await import('../apps/web/case-reading.js');const html=deliveryCaseLinks();
 const {PUBLIC_CASE_PATHS,caseMethodHref}=await import('../apps/web/case-paths.js');
 for(const c of PUBLIC_CASE_PATHS){assert.match(html,new RegExp(c.scene));assert.match(html,new RegExp(c.decision));}
 assert.match(html,/要做的判断/);assert.match(html,/展示交付/);
 const links=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&'));assert.equal(links.length,7);
 assert.equal(new Set(links.map(link=>resolveRoute(link).page)).size,7);
 for(const link of links){const {page,params}=resolveRoute(link);assert.ok(CASE_READINGS[`${page}:${params.get('case')}`]);assert.equal(params.get('walk'),'fit');assert.notEqual(params.get('case'),'m5');assert.notEqual(params.get('case'),'dressipi');}
 assert.match(html,/不将公开案例成绩作为收益承诺/);
});

test('customer first-screen summaries cover every case and distinguish fixed conclusions from selectable replay',()=>{
 for(const [key,c] of Object.entries(CASE_READINGS)){
  const [page,id]=key.split(':'),html=readingHtml(page,new URLSearchParams({case:id,view:'experience'}));
  assert.ok(c.verdict?.length>12,key);
  assert.ok(html.indexOf('reading-conclusion')<html.indexOf('reading-steps'),key);
  assert.match(html,/切换下方样本、模型或规则时，以对应的页面结果和完整报告为准/);
  assert.match(html,/看效果与代价/);
  assert.match(html,c.research?/本地研究结论/:/固定评估结论/);
 }
});
test('every public case links back to its method and its real calculation',async()=>{
 const {PUBLIC_CASE_PATHS,caseMethodHref}=await import('../apps/web/case-paths.js');
 for(const path of PUBLIC_CASE_PATHS){
  const [page,id]=path.key.split(':');const html=readingHtml(page,new URLSearchParams({case:id}));
  assert.match(html,/查看建模方法/);assert.match(html,/查看逐项计算/);
  assert.ok(html.includes(caseMethodHref(page,new URLSearchParams({case:id})).replaceAll('&','&amp;')));
 }
 assert.doesNotMatch(readingHtml('forecast',new URLSearchParams({case:'m5'})),/reading-study-links/);
});
