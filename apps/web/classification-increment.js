import {CLASSIFICATION_MODELS as MODELS,applyPolicy,confusionCounts} from './classification-metrics.js';
const change=(a,b,unit='条')=>a===b?'不变':`${a<b?'减少':'增加'} ${Math.abs(a-b)} ${unit}`;
export function classificationIncrement(payload,{split='test',mode='threshold',share=.2}={}){
 const rows=payload.rows[split];
 return Object.fromEntries(Object.keys(MODELS).map(model=>[model,confusionCounts(rows,applyPolicy(rows,model,{mode,share,threshold:payload.report.thresholds[model]}))]));
}
export function incrementHtml(payload,state){
 const values=classificationIncrement(payload,state),models=Object.keys(MODELS),rows=payload.rows[state.split];
 return `<section class="m5-section classification-increment"><h2>复杂模型比简单方法多解决了什么</h2><p>${state.split==='test'?'已完成留出':'开发验证'} · 同一批 ${rows.length} 条邮件。${state.mode==='capacity'?`三种方法各取前 ${Math.floor(rows.length*state.share)} 条，固定相同复核工作量。`:'本节固定使用各模型的验证集冻结阈值；下方自定义阈值不改变这里的结论。阈值不同，复核量也可能不同。'}</p><div class="table-scroll classification-table" role="region" tabindex="0" aria-label="三方法增量价值"><table><thead><tr><th>方法</th><th>找回垃圾 TP</th><th>漏判 FN ↓</th><th>误标正常 FP ↓</th><th>待复核数量</th></tr></thead><tbody>${models.map(m=>{const c=values[m];return `<tr><th>${MODELS[m]}</th><td>${c.tp}</td><td>${c.fn}</td><td>${c.fp}</td><td>${c.selected}</td></tr>`;}).join('')}</tbody></table></div><div class="depth-duel">${[['logistic','rules'],['lightgbm','logistic']].map(([a,b])=>`<section><h3>${MODELS[b]} → ${MODELS[a]}</h3><p>漏判${change(values[a].fn,values[b].fn)}；误标正常邮件${change(values[a].fp,values[b].fp)}；待复核${change(values[a].selected,values[b].selected)}。</p></section>`).join('')}</div><p class="small-note">这里展示方法和处理策略的实际取舍，不把多复核带来的找回全部归为模型能力；固定名额对照更接近相同人工预算。没有实际复核耗时或经营收益数据。</p><button class="outline" id="cls-equal-capacity" type="button">${state.mode==='capacity'?'查看验证集冻结阈值对照':'比较相同复核名额'}</button></section>`;
}
