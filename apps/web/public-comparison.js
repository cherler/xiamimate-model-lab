import {compareForecast} from './case-comparison.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
const pct=n=>n==null?'不适用':`${(n*100).toFixed(2)}%`;
const signed=n=>`${n>0?'+':''}${num(n)}`;
const array=v=>Array.isArray(v)?v:[v];
const table=(heads,rows,label)=>`<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export function forecastPair(rows,model,baseline){
 if(!rows.length)throw new Error('预测对照缺少样本');
 const actual=[],current=[],base=[];
 for(const row of rows){const a=array(row.actual),m=array(row.predictions[model]),b=array(row.predictions[baseline]);if(a.length!==m.length||a.length!==b.length)throw new Error('预测与实际范围不一致');actual.push(...a);current.push(...m);base.push(...b);}
 const c=compareForecast(actual,current,base),total=actual.reduce((a,b)=>a+b,0);
 return {...c,n:actual.length,actual:total,wape:total?c.error/total:null,baseWape:total?c.baseError/total:null,bias:total?(current.reduce((a,b)=>a+b,0)-total)/total:null,baseBias:total?(base.reduce((a,b)=>a+b,0)-total)/total:null};
}
export function publicApplicability(caseId,task){
 const rec=['repurchase','discovery','recommend'].includes(task),tf=caseId==='tafeng';
 const input=rec?'可关联的顾客、商品、购买时间与订单记录。已有历史可用于个性化排序；新客需要回退策略。':'连续商品销量与稳定商品编码；预测起点前的历史必须完整，并确认异常订单、退货与缺失日期的处理。';
 const evidence=rec?(tf?'复购与新商品发现分开验证；冻结复购模型通过增益筛选，新商品发现没有通过。':'ALS、EASE 与个人复购规则共用目录和验证窗口；这能比较整套方法，不能隔离单个特征的贡献。'):(tf?'保留全部 200 个商品周，LightGBM 未通过冻结增益筛选。历史特征与模型同时变化，尚无受控特征消融。':task==='weekly_sales'?'在相同 144 个商品周比较 LightGBM 与简单周销量规则，并保留未通过筛选的结果；没有隔离某个特征的独立增益。':'丰富历史的 L1、L2、log-L2 共用输入，可比较目标函数取舍；与旧模型的差异不能全部归因于新增历史特征。');
 const limit=rec?'仅有交易记录，没有真实曝光和未购买原因；不能把未购买当成不喜欢。复购优势不等于新商品发现能力，冷启动和长尾需要分别验证。':`未记录缺货或完整促销条件，零销售不能一律当作零需求。${caseId==='uci'&&task==='weekly_sales'?'已有后八窗口的残差参考区间，覆盖与宽度需要一起判断，不保证未来覆盖。':'此任务没有经本轮验证的预测区间。'}尖峰与系统性低估仍需检查。`;
 return `<section class="report-panel evidence-bridge"><h2>这个案例能支持的方案判断</h2><div class="depth-duel"><section><h3>所需数据与可交付内容</h3><p>${input}</p><p>本例展示${rec?'候选与排序、规则回退、基线评估和分组诊断':'时间边界处理、滚动预测、基线评估与误差诊断'}；这些可以作为定制交付范围，新业务效果需要独立验证。</p></section><section><h3>已有证据与适用限制</h3><p>${evidence}</p><p>${limit}</p></section></div><details class="depth-calculation"><summary>特征解释的边界</summary><p>${rec?'商品显示名称用于阅读，不等于模型使用了文本或图像特征。当前方法间对照不是固定模型下逐项删除特征的实验。':'日历与销量统计只是模型输入；某天误差变小不能证明某项输入是原因。7 天总量与 28 天逐日预测分别评价，不跨任务计算提升。'}</p></details><a class="text-link" href="#${rec?'recommend':'forecast'}?case=${caseId}&view=report">查看本案例全体成绩与失败诊断 →</a></section>`;
}
export function forecastPairEvidence(rows,selected,model,baseline,names,{scope,unit,caseId,task}){
 const local=forecastPair([selected],model,baseline),overall=forecastPair(rows,model,baseline);
 const stats=c=>table(['方法','绝对误差合计（件）','WAPE ↓','总量偏差'],[[esc(names[baseline]),num(c.baseError),pct(c.baseWape),pct(c.baseBias)],[esc(names[model]),num(c.error),pct(c.wape),pct(c.bias)]],'同范围双方法误差');
 const origins=[...new Set(rows.map(r=>r.origin))];
 return `<section class="report-panel public-forecast-pair"><h2>同一输入的预测差异与全体证据</h2><p>商品 ${esc(selected.item)} · 起点 ${esc(selected.origin)} · ${local.n} 个${unit}。${selected.fallback_models?.includes(model)||selected.fallback_models?.includes(baseline)?'所选配对包含拟合失败后的回退预测，不能当成原模型成功拟合。':''}</p><div class="depth-verdict"><strong>${model===baseline?'同一方法，误差不变':`当前样本绝对误差${local.gain>=0?'减少':'增加'} ${num(Math.abs(local.gain))} 件`}</strong><p>对照 ${esc(names[baseline])} → 当前 ${esc(names[model])}。${local.relative==null?'对照误差为零，相对改善不适用。':`相对${local.relative>=0?'减少':'增加'} ${pct(Math.abs(local.relative))}。`}该样本差异不代表全体增益。</p></div>${stats(local)}<h3>${esc(scope)} · ${overall.n} 个${unit}</h3>${stats(overall)}<p>同范围全体绝对误差变化（对照 − 当前）：<strong>${signed(overall.gain)} 件</strong>；${overall.counts.improved} 个${unit}改善、${overall.counts.tied} 个持平、${overall.counts.worse} 个退步。统计所有保存样本，不随当前商品选择改变。</p><details class="depth-calculation"><summary data-calculation="forecast:uci">逐窗口对照与计算方法</summary>${table(['起点','评价数量','对照 WAPE','当前 WAPE','减少的绝对误差（件）'],origins.map(origin=>{const c=forecastPair(rows.filter(r=>r.origin===origin),model,baseline);return [esc(origin),`${c.n} ${unit}`,pct(c.baseWape),pct(c.wape),signed(c.gain)];}),'同范围逐窗口对照')}<p>逐${unit}计算 |预测 − 实际| 再求和，不先汇总销量来抵消误差；正差值为改善。WAPE 分母为同范围实际销量之和，为零时不定义。窗口统计属于已保存历史评估，不是重新训练或新的独立检验。方法同时改变时不能把误差差值归因于某个输入。</p></details><a class="text-link" href="#forecast?case=${caseId}&view=report">查看同一案例的完整报告 →</a></section>${publicApplicability(caseId,task)}`;
}
export function recommendationOverlap(current,baseline){
 const a=current.items.map(p=>p.id),b=baseline.items.map(p=>p.id);
 if(current.run_id!==baseline.run_id||current.customer_id!==baseline.customer_id||current.as_of!==baseline.as_of)throw new Error('推荐配对范围不一致');
 return {common:a.filter(id=>b.includes(id)).length,added:a.filter(id=>!b.includes(id)).length,removed:b.filter(id=>!a.includes(id)).length};
}
