const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:3});
const signed=v=>`${v>0?'+':''}${num(v)}`;
const labels={log_frequency:'该顾客的购买次数（对数）',age_scaled:'距最近购买的时间（归一化）',decay:'近期复购强度',itemcf:'历史共购关联',log_popularity:'商品购买人数（对数）',log_user_orders:'顾客订单数（对数）',log_user_items:'顾客买过的商品数（对数）',log_item_price:'商品历史单价（对数）',price_iqr:'历史价格波动（对数）',name_words:'名称词数 ÷ 10',price_distance:'与顾客惯常价格的距离',text_affinity:'与顾客历史商品的名称相似度',keyword_affinity:'与顾客历史商品的关键词匹配',user_price_available:'顾客历史价格是否可用',log_lag1:'最近一天销量（对数）',log_lag7:'起点前第 7 天销量（对数）',log_lag14:'起点前第 14 天销量（对数）',log_lag28:'起点前第 28 天销量（对数）',log_mean7:'近 7 天均量（对数）',log_mean28:'近 28 天均量（对数）',log_mean56:'近 56 天均量（对数）',log_std28:'近 28 天销量波动（对数）',log_max28:'近 28 天最大销量（对数）',log_weekday_median:'过去同星期中位销量（对数）',log_weekday_mean:'过去同星期平均销量（对数）',horizon_scaled:'预测天数 ÷ 7',zero_rate28:'近 28 天无交易记录日比例',weekday_sin:'星期周期（正弦）',weekday_cos:'星期周期（余弦）',month_sin:'月份周期（正弦）',month_cos:'月份周期（余弦）',log_price:'训练期历史价格（对数）'};
export function featureLabel(key){return labels[key]||(key.startsWith('name_has_')?`名称包含 ${key.slice(9)}`:key.startsWith('item_')?`商品身份 ${key.slice(5)}`:key);}
function table(headers,rows){return `<div class="table-scroll" role="region" tabindex="0" aria-label="当前结果的计算依据"><table><thead><tr>${headers.map(x=>`<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
export function contributionTable(features,row,units){
 const entries=features.map((key,i)=>({key,value:row.values[i],contribution:row.contributions[i]})).sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution));
 const top=entries.slice(0,6),rest=entries.slice(6).reduce((s,x)=>s+x.contribution,0);
 return `<p>模型起始值 ${num(row.base)} ${units}，各项贡献合计 ${signed(row.contributions.reduce((a,b)=>a+b,0))}，得到 ${num(row.score)} ${units}。</p>${table(['影响当前结果的输入','保存的输入值',`推高／压低（${units}）`],top.map(x=>[esc(featureLabel(x.key)),num(x.value),signed(x.contribution)]).concat([['其余特征合计','—',signed(rest)]]))}<details><summary>查看全部特征与计算核验</summary>${table(['特征','输入值','贡献'],entries.map(x=>[esc(featureLabel(x.key)),num(x.value),signed(x.contribution)]))}<p class="small-note">重建误差 ${esc(row.reconstruction_error.toExponential(2))}。采用保存的模型权重计算 TreeSHAP；正负值解释相对模型起始值的变化，不表示因果关系。相关特征可能分摊贡献。对数输入均采用 log(1+x)。</p></details>`;
}
export function validateExplanations(loaded,manifest){
 for(const kind of ['trees','graph','tft']){
  const payload=loaded[`explanation-${kind}`];if(!payload)continue;
  if(payload.schema!==1||payload.kind!==kind||Object.entries(manifest.runs).some(([key,id])=>payload.runs?.[key]!==id||payload.reports?.[key]!==manifest.resources[key].sha256))throw new Error('逐样本解释与预测版本不一致');
 }
}
function missing(){return '<p class="small-note">当前样本没有匹配版本的解释产物，不以整体特征重要性替代。</p>';}
export function mountRecommendationExplanation(host,loaded,sample,model){
 if(!host)return;
 if(!['behavior','attributes','cross'].includes(model)){host.innerHTML='';return;}
 const record=loaded['explanation-trees']?.data.recommendation.find(s=>s.origin===sample.origin&&s.customer===sample.customer)?.models[model];
 host.innerHTML=`<section class="report-panel"><h2>为什么推荐这件商品</h2>${record?`<label>解释商品<select id="explain-item">${sample.models[model].ranked.map(id=>`<option value="${esc(id)}">第 ${record.items[id].rank} 名 · ${esc(sample.names[id]||id)}</option>`).join('')}</select></label><div id="explain-detail"></div>`:missing()}</section>`;
 if(!record)return;
 const draw=()=>{const id=host.querySelector('#explain-item').value,row=record.items[id],cutoff=Object.values(record.items).find(x=>x.rank===11),r=sample.models[model];host.querySelector('#explain-detail').innerHTML=`<p><strong>在 ${record.candidate_count} 件候选中排第 ${row.rank}。</strong>${cutoff?`比第 11 名高 ${num(row.score-cutoff.score)} 分。`:''}分数用于同一顾客同一起点内排序，不是购买概率。</p>${contributionTable(record.features,row,'排序分')}<h3>这个结果何时不可靠</h3><p>预测前：没有曝光、缺货与促销数据；未购买不代表不喜欢。候选池外商品无法被排序模型补回。</p><p>事后核对：当前商品${r.target.includes(id)?'出现在':'未出现在'}随后首个购物篮中；该顾客目标商品的候选覆盖为 ${num(r.candidate_recall*100)}%。命中与否用于验证，未参与上面的贡献计算。</p>`;};host.querySelector('#explain-item').onchange=draw;draw();
}
export function forecastReliability(sample,day,model){
 const h=sample.history,zeros=h.filter(x=>x===0).length,actual=sample.actual[day],p=sample.predictions[model][day],baseline=sample.predictions.weekday_median[day];
 return `<h3>这个结果何时不可靠</h3><p>预测前可见：过去 56 天有 ${zeros} 天无交易记录，最大日销量 ${num(Math.max(...h))} 件。缺货和促销状态未知，无交易记录不能直接解释为零需求。</p><p>事后核对：实际 ${num(actual)} 件，当前误差 ${num(Math.abs(p-actual))} 件；同星期中位数基线预测 ${num(baseline)} 件，误差 ${num(Math.abs(baseline-actual))} 件。${model==='tft'?`实际值${actual>=sample.q10[day]&&actual<=sample.q90[day]?'落在':'超出'}本日 P10–P90 区间 [${num(sample.q10[day])}, ${num(sample.q90[day])}]。`:''}实际销量仅用于核对，不用于生成解释。</p>`;
}
export function mountForecastExplanation(host,loaded,sample,model){
 if(!host)return;
 if(model!=='lightgbm'){host.innerHTML='';return;}
 const record=loaded['explanation-trees']?.data.forecast.find(s=>s.origin===sample.origin&&s.item===sample.item);
 host.innerHTML=`<section class="report-panel"><h2>为什么给出这个销量预测</h2>${record?`<label>解释预测日<select id="explain-day">${sample.actual.map((_,i)=>`<option value="${i}">第 ${i+1} 天</option>`).join('')}</select></label><div id="explain-detail"></div>`:missing()}</section>`;
 if(!record)return;
 const draw=()=>{const day=Number(host.querySelector('#explain-day').value),row=record.days[day];host.querySelector('#explain-detail').innerHTML=`${contributionTable(record.features,row,'件／天')}<p class="small-note">树模型输出再截为非负，最终预测 ${num(sample.predictions.lightgbm[day])} 件。</p>${forecastReliability(sample,day,model)}`;};host.querySelector('#explain-day').onchange=draw;draw();
}
