import test from 'node:test';
import assert from 'node:assert/strict';
import {sidebarHtml,sidebarTarget} from '../apps/web/sidebar-navigation.js';
import {PUBLIC_CASE_PATHS} from '../apps/web/case-paths.js';
import {resolveRoute} from '../apps/web/case-navigation.js';

test('sidebar belongs to the selected top-level section',()=>{
 const cases=sidebarHtml('recommend',new URLSearchParams({case:'tafeng'}));
 assert.match(cases,/案例体验 \/ 七类业务/);
 assert.match(cases,/商品推荐/);
 assert.doesNotMatch(cases,/模型解读 \/ 七案例/);
 for(const page of ['models','learn']){
  const html=sidebarHtml(page,new URLSearchParams({topic:'decision:retail'}));
  assert.match(html,new RegExp(page==='models'?'模型解读 \/ 七案例':'教学拆解 \/ 七案例'));
  assert.equal([...html.matchAll(/<a href=/g)].length,7);
  for(const c of PUBLIC_CASE_PATHS){
   const href=`#${page}?${new URLSearchParams({topic:c.key})}`;
   assert.ok(html.includes(href));
   const route=resolveRoute(href,false);
   assert.equal(sidebarTarget(route.page,route.params),`case-path-${c.key.replace(':','-')}`);
  }
  assert.match(html,/aria-current="page"/);
 }
 const delivery=sidebarHtml('delivery',new URLSearchParams({section:'cases'}));
 assert.match(delivery,/交付方式 \/ 本页/);
 assert.equal([...delivery.matchAll(/<a href=/g)].length,3);
 assert.equal(sidebarTarget('delivery',new URLSearchParams({section:'cases'})),'delivery-cases');
 assert.equal(sidebarTarget('delivery',new URLSearchParams({section:'unknown'})),null);
});
