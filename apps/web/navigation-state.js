// One business identity across experience, methods and teaching.
export const BUSINESSES=[
 {id:'recommend',icon:'◇',label:'商品推荐',caseId:'tafeng'},
 {id:'forecast',icon:'▥',label:'销量预测',caseId:'uci'},
 {id:'classify',icon:'▤',label:'分类与评分',caseId:'spambase'},
 {id:'retrieve',icon:'⌕',label:'智能检索',caseId:'scifact'},
 {id:'anomaly',icon:'⌁',label:'异常检测',caseId:'nab'},
 {id:'segments',icon:'▦',label:'零售分群',caseId:'retail'},
 {id:'decision',icon:'▧',label:'决策优化',caseId:'retail'},
];
export function navigationContext(page,params=new URLSearchParams()){
 const topic=params.get('topic')?.split(':');
 const requested=topic?.[0]||params.get('business')||(['models','learn','delivery'].includes(page)?(['weekly_sales','daily_sales'].includes(params.get('task'))||params.get('lesson')==='forecast'?'forecast':'recommend'):page);
 const business=BUSINESSES.find(c=>c.id===requested)||BUSINESSES[0];
 const mode=['models','learn','delivery'].includes(page)?page:params.get('view')==='models'?'models':params.get('walk')==='calculation'?'learn':'case';
 return {mode,business:business.id,caseId:topic?.[1]||params.get('case')||(params.has('lesson')?'tafeng':business.caseId)};
}
export function sectionHref(mode,business,params=new URLSearchParams()){
 if(mode==='delivery')return '#delivery';
 const entry=BUSINESSES.find(c=>c.id===business)||BUSINESSES[0],q=new URLSearchParams(params);
 if(!q.has('case'))q.set('case',entry.caseId);
 if(mode!=='case'&&q.has('view')&&!['models'].includes(q.get('view')))q.set('experienceView',q.get('view'));
 for(const key of ['topic','focus','lesson','walk','business','view'])q.delete(key);
 if(mode==='case'){
  q.set('view',q.get('experienceView')||'experience');q.delete('experienceView');
  return `#${entry.id}?${q}`;
 }
 q.set('business',entry.id);
 return `#${mode}?${q}`;
}
// Replace only the current history entry; control edits must not rerender the page.
export function saveSelection(business,values){
 const [page,query='']=location.hash.slice(1).split('?'),q=new URLSearchParams(query),context=navigationContext(page,q);
 for(const [key,value] of Object.entries(values))if(value!=null)q.set(key,String(value));
 const mode=context.mode==='delivery'?'case':context.mode;
 // Keep report/data views when writing state from an experience renderer.
 const href=mode==='case'?`#${business}?${q}`:sectionHref(mode,business,q);
 history.replaceState(null,'',href);
 window.dispatchEvent(new Event('selectionchange'));
}
