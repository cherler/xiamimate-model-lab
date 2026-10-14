import {BUSINESSES,navigationContext,sectionHref} from './navigation-state.js';

export function sidebarTarget(page,params){
 return page==='delivery'&&['start','stages','cases'].includes(params.get('section'))?`delivery-${params.get('section')}`:null;
}
export function sidebarHtml(page,params,selections=new Map()){
 const context=navigationContext(page,params);
 if(context.mode==='delivery')return '';
 const links=BUSINESSES.map(c=>{
  const selected=context.business===c.id;
  const q=selected?new URLSearchParams(params):new URLSearchParams(selections.get(c.id)||'');
  if(selected)q.set('case',context.caseId);
  const href=sectionHref(context.mode,c.id,q).replaceAll('&','&amp;');
  return `<a href="${href}" data-business="${c.id}" ${selected?'class="active" aria-current="page"':''}><span aria-hidden="true">${c.icon}</span>${c.label}</a>`;
 }).join('');
 return `<p class="side-label">七类业务</p><nav aria-label="业务导航">${links}</nav><div class="source-note"><span class="status-dot"></span><strong>公开数据案例</strong><p>选择业务，再从顶部切换体验、模型解读或教学拆解。</p></div>`;
}
