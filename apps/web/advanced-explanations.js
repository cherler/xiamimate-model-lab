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
 if(model.startsWith('lightgcn_')){mountGraphExplanation(host,loaded,sample,model);return;}
 if(!['behavior','attributes','cross'].includes(model)){host.innerHTML='';return;}
 const record=loaded['explanation-trees']?.data.recommendation.find(s=>s.origin===sample.origin&&s.customer===sample.customer)?.models[model];
 host.innerHTML=`<section class="report-panel sample-explanation"><h2>当前商品的推荐依据</h2>${record?`<label>解释商品<select id="explain-item">${sample.models[model].ranked.map(id=>`<option value="${esc(id)}">第 ${record.items[id].rank} 名 · ${esc(sample.names[id]||id)}</option>`).join('')}</select></label><div id="explain-detail"></div>`:missing()}</section>`;
 if(!record)return;
 const draw=()=>{const id=host.querySelector('#explain-item').value,row=record.items[id],cutoff=Object.values(record.items).find(x=>x.rank===11),r=sample.models[model];host.querySelector('#explain-detail').innerHTML=`<p><strong>在 ${record.candidate_count} 件候选中排第 ${row.rank}。</strong>${cutoff?`比第 11 名高 ${num(row.score-cutoff.score)} 分。`:''}分数用于同一顾客同一起点内排序，不是购买概率。</p>${contributionTable(record.features,row,'排序分')}<h3>当前样本的可靠性与限制</h3><p>预测前：没有曝光、缺货与促销数据；未购买不代表不喜欢。候选池外商品无法被排序模型补回。</p><p>事后核对：当前商品${r.target.includes(id)?'出现在':'未出现在'}随后首个购物篮中；该顾客目标商品的候选覆盖为 ${num(r.candidate_recall*100)}%。命中与否用于验证，未参与上面的贡献计算。</p>`;};host.querySelector('#explain-item').onchange=draw;draw();
}
export function forecastReliability(sample,day,model){
 const h=sample.history,zeros=h.filter(x=>x===0).length,actual=sample.actual[day],p=sample.predictions[model][day],baseline=sample.predictions.weekday_median[day];
 return `<h3>当前样本的可靠性与限制</h3><p>预测前可见：过去 56 天有 ${zeros} 天无交易记录，最大日销量 ${num(Math.max(...h))} 件。缺货和促销状态未知，无交易记录不能直接解释为零需求。</p><p>事后核对：实际 ${num(actual)} 件，当前误差 ${num(Math.abs(p-actual))} 件；同星期中位数基线预测 ${num(baseline)} 件，误差 ${num(Math.abs(baseline-actual))} 件。${model==='tft'?`实际值${actual>=sample.q10[day]&&actual<=sample.q90[day]?'落在':'超出'}本日 P10–P90 区间 [${num(sample.q10[day])}, ${num(sample.q90[day])}]。`:''}实际销量仅用于核对，不用于生成解释。</p>`;
}
export function mountForecastExplanation(host,loaded,sample,model){
 if(!host)return;
 if(model==='tft'){mountTftExplanation(host,loaded,sample);return;}
 if(model!=='lightgbm'){host.innerHTML='';return;}
 const record=loaded['explanation-trees']?.data.forecast.find(s=>s.origin===sample.origin&&s.item===sample.item);
 host.innerHTML=`<section class="report-panel sample-explanation"><h2>当前销量预测的特征贡献</h2>${record?`<label>解释预测日<select id="explain-day">${sample.actual.map((_,i)=>`<option value="${i}">第 ${i+1} 天</option>`).join('')}</select></label><div id="explain-detail"></div>`:missing()}</section>`;
 if(!record)return;
 const draw=()=>{const day=Number(host.querySelector('#explain-day').value),row=record.days[day];host.querySelector('#explain-detail').innerHTML=`${contributionTable(record.features,row,'件／天')}<p class="small-note">树模型输出再截为非负，最终预测 ${num(sample.predictions.lightgbm[day])} 件。</p>${forecastReliability(sample,day,model)}`;};host.querySelector('#explain-day').onchange=draw;draw();
}

const tftLabels={item:'商品身份',quantity:'历史销量',log_price:'训练期历史价格',quantity_center:'训练期销量中心',quantity_scale:'训练期销量尺度',time_scaled:'时间位置',relative_time_idx:'距预测起点的位置'};
const tftLabel=key=>tftLabels[key]||featureLabel(key);
const weightTable=weights=>table(['模型读取的信息','选择权重'],Object.entries(weights).sort((a,b)=>b[1]-a[1]).map(([key,value])=>[esc(tftLabel(key)),`${num(value*100)}%`]));
function mountTftExplanation(host,loaded,sample){
 const record=loaded['explanation-tft']?.data.find(s=>s.origin===sample.origin&&s.item===sample.item);
 host.innerHTML=`<section class="report-panel sample-explanation"><h2>TFT 的历史输入与预测依据</h2>${record?`<label>解释预测日<select id="explain-day">${sample.actual.map((_,i)=>`<option value="${i}">第 ${i+1} 天</option>`).join('')}</select></label><div id="explain-detail"></div>`:missing()}</section>`;
 if(!record)return;
 const draw=()=>{
  const day=Number(host.querySelector('#explain-day').value),row=record.days[day];
  const attention=row.history_attention.map((weight,i)=>({weight,i})).sort((a,b)=>b.weight-a.weight).slice(0,5);
  const largest=Object.entries(row.decoder_weights).sort((a,b)=>b[1]-a[1])[0];
  host.querySelector('#explain-detail').innerHTML=`
   <p><strong>第 ${day+1} 天预测 ${num(row.prediction)} 件。</strong>在该日的已知未来输入中，“${esc(tftLabel(largest[0]))}”的选择权重最高，为 ${num(largest[1]*100)}%。权重说明信息如何进入模型，不能解释为它贡献了多少件销量，也没有推高／压低方向。</p>
   <h3>近期销量替换对照</h3>
   <p>固定模型、商品信息与未来日历，将最近 7 天销量替换为此前 7 周各同星期的中位数，再执行一次推理。当前日预测变为 ${num(row.scenario_prediction)} 件，变化 ${signed(row.scenario_prediction-row.prediction)} 件。这是输入敏感性演示，不是重训结果、真实干预效果或预测区间。</p>
   <details><summary>查看本次替换的 7 天历史</summary>${table(['距预测起点','真实历史销量','替换销量'],record.scenario_history.map((v,i)=>[`前 ${7-i} 天`,num(sample.history[49+i]),num(v)]))}</details>
   <h3>当前预测关注的历史位置</h3>
   ${table(['历史位置','当日记录销量','注意力权重'],attention.map(x=>[`起点前 ${56-x.i} 天`,num(sample.history[x.i]),`${num(x.weight*100)}%`]))}
   <p class="small-note">展示权重最高的 5 个历史位置。全部历史位置的权重合计 ${num(row.history_attention.reduce((a,b)=>a+b,0)*100)}%；其余 ${num(row.decoder_attention_mass*100)}% 关注更早的预测位置所含已知信息，不读取未来实际销量。注意力作用于模型内部表示，不是各日销量的贡献或购买原因。</p>
   <details><summary>查看输入选择权重与重放核验</summary><h4>当前预测日的已知未来输入</h4>${weightTable(row.decoder_weights)}<h4>56 天历史编码的平均输入权重</h4>${weightTable(record.encoder_weights)}<h4>商品与训练期统计的静态输入权重</h4>${weightTable(record.static_weights)}<p class="small-note">各组分别归一化，不能跨组相加。使用保存的 TFT 权重与预处理参数重放，七天分位数最大差异 ${esc(record.replay_max_error.toExponential(2))}。输出与原页面相同，均截为非负并排序分位数；权重用于描述内部信息选择，不代表对最终 P50 的加法分解。</p></details>
   ${forecastReliability(sample,day,'tft')}
   <p class="small-note">本模型在全部开发样本上的 P10–P90 实际覆盖为 ${num(loaded.tft.interval.coverage*100)}%，低于名义 80%；单日命中区间不能证明可靠，也不能将逐日端点相加当作周销量保障。</p>`;
 };
 host.querySelector('#explain-day').onchange=draw;draw();
}

function mountGraphExplanation(host,loaded,sample,model){
 const record=loaded['explanation-graph']?.data.find(s=>s.origin===sample.origin&&s.customer===sample.customer)?.models[model];
 host.innerHTML=`<section class="report-panel sample-explanation"><h2>购买关系与推荐分数</h2>${record?`<label>解释商品<select id="explain-item">${sample.models[model].ranked.map(id=>`<option value="${esc(id)}">第 ${record.items[id].rank} 名 · ${esc(sample.names[id]||id)}</option>`).join('')}</select></label><div id="explain-detail"></div>`:missing()}</section>`;
 if(!record)return;
 const draw=()=>{const id=host.querySelector('#explain-item').value,row=record.items[id],ranks=Object.values(row.seed_ranks);host.querySelector('#explain-detail').innerHTML=`<p><strong>在 ${record.candidate_count} 件候选中排第 ${row.rank}。</strong>分数由顾客自身学到的向量贡献 ${num(row.own)} 与购买邻居贡献 ${signed(row.neighbor_total)} 相加，得到 ${num(row.score)}。</p><p>模型从该顾客在训练目录中买过的 ${row.neighbor_count} 件商品传播信息；下表列出对当前分数影响绝对值最大的 6 件。推荐商品在历史图中连接 ${row.item_support} 名顾客。</p>${table(['提供邻域信息的已购商品','推高／压低排序分'],row.neighbors.map(x=>[`${esc(x.name)}<small> · ${esc(x.item)}</small>`,signed(x.contribution)]).concat([['其余购买邻居合计',signed(row.other_neighbors)]]))}<h3>当前样本的可靠性与限制</h3><p>预测前可见：三个已训练种子给这件商品的名次为 ${Object.entries(row.seed_ranks).map(([key,rank])=>`${esc(key.replace('lightgcn_','种子 '))}：${rank}`).join('；')}，其中 ${ranks.filter(x=>x<=10).length}／${ranks.length} 次进入 Top 10。${ranks.some(x=>x>10)?'是否进入推荐列表会随训练随机性变化。':'这三个种子都将其放入 Top 10，但不能据此推断购买概率。'}这些名次不是置信区间。</p><p>历史关系少、新顾客／新商品、偏好变化时需要另行验证；本模型未使用名称、价格、促销等商品属性。事后核对：该商品${sample.models[model].target.includes(id)?'命中':'未命中'}随后首个购物篮，真实答案未用于这次分解。</p><details><summary>计算方式与解释边界</summary><p>将固定的商品最终向量，与顾客第 0／1／2 层向量的平均值相乘。第 1、2 层按顾客直接购买邻居聚合，使用训练时相同的度归一化权重；自身项与全部邻居项精确重建原分数，误差 ${esc(row.reconstruction_error.toExponential(2))}。</p><p>这解释的是保存权重下的信息路径。它不是删除某件购买记录后重新训练的效果，也不能证明顾客因这件商品而购买另一件商品；名称只是帮助辨认邻居。</p></details>`;};host.querySelector('#explain-item').onchange=draw;draw();
}
