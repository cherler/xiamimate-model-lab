import {CLASSIFICATION_MODELS as MODELS,applyPolicy} from './classification-metrics.js';
const sigmoid=x=>1/(1+Math.exp(-x));
const logit=x=>Math.log(x/(1-x));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:5});
const signed=v=>`${v>0?'+':''}${num(v)}`;
const pct=v=>`${(v*100).toFixed(2)}%`;
const label=n=>n.startsWith('word_freq_')?`词频「${n.slice(10)}」`:n.startsWith('char_freq_')?`字符频率「${n.slice(10)}」`:({capital_run_length_average:'连续大写平均长度',capital_run_length_longest:'连续大写最大长度',capital_run_length_total:'大写字符总数'}[n]||n);
const value=(name,v)=>`${num(v)}${name.includes('_freq_')?'%':' 字符'}`;
const table=(headers,rows,title)=>`<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(title)}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export function verifyClassificationExplanations(e,parent,parentHash){
 const fail=reason=>{throw new Error(`分类解释校验失败：${reason}`);};
 const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8;
 if(e?.schema!=='spambase-explanation-v1'||e.run_id!==parent.run_id||e.parent_sha256!==parentHash||e.model_sha256!==parent.report.model_sha256)fail('来源版本不匹配');
 if(JSON.stringify(e.features)!==JSON.stringify(parent.report.features))fail('特征顺序不一致');
 if(!e.rows||Object.keys(e.rows).sort().join()!=='test,validation')fail('分区不完整');
 for(const model of Object.keys(MODELS)){
  const c=e.calibrators?.[model];if(!c||![c.slope,c.intercept].every(Number.isFinite)||c.clip!==1e-6)fail('校准器无效');
 }
 for(const split of ['validation','test']){
  const ids=Object.keys(e.rows[split]||{}).sort(),expected=parent.rows[split].map(r=>r.id).sort();
  if(JSON.stringify(ids)!==JSON.stringify(expected))fail('样本覆盖不一致');
  for(const row of parent.rows[split]){
   for(const model of ['logistic','lightgbm']){
    const p=e.rows[split][row.id]?.[model];
    if(!p||!Array.isArray(p.contributions)||p.contributions.length!==e.features.length||!p.contributions.every(Number.isFinite)||!close(p.base+p.contributions.reduce((a,b)=>a+b,0),p.margin)||!close(sigmoid(p.margin),row.raw_scores[model]))fail(`${row.id} 贡献不能还原评分`);
   }
   const hits=Object.entries(parent.report.protocol.models.rules).filter(([name,t])=>row.features[e.features.indexOf(name)]>=t).length;
   if(!close(hits/4,row.raw_scores.rules))fail('规则触发分数不一致');
   for(const model of Object.keys(MODELS)){
    const c=e.calibrators[model],raw=Math.max(c.clip,Math.min(1-c.clip,row.raw_scores[model]));
    if(!close(sigmoid(c.slope*logit(raw)+c.intercept),row.scores[model]))fail('校准映射不能还原保存概率');
   }
  }
 }
 return e;
}
let cached;
export async function loadClassificationExplanations(parent,manifest){
 if(!cached||cached.parent!==manifest.sha256){
  const pending=(async()=>{
   const response=await fetch('./classification-explanations/manifest.json',{cache:'no-cache'});
   if(!response.ok)throw new Error('逐样本解释尚未导出');
   const m=await response.json();
   if(!/^[a-f0-9]{16}\/case\.json$/.test(m.path)||!/^[a-f0-9]{64}$/.test(m.sha256)||m.parent_sha256!==manifest.sha256||m.run_id!==parent.run_id)throw new Error('解释资源版本不匹配');
   const result=await fetch(`./classification-explanations/${m.path}`);if(!result.ok)throw new Error('解释文件缺失');
   const bytes=await result.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==m.sha256)throw new Error('解释文件哈希不匹配');
   return verifyClassificationExplanations(JSON.parse(new TextDecoder().decode(bytes)),parent,manifest.sha256);
  })();
  cached={parent:manifest.sha256,pending};
  pending.catch(()=>{if(cached?.pending===pending)cached=null;});
 }
 return cached.pending;
}
export function sampleExplanationHtml(payload,e,sample,state){
 if(!e)return '<p class="validation-boundary">逐样本贡献暂不可用；当前判定仍来自已核验的保存评分。不能用全局重要性代替本条解释。</p>';
 const column=(model,threshold,role)=>{
  const rows=payload.rows[state.split],ordered=[...applyPolicy(rows,model,{mode:'capacity',share:1})],rank=ordered.indexOf(sample.id)+1;
  const selected=applyPolicy(rows,model,{mode:state.mode,share:state.share,threshold}).has(sample.id),wrong=selected!==Boolean(sample.label),c=e.calibrators[model];
  const policy=state.mode==='capacity'?`本条排序第 ${rank} / ${rows.length}，本次取前 ${Math.floor(rows.length*state.share)} 条（同分按特征组与源行号排序）。`:`校准概率 ${pct(sample.scores[model])} ${sample.scores[model]>=threshold?'≥':'<'} 阈值 ${pct(threshold)}，差值 ${signed((sample.scores[model]-threshold)*100)} 个百分点。`;
  let factors,calculation;
  if(model==='rules'){
   const rules=Object.entries(payload.report.protocol.models.rules),hits=rules.filter(([n,t])=>sample.features[e.features.indexOf(n)]>=t);
   factors=`<p>四项固定条件触发 ${hits.length} 项${hits.length?`：${hits.map(([n])=>esc(label(n))).join('、')}`:'；未触发'}，原始分数 ${hits.length} ÷ 4 = ${num(sample.raw_scores.rules)}。</p>`;
   calculation=table(['规则输入','本条值','阈值','是否触发'],rules.map(([n,t])=>[esc(label(n)),value(n,sample.features[e.features.indexOf(n)]),`≥ ${value(n,t)}`,sample.features[e.features.indexOf(n)]>=t?'触发':'未触发']),'四项规则计算');
  }else{
   const p=e.rows[state.split][sample.id][model],parts=p.contributions.map((v,i)=>({v,i,name:e.features[i]}));
   const up=parts.filter(p=>p.v>0).sort((a,b)=>b.v-a.v).slice(0,2),down=parts.filter(p=>p.v<0).sort((a,b)=>a.v-b.v).slice(0,2),shown=[...up,...down];
   const describe=(items)=>items.length?items.map(p=>`${esc(label(p.name))} ${value(p.name,sample.features[p.i])}（${signed(p.v)}）`).join('；'):'没有该方向的贡献';
   factors=`<p><strong>推高垃圾评分：</strong>${describe(up)}。</p><p><strong>压低垃圾评分：</strong>${describe(down)}。</p><p class="small-note">以上各取最强两项；括号为原始对数几率贡献，不是概率百分点。${model==='lightgbm'?'树模型可在不同特征条件下给出不同贡献。':'线性模型对变换后的每项输入使用固定系数。'}</p>`;
   const rest=p.contributions.reduce((a,b)=>a+b,0)-shown.reduce((a,b)=>a+b.v,0);
   calculation=`<p>${model==='lightgbm'?'原生 TreeSHAP（tree-path-dependent）按树路径统计分配贡献，基准为该解释方法的期望原始输出。相关特征和交互会影响分配；本表未单独计算交互贡献。':'每项贡献 = log1p 后按训练集标准化的输入 × 回归系数；基准是全部标准化输入为 0 时的截距。这是线性加和，不是 SHAP。'}</p><p>基准 ${num(p.base)} + 上列贡献 ${signed(shown.reduce((a,b)=>a+b.v,0))} + 其余 ${e.features.length-shown.length} 项 ${signed(rest)} = 原始对数几率 ${num(p.margin)}。sigmoid 转换后为原始分数 ${num(sample.raw_scores[model])}。</p><p>两种方法的基准不同，贡献只在各自模型内加总，不能将两列单个贡献相减当作模型增益。显示值经四舍五入，核验使用完整精度。</p>${table(['特征','本条输入','原始对数几率贡献'],[...parts].sort((a,b)=>Math.abs(b.v)-Math.abs(a.v)).map(p=>[esc(label(p.name)),value(p.name,sample.features[p.i]),signed(p.v)]),`${MODELS[model]} 全部特征贡献`)}`;
  }
  return `<section><p class="depth-role">${role} · ${MODELS[model]}</p><h4>${selected?'进入待复核队列':'不进入待复核队列'}</h4><p>${policy}</p>${factors}<p class="${wrong?'validation-boundary':'small-note'}">${wrong?'本条判定与真实标签不符；评分与复核策略共同决定这个结果，不能仅凭特征贡献归因。':'本条判定与真实标签一致；单条正确不能证明对其他邮箱有效。'}</p><details><summary>${MODELS[model]}：完整贡献与校准计算</summary>${calculation}<p>校准只用独立校准分区拟合：将原始分数裁剪到 [0.000001, 0.999999]，取 logit，再计算 sigmoid(${num(c.slope)} × logit + ${num(c.intercept)}) = ${pct(sample.scores[model])}。校准改变评分尺度；阈值或名额决定最终动作。</p><p>保存精确分数：${sample.scores[model]}；${state.mode==='threshold'?`当前精确阈值：${threshold}`:`本条精确名次：${rank}`}。以上计算均已与冻结评分校验。</p></details></section>`;
 };
 return `<section class="classification-local"><h3>这条记录的判定依据</h3><p>输入统计特征 → 模型评分 → 校准映射 → 当前复核策略。真实标签未参与本条打分。</p><div class="depth-duel">${column(state.baseline,state.baseThreshold,'对照方法')}${column(state.model,state.threshold,'当前方法')}</div><details><summary>什么时候不能依赖这份解释</summary><p>特征贡献解释保存模型如何形成分数，不证明某词导致垃圾邮件，也不保证改一个词会翻转结果。接近阈值或名额边界的动作可能随策略变化；远离边界也可能高分误判。上方显示当前边界，不把距离包装成可靠性等级。</p><p>本例仅有 1999 年语料统计特征，没有邮件正文、发件人和时间；无法验证新邮箱、未来邮件或对抗文本。全体校准误差与错误数量见效果报告，投入业务仍需独立数据及人工复核验证。</p></details></section>`;
}
