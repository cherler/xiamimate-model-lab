import {CASE_READINGS} from './case-reading.js';
import {resolveRoute} from './case-navigation.js';
import {navigationContext} from './navigation-state.js';
// Conversations follow the case, not each sample or model selection.
export function captureAssistantContext(hash){
 const route=resolveRoute(hash),ctx=navigationContext(route.page,route.params),key=`${ctx.business}:${ctx.caseId}`,c=CASE_READINGS[key];
 if(ctx.mode==='delivery')return {id:'general',title:'公开案例咨询'};
 if(ctx.business==='anticheat')return {id:'research:'+key,title:'反外挂研究 · 仅作一般方法咨询'};
 if(ctx.business==='uplift')return {id:'research:'+key,title:'营销增量研究 · 仅作一般方法咨询'};
 if(c?.research)return {id:'research:'+key,title:c.name+' · 仅作一般方法咨询'};
 if(!c&&key!=='agent:retail')return {id:'general',title:'公开案例咨询'};
 return {id:key,title:c?.name||'零售分析 Agent',key};
}
