import {PUBLIC_CASE_PATHS} from './case-paths.js';

const caseEntries=[
 ['recommend','◇','商品推荐'],['forecast','▥','销量预测'],['classify','▤','分类与评分'],
 ['retrieve','⌕','智能检索'],['anomaly','⌁','异常检测'],['segments','▦','零售分群'],['decision','▧','决策优化'],
];
const deliveryEntries=[['start','01','怎样开始'],['stages','02','交付阶段'],['cases','03','业务场景与案例']];

export function sidebarTarget(page,params){
 if(['models','learn'].includes(page)){
  const key=params.get('topic');
  return PUBLIC_CASE_PATHS.some(c=>c.key===key)?`case-path-${key.replace(':','-')}`:null;
 }
 if(page==='delivery')return deliveryEntries.some(([key])=>key===params.get('section'))?`delivery-${params.get('section')}`:null;
 return null;
}
export function sidebarHtml(page,params){
 if(page==='models'||page==='learn'){
  const section=page==='models'?'模型解读':'教学拆解';
  const links=PUBLIC_CASE_PATHS.map((c,i)=>{
   const href=`#${page}?${new URLSearchParams({topic:c.key})}`;
   const selected=params.get('topic')===c.key;
   return `<a href="${href}" ${selected?'class="active" aria-current="page"':''}><span>${String(i+1).padStart(2,'0')}</span>${c.title}</a>`;
  }).join('');
  return `<p class="side-label">${section} / 七案例</p><nav aria-label="${section}目录">${links}</nav><div class="source-note"><span class="status-dot"></span><strong>公开数据案例</strong><p>${page==='models'?'选择业务后查看实际方法与对照证据。':'选择业务后查看保存记录的逐项计算。'}</p></div>`;
 }
 if(page==='delivery'){
  const links=deliveryEntries.map(([key,number,label])=>{
   const selected=params.get('section')===key;
   return `<a href="#delivery?section=${key}" ${selected?'class="active" aria-current="page"':''}><span>${number}</span>${label}</a>`;
  }).join('');
  return `<p class="side-label">交付方式 / 本页</p><nav aria-label="交付方式目录">${links}</nav><div class="source-note"><span class="status-dot"></span><strong>联系入口</strong><p>需求清单由访客下载；邮件需自行发送。</p></div>`;
 }
 const links=caseEntries.map(([id,icon,label])=>`<a href="#${id}" ${page===id?'class="active" aria-current="page"':''}><span>${icon}</span>${label}</a>`).join('');
 return `<p class="side-label">案例体验 / 七类业务</p><nav aria-label="案例导航">${links}</nav><div class="source-note"><span class="status-dot"></span><strong>公开数据案例</strong><p>零售 · 邮件分类 · 文献检索<br/>保存结果与量化评估</p></div>`;
}
