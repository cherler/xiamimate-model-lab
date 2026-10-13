import { loadManifest, loadShowcaseResource, MODEL_NAMES, sampleStatus } from './showcase.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'不定义':v.toLocaleString('zh-CN',{maximumFractionDigits:5});
const pct=v=>v==null?'不定义':`${(100*v).toFixed(2)}%`;
const sum=values=>values.reduce((a,b)=>a+b,0);
export function rankingCalculation(row,k=10) {
 if(!Number.isInteger(k)||k<1||k>10)throw new Error('教学截断长度必须在 1 至 10 之间');
 if(!row||new Set(row.ranked).size!==row.ranked.length||new Set(row.target).size!==row.target.length)throw new Error('推荐样本格式不正确');
 const target=new Set(row.target);
 const positions=row.ranked.slice(0,k).map((item,index)=>({item,rank:index+1,hit:target.has(item)?1:0,discount:1/Math.log2(index+2)}));
 const hits=sum(positions.map(p=>p.hit)),dcg=sum(positions.map(p=>p.hit*p.discount));
 const ideal=Array.from({length:Math.min(k,target.size)},(_,i)=>1/Math.log2(i+2)),idcg=sum(ideal);
 return {positions,ideal,hits,targets:target.size,dcg,idcg,ndcg:idcg?dcg/idcg:0,recall:target.size?hits/target.size:null,precision:hits/k};
}
export function forecastCalculation(rows,model) {
 if(!rows.length)throw new Error('当前范围没有预测记录');
 const details=rows.map(row=>{
  const prediction=row.predictions[model];
  if(!Number.isFinite(prediction)||prediction<0||!Number.isFinite(row.actual)||row.actual<0)throw new Error('销量样本缺少有效预测或实际值');
  const error=prediction-row.actual;
  return {...row,prediction,error,absolute:Math.abs(error)};
 });
 const actual=sum(details.map(r=>r.actual)),absolute=sum(details.map(r=>r.absolute)),error=sum(details.map(r=>r.error));
 return {details,count:rows.length,actual,absolute,error,wape:actual?absolute/actual:null,mae:absolute/rows.length,bias:actual?error/actual:null};
}
const close=(a,b)=>a===null||b===null?a===b:Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-9;
export function verifyLessonResults(recommendations,weekly,report) {
 if(new Set([recommendations.run_id,weekly.run_id,report.run_id]).size!==1)throw new Error('教学结果版本不一致');
 for(const sample of recommendations.samples)for(const [task,models] of Object.entries(sample.tasks))for(const [name,row] of Object.entries(models)) {
  if(sampleStatus(sample,task,name)!=='scored')continue;
  const metrics=rankingCalculation(row);
  for(const key of ['ndcg','recall','precision'])if(!close(metrics[key],row[key]))throw new Error('推荐计算与保存指标不一致');
 }
 for(const [model,result] of Object.entries(report.weekly)) {
  const metrics=forecastCalculation(weekly.series,model);
  for(const key of ['wape','mae','bias'])if(!close(metrics[key],result.metrics[key]))throw new Error('预测计算与保存指标不一致');
 }
}
const select=(id,label,options,value)=>`<label for="${id}">${label}<select id="${id}">${options.map(([v,t])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
const table=(head,rows,label)=>`<div class="table-scroll lesson-table" role="region" tabindex="0" aria-label="${label}"><table><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const cards=rows=>`<div class="showcase-metrics">${rows.map(([label,value,note])=>`<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div>`;

function recommendationLesson(data,report,state) {
 const sample=data.samples.find(s=>s.customer===state.customer),model=state.recModel,row=sample.tasks[state.task]?.[model];
 const controls=`<div class="lesson-controls">${select('lesson-task','推荐任务',[['repurchase','老客复购'],['discovery','新商品发现']],state.task)}${select('lesson-customer','公开样本',data.samples.map(s=>[s.customer,`${s.cohort==='cold'?'新客':'老客'} ${s.customer}`]),state.customer)}${select('lesson-rec-model','推荐方法',Object.keys(report.recommendation[state.task]).map(m=>[m,MODEL_NAMES[m]||m]),model)}${select('lesson-k','教学截断 K',[1,3,5,10].map(k=>[String(k),`前 ${k} 件`]),String(state.k))}</div>`;
 const status=sampleStatus(sample,state.task,model);
 if(status!=='scored')return controls+`<section class="case-story"><h2>${status==='inapplicable'?'无购买历史，复购任务不适用':'观察期未回访，没有可评分购物篮'}</h2><p>${status==='inapplicable'?'这个样本不能计入老客复购成绩，可切换到发现任务查看热门回退。':'没有观测到回访，不能把缺少目标当成零分。该样本保留在展示列表中。'}</p></section>`;
 const c=rankingCalculation(row,state.k),overall=report.recommendation[state.task][model].warm;
 return controls+`<p class="small-note">真实保存列表最多 10 件。K 只截取该列表做教学计算，不改变模型、候选池或正式报告；表内数字为显示舍入，计算使用原精度。</p><section class="case-story"><h2>1. 确定目标与分母</h2><p>本任务实际目标 ${c.targets} 件：${row.target.map(esc).join('、')||'空集合'}。其中 ${row.oov_targets} 件不在训练目录，仍计入目标分母。${state.task==='repurchase'?'目标仅限下一购物日再次购买的历史商品。':'目标仅限下一购物日首次购买的商品。'}</p><p>候选 ${row.candidate_count} 件，保存列表 ${row.ranked.length} 件；当前截取 ${c.positions.length} 件，Precision 分母固定为 K=${state.k}，不会因短列表缩小。</p></section><section class="m5-section"><h2>2. 按排序位置计算贡献</h2>${table(['名次 r','商品编号','命中 h','折扣 1 / log₂(r+1)','贡献 h × 折扣'],c.positions.map(p=>`<tr class="${p.hit?'selected-row':''}"><td>${p.rank}</td><td>${esc(p.item)}</td><td>${p.hit?'1 · 命中':'0'}</td><td>${num(p.discount)}</td><td>${num(p.hit*p.discount)}</td></tr>`),'排序指标逐项计算')}<div class="lesson-formula"><p>DCG = 各位置贡献之和 = ${num(c.dcg)}</p><p>IDCG = 前 min(K, 目标数) 个位置的理想折扣之和 = ${c.ideal.map(num).join(' + ')||'0'} = ${num(c.idcg)}</p></div></section><section class="m5-section"><h2>3. 得到本样本指标</h2>${cards([[`Recall@${state.k}`,pct(c.recall),`${c.hits} 次命中 ÷ ${c.targets} 件目标`],[`Precision@${state.k}`,pct(c.precision),`${c.hits} 次命中 ÷ ${state.k} 个推荐位置`],[`NDCG@${state.k}`,num(c.ndcg),`${num(c.dcg)} ÷ ${num(c.idcg)}${c.idcg?'':'；按协议记 0'}`]])}<p>${c.targets?'命中数相同，命中位置不同，NDCG 也可能不同。':'目标为空时 Recall 不定义；协议中 NDCG 和 Precision 记零，计入全部回访老客均值。'}</p><p class="validation-boundary">以上只代表当前样本。正式报告固定 K=10：该方法的 ${overall.customers} 名回访老客 NDCG@10 为 ${num(overall.ndcg)}，其中 ${overall.nonempty_target_customers} 名目标非空老客的条件 Recall@10 为 ${pct(overall.recall)}。不能将这些展示样本的平均值当作全人群成绩。${sample.cohort==='cold'?'当前样本是新客，使用热门回退，不属于该老客统计。':''}</p><a class="text-link" href="#recommend?case=tafeng&view=report">查看完整推荐报告 →</a></section>`;
}
function forecastLesson(data,report,state) {
 const rows=data.series.filter(r=>(state.item==='all'||r.item===state.item)&&(state.origin==='all'||r.origin===state.origin));
 const c=forecastCalculation(rows,state.forecastModel),overall=report.weekly[state.forecastModel].metrics;
 return `<div class="lesson-controls">${select('lesson-item','计算商品',[['all','全部 50 件商品'],...data.items.map(id=>[id,`商品 ${id}`])],state.item)}${select('lesson-origin','预测起点',[['all','全部四周'],...data.origins.map(d=>[d,d])],state.origin)}${select('lesson-forecast-model','预测方法',Object.keys(report.weekly).map(m=>[m,MODEL_NAMES[m]||m]),state.forecastModel)}</div><section class="case-story"><h2>1. 确定计算范围</h2><p>当前 ${c.count} 个商品周；每行预测起点后的七天总销量，单位为件。${state.item==='all'&&state.origin==='all'?'已选择完整 200 行，与报告范围一致。':'这是所选子集，不能当作全部 200 行的整体成绩。'}零销量行仍参与绝对误差与 MAE 计算。</p></section><section class="m5-section"><h2>2. 逐行计算误差</h2>${table(['商品','起点','实际 y','预测 ŷ','误差 ŷ−y','绝对误差 |ŷ−y|'],c.details.map(r=>`<tr><td>${esc(r.item)}</td><td>${esc(r.origin)}</td><td>${num(r.actual)}</td><td>${num(r.prediction)}</td><td>${num(r.error)}</td><td>${num(r.absolute)}</td></tr>`),'预测指标逐项计算')}<div class="lesson-formula"><p>实际销量之和 = ${num(c.actual)} 件</p><p>绝对误差之和 = ${num(c.absolute)} 件；带符号误差之和 = ${num(c.error)} 件</p></div></section><section class="m5-section"><h2>3. 汇总误差与偏差</h2>${cards([['WAPE',pct(c.wape),`${num(c.absolute)} ÷ ${num(c.actual)}`],['MAE',`${num(c.mae)} 件`,`${num(c.absolute)} ÷ ${c.count} 个商品周`],['总量偏差',pct(c.bias),`${num(c.error)} ÷ ${num(c.actual)}`]])}<p>WAPE 先汇总绝对误差再除以实际总量，不是逐行误差百分比的平均值。偏差保留正负号，高估和低估会相互抵消；WAPE 不抵消。${c.actual===0?'当前实际总量为零，WAPE 和偏差不定义，MAE 仍可计算。':''}</p><p class="validation-boundary">该方法完整 200 行：WAPE ${pct(overall.wape)}，MAE ${num(overall.mae)} 件／商品周，总量偏差 ${pct(overall.bias)}。显示值最多保留五位小数，计算使用保存预测的原精度；预测不是订货量，WAPE 也不是“1 − 准确率”。</p><a class="text-link" href="#forecast?case=tafeng&view=report">查看完整预测报告 →</a></section>`;
}
function methodLessonsHtml() {
 const lessons=[
  ['基线与推荐模型','在同一顾客和候选范围内比较个人复购、ALS、EASE 与融合；先进模型需要证明相对强基线的额外改善。','#recommend?case=uci&view=experience'],
  ['预测目标与损失函数','对数销量回归可能压低尖峰；LightGBM 的平方误差、Poisson 与 Tweedie 拟合目标不同。比较误差时同时检查总量偏差。','#forecast?case=uci&view=advanced'],
  ['时间粒度与特征可用性','逐日预测与七天总量的目标、更新频率和 MAE 单位不同。购买频次、销量滞后和滚动特征只能使用决策前已发生的信息。','#forecast?case=uci&view=data'],
  ['验证边界与超参选择','训练标签必须在验证起点前完整结束。UCI 已经过多轮反馈，模型选择和调参结果属于开发验证，不能重新称为独立测试。','#forecast?case=uci&view=selection'],
  ['属性特征与消融实验','是否使用商品描述取决于模型。固定样本与评估规则后，比较移除某组特征前后的结果，区分新增属性与扩大训练预算的影响。','#recommend?case=uci&view=advanced'],
  ['结果交付与业务收益','保留输入范围、版本、降级规则和评估记录。离线指标不能直接换算成交额；补货决策还需要库存、提前期与成本条件。','#delivery']
 ];
 return `<section class="m5-section"><h2>建模方法与实验阅读</h2><p>以下入口继续使用 UCI 开发实验讲解建模方法，与上方 Ta Feng 指标计算课分开。</p><div class="lesson-list">${lessons.map(([title,body,href],i)=>`<details><summary><span class="lesson-number">${i+1}</span><h3>${title}</h3><span class="lesson-plus">+</span></summary><div class="lesson-body"><p>${body}</p><a class="outline small" href="${href}">${href==='#delivery'?'查看交付范围':'查看 UCI 对应实验'}</a></div></details>`).join('')}</div></section>`;
}
export async function renderMetricLessons(host,current,params=new URLSearchParams()) {
 host.innerHTML='<p class="loading-copy">正在读取并核对教学样本…</p>';
 try {
  const manifest=await loadManifest(),entry=manifest.cases.find(c=>c.id==='tafeng');
  if(!entry)throw new Error('Ta Feng 教学结果尚未导出');
  const [recommendations,weekly,report]=await Promise.all(['recommendations','weekly','report'].map(name=>loadShowcaseResource(manifest,entry,name)));
  if(!current())return;
  verifyLessonResults(recommendations,weekly,report);
  const lesson=params.get('lesson')==='forecast'?'forecast':'recommend';
  const state={task:'repurchase',customer:recommendations.samples[0].customer,recModel:report.decisions.repurchase.selected_model,k:10,item:weekly.items[0],origin:'all',forecastModel:report.decisions.weekly_sales.selected_model};
  host.innerHTML=`<div class="breadcrumb">模型工坊<span>/</span>教学拆解</div><header class="page-heading"><div><h1>真实样本指标计算</h1><p>从保存的推荐列表与销量预测出发，逐项复算指标。样本来自 Ta Feng 已完成的二月测试，数据文件校验与保存指标复算均已通过。</p></div></header><nav class="case-views" aria-label="指标课程"><a href="#learn?lesson=recommend" ${lesson==='recommend'?'aria-current="page"':''}>推荐：命中与排序</a><a href="#learn?lesson=forecast" ${lesson==='forecast'?'aria-current="page"':''}>预测：误差与偏差</a></nav><div id="metric-lesson"></div><section class="m5-section"><h2>案例学习顺序</h2><ol class="case-steps"><li>在“案例与数据”确认决策时刻、可用字段与输出粒度。</li><li>在“案例体验”切换样本和方法，检查输入历史与实际结果。</li><li>在本页复算单样本与子集指标，再回到完整报告确认人群和时间范围。</li><li>结合模型解读、特征实验与调优记录解释差异；交付时保留版本、结果和评估口径。</li></ol><a class="text-link" href="#${lesson}?case=tafeng&view=data">查看 Ta Feng 业务与数据说明 →</a></section>${methodLessonsHtml()}<footer class="showcase-source"><p>数据与实验：${esc(entry.run_id)}；展示版本 ${esc(manifest.version)}。本页只复算已保存结果，不重新选模，不修改独立测试记录。</p><p>24 名老客在读取结果前按 ID 哈希抽取，未回访者保留；另有 3 名观察期新客，仅作回放示例。销量覆盖预先固定的 50 商品 × 4 周。商品编码不补造名称。</p></footer>`;
  const body=host.querySelector('#metric-lesson');
  const draw=()=>{
   const focused=host.ownerDocument?.activeElement?.id;
   body.innerHTML=lesson==='recommend'?recommendationLesson(recommendations,report,state):forecastLesson(weekly,report,state);
   const bindings={'lesson-task':'task','lesson-customer':'customer','lesson-rec-model':'recModel','lesson-k':'k','lesson-item':'item','lesson-origin':'origin','lesson-forecast-model':'forecastModel'};
   for(const [id,key] of Object.entries(bindings)){
    const control=body.querySelector(`#${id}`);if(!control)continue;
    control.onchange=event=>{state[key]=key==='k'?Number(event.target.value):event.target.value;if(key==='task')state.recModel=report.decisions[state.task].selected_model;draw();};
   }
   if(focused&&Object.hasOwn(bindings,focused))body.querySelector(`#${focused}`)?.focus({preventScroll:true});
  };
  draw();
 }catch(error){if(current())host.innerHTML=`<section class="report-panel"><h1>教学结果暂不可用</h1><p>${esc(error.message)}</p><p>请刷新重试或完成结果导出与核验。此处不使用模拟样本替代真实成绩。</p></section>`;}
}
