import test from 'node:test';
import assert from 'node:assert/strict';
import {sidebarHtml,sidebarTarget} from '../apps/web/sidebar-navigation.js';
import {BUSINESSES,navigationContext,sectionHref} from '../apps/web/navigation-state.js';
import {resolveRoute} from '../apps/web/case-navigation.js';

test('all three modes use the same seven icons, names and business order',()=>{
 for(const mode of ['case','models','learn'])for(const c of BUSINESSES){
  const route=resolveRoute(sectionHref(mode,c.id),false),html=sidebarHtml(route.page,route.params);
  assert.equal([...html.matchAll(/data-business=/g)].length,7);
  assert.equal([...html.matchAll(/aria-current="page"/g)].length,1);
  let position=-1;
  for(const entry of BUSINESSES){
   const next=html.indexOf(`data-business="${entry.id}"`);assert.ok(next>position);position=next;
   assert.ok(html.includes(`<span aria-hidden="true">${entry.icon}</span>${entry.label}`));
  }
  for(const match of html.matchAll(/href="([^"]+)"/g)){
   const destination=resolveRoute(match[1].replaceAll('&amp;','&'),false);
   assert.equal(navigationContext(destination.page,destination.params).mode,mode);
  }
 }
});
test('top-level changes preserve the business, task, model and selected sample',()=>{
 const q=new URLSearchParams({case:'tafeng',task:'discovery',model:'itemcf_excluding_history',customer:'00930574',view:'experience'});
 let route={page:'recommend',params:q};
 for(const mode of ['models','learn','case']){
  route=resolveRoute(sectionHref(mode,'recommend',route.params),false);
  const c=navigationContext(route.page,route.params);assert.equal(c.mode,mode);assert.equal(c.business,'recommend');
  for(const key of ['case','task','model','customer'])assert.equal(route.params.get(key),q.get(key));
 }
});
test('legacy topics and forecast model links resolve to the correct business',()=>{
 for(const c of BUSINESSES)assert.equal(navigationContext('models',new URLSearchParams({topic:`${c.id}:${c.caseId}`})).business,c.id);
 assert.equal(navigationContext('models',new URLSearchParams({case:'uci',task:'daily_sales'})).business,'forecast');
 assert.equal(navigationContext('learn',new URLSearchParams({lesson:'forecast'})).business,'forecast');
 assert.equal(navigationContext('classify',new URLSearchParams({view:'models'})).mode,'models');
});
test('delivery has a body table of contents instead of replacing the business sidebar',()=>{
 assert.equal(sidebarHtml('delivery',new URLSearchParams()),'');
 assert.equal(sidebarTarget('delivery',new URLSearchParams({section:'cases'})),'delivery-cases');
 assert.equal(sidebarTarget('models',new URLSearchParams({topic:'classify:spambase'})),null);
});

test('legacy Ta Feng lessons retain their dataset and control edits retain the active mode',async()=>{
 assert.equal(navigationContext('learn',new URLSearchParams({lesson:'forecast'})).caseId,'tafeng');
 const {saveSelection}=await import('../apps/web/navigation-state.js');
 const previous={location:global.location,history:global.history,window:global.window};
 let notified=0;
 global.window={dispatchEvent:()=>{notified++;}};
 global.history={replaceState:(_s,_t,url)=>{global.location.hash=url;}};
 try{
  for(const mode of ['models','learn']){
   global.location={hash:`#${mode}?business=retrieve&case=scifact&query=12&model=bm25`};
   saveSelection('retrieve',{view:'experience',model:'rerank',document:'123'});
   const r=resolveRoute(global.location.hash,false);assert.equal(r.page,mode);
   assert.equal(r.params.get('model'),'rerank');assert.equal(r.params.get('query'),'12');assert.equal(r.params.get('document'),'123');
  }
  assert.equal(notified,2);
 }finally{Object.assign(global,previous);}
});
