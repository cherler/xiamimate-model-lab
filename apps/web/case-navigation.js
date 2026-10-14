import {LOCAL_RESEARCH} from './preview-mode.js';
export const CASES = {
 recommend: [
  {id:'tafeng',label:'Ta Feng · 复购推荐',views:['experience','data','report']},
  {id:'dressipi',label:'Dressipi · 时尚会话推荐',views:['experience','data','models','report','training']},
  {id:'uci',label:'UCI · 推荐与特征实验',views:['experience','data','advanced','selection','tuning','report']},
 ],
 forecast: [
  {id:'m5',label:'M5 · 28 天零售预测',views:['experience','data','models','report','training']},
  {id:'tafeng',label:'Ta Feng · 周销量预测',views:['experience','data','report']},
  {id:'uci',label:'UCI · 销量与深度预测',views:['experience','data','advanced','selection','tuning','report']},
 ],
};
export const VIEW_NAMES={data:'案例与数据',models:'特征与模型',training:'训练记录',experience:'案例体验',advanced:'进阶模型',selection:'模型选择',tuning:'调优记录',report:'效果报告'};
export function visibleCases(page,localResearch=LOCAL_RESEARCH){
 return (CASES[page]||[]).filter(c=>localResearch||!['m5','dressipi'].includes(c.id));
}
export function resolveRoute(hash,localResearch=LOCAL_RESEARCH){
 const [raw,query='']=hash.replace(/^#/,'').split('?'),params=new URLSearchParams(query);
 let page=raw;
 if(page==='m5'){page='forecast';params.set('case','m5');}
 if(page==='advanced'||page==='automl'){
  const previous=page;page=params.get('task')==='forecast'?'forecast':'recommend';params.set('case','uci');
  params.set('view',previous==='advanced'?'advanced':params.get('view')==='tuning'?'tuning':'selection');
 }
 if(page==='evidence'){page='recommend';params.set('view','report');}
 if(!['recommend','forecast','classify','retrieve','anomaly','segments','decision','models','learn','delivery'].includes(page))page='recommend';
 if(['anomaly','segments','decision'].includes(page)){
  if(!params.has('case'))params.set('case',page==='anomaly'?'nab':'retail');
  if(!['experience','data','models','report'].includes(params.get('view')))params.set('view','experience');
 }
 if(page==='retrieve'){
  if(!params.has('case'))params.set('case','scifact');
  if(!['experience','data','models','report'].includes(params.get('view')))params.set('view','experience');
 }
 if(page==='classify'){
  if(!params.has('case'))params.set('case','spambase');
  if(!['experience','data','models','report'].includes(params.get('view')))params.set('view','experience');
 }
 if(CASES[page]){
  if(!params.has('case'))params.set('case',page==='forecast'?(localResearch?'m5':'uci'):'tafeng');
  const entry=CASES[page].find(c=>c.id===params.get('case'));
  if(!entry)return {page,params,error:'这个案例不属于当前任务，请选择下方已有案例。'};
  if(!params.has('view'))params.set('view','experience');
  if(!entry.views.includes(params.get('view')))params.set('view','experience');
 }
 return {page,params};
}
export function caseHref(page,id,view='experience'){
 return `#${page}?${new URLSearchParams({case:id,view})}`;
}
