import { renderCaseInfo } from './case-info.js';
import { CASES, VIEW_NAMES, resolveRoute, caseHref } from './case-navigation.js';
import { renderDressipi } from './dressipi.js';
import { renderM5 } from './m5.js';
import { renderAutoML } from './automl.js';
import { renderAdvanced } from './advanced.js';
import { renderModelGuide } from './model-guide.js';
import { loadManifest, renderShowcase } from './showcase.js';
import { renderCase, cancelCase } from './real-cases.js';
const main = document.querySelector('#main');
const labels = { m5: 'M5 预测案例', automl: 'AutoML 实验室', advanced: '进阶模型实验', recommend: '电商商品推荐', forecast: '销量预测', evidence: '效果报告', models: '模型解读', learn: '教学拆解', delivery: '交付方式' };
function heading(page,title,subtitle) {
  return `<div class="breadcrumb">模型工坊<span>/</span>${labels[page]}</div><div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div></div><div class="prototype-note"><span class="status-dot"></span>独立案例项目 · 推荐与销量预测已接入真实公开数据训练；线上业务收益尚未验证。</div>`;
}
function learn() {
  const lessons = [
    ['先建立比较对象', '为什么要先跑一个热门推荐或上周同期基线？', '在同一开发验证范围比较准确度、偏差与训练成本。第三轮补入个人复购、零预测和中位数，让复杂模型接受更有竞争力的基线检验。', '#recommend'],
    ['比较推荐算法', '复杂算法能胜过个人复购吗？', '选择同一顾客，比较个人高频、近期加权复购、ALS、EASE 与融合。展开依据，再查看历史活跃度与新商品／复购目标诊断。复杂算法带来的额外增益需要单独衡量。', '#recommend'],
    ['比较预测目标', '为什么更复杂的模型仍可能低估销量？', 'Ridge 拟合对数销量，反变换后可能压低尖峰。LightGBM 在原始数量上比较平方误差、Poisson 与 Tweedie。切换商品和窗口，检查 WAPE 改善时总量偏差是否仍然明显。', '#forecast'],
    ['定义预测任务', '逐日销量与一周总销量，是同一个问题吗？', '第三轮分别保留 28 天逐日任务和每周更新的 7 天总量任务。目标、更新频率、MAE 单位都不同，不能把两张表 WAPE 的差值作为模型提升。开发筛选未通过也必须保留。', '#forecast'],
    ['从行为构造特征', '哪些信息在做决策的那一刻已经知道？', '以时间边界构造购买历史、频次或滞后销量，避免把后来的结果提前提供给模型。', '#forecast'],
    ['检查效果是否虚高', '为什么随机切分有时会产生误导？', '训练样本的完整预测标签必须早于验证起点。当前三个窗口用于选参与比较，只是开发验证；不能把反复观察过的窗口重新称为独立测试。源数据核验脚本会重建目标并回放保存的预测。', '#evidence'],
    ['把模型放进经营规则', '为什么推荐更准不一定代表更赚钱？', '改变排除规则、探索比例或补货提前期，观察结果变化；进一步的收益估计需要成本假设。', '#recommend'],
    ['让系统可以交付', '如何连接业务、处理失败并保留证据？', '定义输入输出、冷启动、降级和版本日志。训练与请求服务分离，保留重现过程。', '#delivery'],
  ];
  main.innerHTML = heading('learn', '沿着一个项目，理解每一步。', '业务案例与技术拆解共用同一条流程。以下教学入口对应 UCI 历史开发实验；Ta Feng 独立测试可在案例目录切换查看。') + `<div class="lesson-list">${lessons.map(([title, question, body, link], i) => `<details ${i === 0 ? 'open' : ''}><summary><span class="lesson-number">${i + 1}</span><div><h2>${title}</h2><p>${question}</p></div><span class="lesson-plus">+</span></summary><div class="lesson-body"><p>${body}</p><a class="outline small" href="${link}?case=uci">打开 UCI 真实案例</a></div></details>`).join('')}</div>`;
}

function delivery() {
  main.innerHTML = heading('delivery', '从一个问题，到可以接入的系统。', '先定义目标与数据条件，再确定模型、接口和交付范围。') + `<section class="delivery-intro"><h2>按你的业务阶段，定义交付内容。</h2><button class="primary contact-open">整理我的需求</button></section><div class="delivery-options">${[['数据可行性评估', '先确定数据能回答什么', ['数据质量与字段梳理', '业务任务与评估口径', '基线结果和实施建议']], ['模型与交互原型', '让方案可以运行和比较', ['可运行模型与实验记录', '接口或批量结果样例', '演示页面与评估报告']], ['业务接入与教学', '让系统能够交接和复核', ['数据更新、降级与日志方案', '部署文档与效果复核流程', '项目讲解与实践辅导']]].map(([t, sub, items]) => `<article><h2>${t}</h2><p>${sub}</p><ul>${items.map(x => `<li>${x}</li>`).join('')}</ul></article>`).join('')}</div><section class="technical-panel"><div class="section-heading"><h2>接口形态</h2><span class="badge">本地接口 · 已实现</span></div><div class="tech-columns"><div><h3>推荐请求</h3><pre>POST /api/v1/recommendations
{
  "customer_id": "new",
  "strategy": "als",
  "limit": 10,
  "exclude_purchased": false
}</pre></div><div><h3>交付时保留的内容</h3><p>请求与模型版本、推荐依据、触发的经营规则、降级原因和运行耗时。对照实验独立保存分组与结果。</p><p class="small-note">项目目前完全独立；没有接入主站账号、积分、客户数据或在线联系渠道。</p></div></div></section>`;
  bindContact();
}

function toast(message) { const box = document.querySelector('#toast'); box.textContent = message; box.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 2600); }
function download(filename, content) { const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function bindContact() { document.querySelectorAll('.contact-open').forEach(button => button.onclick = () => document.querySelector('#contact-dialog').showModal()); }
document.querySelector('#close-dialog').onclick = () => document.querySelector('#contact-dialog').close();
document.querySelector('#brief-form').onsubmit = e => { e.preventDefault(); const form = new FormData(e.target); download('模型工坊-定制需求.txt', `模型工坊 · 定制需求摘要\n\n业务目标：${form.get('goal')}\n现有数据：${form.get('data')}\n期望交付：${form.get('delivery')}\n\n该文件仅保存在本地，尚未发送。`); toast('需求摘要已下载，尚未发送'); };
let routeGeneration = 0;
async function casePage(page, params, token, routeError) {
  const caseId=params.get('case'), entry=CASES[page].find(c=>c.id===caseId),view=params.get('view');
  main.innerHTML=`<section class="case-picker"><label>选择${page==='forecast'?'预测':'推荐'}案例<select id="case-picker">${routeError?'<option value="" selected disabled>请选择已有案例</option>':''}${CASES[page].map(c=>`<option value="${c.id}" ${c.id===caseId?'selected':''}>${c.label}</option>`).join('')}</select></label><p>${page==='forecast'?'从门店总量到单件商品，比较真实销量与保存预测。':'从行为与商品属性出发，查看推荐依据与量化评估。'}</p></section>${entry?.views.length>1?`<nav class="case-views" aria-label="案例内容">${entry.views.map(v=>`<a href="${caseHref(page,caseId,v)}" ${view===v?'aria-current="page"':''}>${VIEW_NAMES[v]}</a>`).join('')}</nav>`:''}<div id="case-content"></div>`;
  main.querySelector('#case-picker').onchange=e=>{location.hash=caseHref(page,e.target.value);};
  const content=main.querySelector('#case-content'),current=()=>token===routeGeneration;
  if(routeError){content.innerHTML='<section class="report-panel"><h1>案例不存在</h1><p>这个案例不属于当前任务，请选择已有案例。</p></section>';return;}
  if(view==='data')return renderCaseInfo(content,caseId,page);
  if(caseId==='m5')return renderM5(content,current);
  if(caseId==='dressipi')return renderDressipi(content,current);
  if(view==='advanced')return renderAdvanced(content,current,{task:page,embedded:true});
  if(view==='selection'||view==='tuning')return renderAutoML(content,current,{task:page,embedded:true});
  content.innerHTML='<p class="loading-copy">正在读取案例结果…</p>';
  try {
    const manifest=await loadManifest();if(!current())return;
    const source=manifest.cases.find(c=>c.id===caseId);
    if(!source)throw new Error('案例尚未导出，请先完成本地训练与核验。');
    if(caseId==='tafeng')await renderShowcase(view==='report'?'evidence':page,content,manifest,source,current);
    else await renderCase(view==='report'?'evidence':page,content,source.run_id);
  }catch(error){if(current()){content.innerHTML='<section class="report-panel"><h1>案例暂未就绪</h1><p id="case-error"></p></section>';content.querySelector('#case-error').textContent=error.message;}}
}
function route() {
  const token=++routeGeneration,{page,params,error}=resolveRoute(location.hash);
  const canonical=`#${page}${params.size?'?'+params:''}`;
  if(location.hash!==canonical)history.replaceState(null,'',canonical);
  document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  document.querySelectorAll('[data-section]').forEach(a=>a.classList.toggle('active',a.dataset.section===(['models','learn','delivery'].includes(page)?page:'case')));
  cancelCase();
  if(CASES[page])casePage(page,params,token,error);
  else if(page==='models')renderModelGuide(main,()=>token===routeGeneration);
  else ({learn,delivery})[page]();
  document.title=`${labels[page]} · 模型工坊`;window.scrollTo(0,0);
}
window.addEventListener('hashchange', route);
document.querySelector('.skip').onclick = e => { e.preventDefault(); main.focus(); main.scrollIntoView(); };
bindContact(); route();
