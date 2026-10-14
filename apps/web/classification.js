import {saveSelection} from './navigation-state.js';
import {pairForState,classificationPair,mailDuel,classificationConditions,classificationCosts,calibrationEvidence,TRANSITIONS} from './classification-depth.js';
import {CLASSIFICATION_MODELS as MODELS,applyPolicy,confusionCounts,scoreMetrics,verifyClassification} from './classification-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'不定义':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:4});
const pct=v=>v==null?'不定义':`${(v*100).toFixed(2)}%`;
const titles={experience:'案例体验',data:'案例与数据',models:'特征与模型',report:'效果报告'};
const table=(headers,rows,label)=>`<div class="table-scroll classification-table" role="region" tabindex="0" aria-label="${label}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const select=(id,label,choices,value)=>`<label for="${id}">${label}<select id="${id}">${choices.map(([v,t])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
const cards=rows=>`<div class="showcase-metrics">${rows.map(([label,value,note])=>`<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div>`;
export function featureLabel(name){
 if(name.startsWith('word_freq_'))return `词频「${name.slice(10)}」`;
 if(name.startsWith('char_freq_'))return `字符频率「${name.slice(10)}」`;
 return {capital_run_length_average:'连续大写字符平均长度',capital_run_length_longest:'连续大写字符最大长度',capital_run_length_total:'大写字符总数'}[name]||name;
}
const featureValue=(name,value)=>`${num(value)}${name.includes('_freq_')?'%':' 字符'}`;
let cached;
async function load(){
 if(!cached)cached=(async()=>{
  const response=await fetch('./classification-results/manifest.json',{cache:'no-cache'});if(!response.ok)throw new Error('分类案例尚未导出，请运行训练与结果导出流程');
  const m=await response.json();if(!/^[a-f0-9]{16}\/case\.json$/.test(m.path)||!/^[a-f0-9]{64}$/.test(m.sha256))throw new Error('分类资源清单无效');
  const result=await fetch(`./classification-results/${m.path}`);if(!result.ok)throw new Error('分类结果文件缺失');
  const bytes=await result.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(sha!==m.sha256)throw new Error('分类结果校验失败');
  const payload=JSON.parse(new TextDecoder().decode(bytes));if(payload.run_id!==m.run_id)throw new Error('分类结果版本不一致');
  return {payload:verifyClassification(payload),manifest:m};
 })().catch(e=>{cached=null;throw e;});
 return cached;
}
function curves(data,model){
 const series=Object.entries(MODELS).map(([id,name])=>({id,name,points:scoreMetrics(data,id).pr}));
 const colors={rules:'#af8038',logistic:'#657c97',lightgbm:'#087f9d'};
 return `<div class="classification-chart" role="region" tabindex="0" aria-label="精确率召回率曲线"><svg viewBox="0 0 640 300" role="img" aria-label="三种方法的 PR 曲线，横轴召回率，纵轴精确率"><path d="M55 20V255H610" fill="none" stroke="#8ca0af"/>${[0,.25,.5,.75,1].map(v=>`<path d="M55 ${255-230*v}H610" stroke="#dce7ee"/><text x="44" y="${260-230*v}" text-anchor="end">${v}</text><text x="${55+555*v}" y="276" text-anchor="middle">${v}</text>`).join('')}${series.map(s=>`<path d="${s.points.map((p,i)=>`${i?'L':'M'}${55+555*p.recall},${255-230*p.precision}`).join(' ')}" fill="none" stroke="${colors[s.id]}" stroke-width="${s.id===model?3:1.5}"/>`).join('')}<text x="300" y="297">召回率 Recall</text><text x="60" y="15">精确率 Precision</text></svg></div><p class="small-note">${series.map(s=>`<span style="color:${colors[s.id]}">● ${s.name}</span>`).join('　')}。曲线按不同分数的阈值形成；AP 使用阶梯积分，图中连接线仅辅助阅读。</p>`;
}
function calibrationChart(bins){
 return `<div class="classification-chart" role="region" tabindex="0" aria-label="概率校准图"><svg viewBox="0 0 460 285" role="img" aria-label="横轴平均预测概率，纵轴实际垃圾邮件比例；虚线为理想校准"><path d="M50 20V245H435M50 245L435 20" fill="none" stroke="#9babb7" stroke-dasharray="4 4"/>${[0,.5,1].map(v=>`<text x="40" y="${250-225*v}" text-anchor="end">${v}</text><text x="${50+385*v}" y="262" text-anchor="middle">${v}</text>`).join('')}${bins.filter(b=>b.n).map(b=>`<circle cx="${50+385*b.mean_score}" cy="${245-225*b.positive_rate}" r="5" fill="#087f9d"><title>${b.n} 条：平均 ${pct(b.mean_score)}，实际 ${pct(b.positive_rate)}</title></circle>`).join('')}<text x="150" y="282">平均预测概率</text><text x="50" y="14">实际垃圾邮件比例</text></svg></div>`;
}
function experience(payload,state,lesson=false){
 const rows=payload.rows[state.split],r=payload.report,pair=pairForState(payload,state),selected=pair.selected,c=pair.current;
 const outcome=row=>selected.has(row.id)?(row.label?'tp':'fp'):(row.label?'fn':'tn');
 const outcomeNames={tp:'正确识别垃圾邮件',fp:'误标正常邮件',fn:'漏掉垃圾邮件',tn:'正常邮件未标记'};
 const transitions=new Map(pair.transitions.map(t=>[t.row.id,t.status]));
 const filtered=rows.filter(row=>(state.filter==='all'||outcome(row)===state.filter)&&(state.transition==='all'||transitions.get(row.id)===state.transition));
 const byId=new Map(rows.map(row=>[row.id,row]));const queue=[...selected].slice(0,20).map(id=>byId.get(id));
 const sample=filtered.find(row=>row.id===state.sample)||filtered[0];state.sample=sample?.id;
 const opening=`<div class="lesson-controls">${select('cls-split','结果范围',[['test','一次性留出评估'],['validation','开发验证（用于选模）']],state.split)}${select('cls-model','当前评分模型',Object.entries(MODELS),state.model)}${select('cls-baseline','对照评分模型',Object.entries(MODELS),state.baseline)}${select('cls-mode','处理策略',[['threshold','分数达到阈值'],['capacity','按固定复核名额排序']],state.mode)}${state.mode==='threshold'?`<label for="cls-threshold">当前模型阈值（达到即标记）<input id="cls-threshold" type="number" min="0" max="1.000001" step="any" value="${state.threshold}"/></label><label for="cls-base-threshold">对照模型阈值（达到即标记）<input id="cls-base-threshold" type="number" min="0" max="1.000001" step="any" value="${state.baseThreshold}"/></label>`:`<label for="cls-share">复核名额占比（%）<input id="cls-share" type="number" min="0" max="100" step="1" value="${state.share*100}"/></label>`}</div><div class="download-actions"><button class="primary" id="cls-apply">应用当前参数</button><button class="outline" id="cls-reset">恢复两侧验证集冻结阈值</button><span class="small-note">当前 ${rows.length} 条；模型默认阈值 ${num(r.thresholds[state.model])}。精确值参与比较。</span></div><p id="cls-input-error" role="status"></p><p class="validation-boundary">阈值和名额调整是历史结果上的策略演示，不会重训或改写默认成绩。${state.mode==='capacity'?`本次分配 floor(${rows.length} × ${pct(state.share)}) = ${c.selected} 个名额；同分按特征组与源行号稳定排序。`:'标记表示进入待复核列表，不自动删除邮件。'}分数经独立校准集映射，但不能保证新邮箱中的真实概率。</p>`;
 if(lesson)return opening+classificationPair(payload,state,pair);
 return opening+`${classificationPair(payload,state,pair)}<section class="m5-section"><h2>当前策略的识别与误判</h2>${cards([['标记／待复核',`${c.selected} 条`,`${pct(c.selected/rows.length)} 的当前记录`],['标记精确率',pct(c.precision),'真正垃圾邮件 ÷ 标记总数'],['垃圾邮件召回',pct(c.recall),'找回垃圾邮件 ÷ 全部垃圾邮件'],['正常邮件误报率',pct(c.fpr),'误标正常邮件 ÷ 全部正常邮件']])}<div class="classification-confusion"><div><span>正确识别垃圾邮件 · TP</span><strong>${c.tp}</strong></div><div class="classification-error"><span>误标正常邮件 · FP</span><strong>${c.fp}</strong></div><div class="classification-error"><span>漏掉垃圾邮件 · FN</span><strong>${c.fn}</strong></div><div><span>正常邮件未标记 · TN</span><strong>${c.tn}</strong></div></div><p class="small-note">精确率的分母是标记记录，误报率的分母是正常邮件。零标记时精确率不定义；复核工作量是模拟数量，不是实测节省时间或业务收益。</p><details><summary>查看复核队列前 20 条（按分数排序）</summary><p>当前共 ${selected.size} 条待复核；此处显示前 ${queue.length} 条。样本浏览器按源行号排列，可另行筛选全部误标或漏判。</p>${queue.length?table(['队列名次','样本','校准概率估计','真实标签'],queue.map((row,i)=>[i+1,esc(row.id),pct(row.scores[state.model]),row.label?'垃圾邮件':'正常邮件']),'复核队列'):'<p>当前没有记录进入复核队列。</p>'}</details></section><section class="m5-section"><h2>真实样本与错误回放</h2><div class="lesson-controls">${select('cls-transition','配对变化类型',[['all','全部配对变化'],...Object.entries(TRANSITIONS)],state.transition)}${select('cls-filter','当前模型结果类型',[['all','全部样本'],['fp','误标正常邮件'],['fn','漏掉垃圾邮件'],['tp','正确识别垃圾邮件'],['tn','正常邮件未标记']],state.filter)}${filtered.length?select('cls-sample',`样本（当前 ${filtered.length} 条）`,filtered.map(row=>[row.id,`${row.id} · ${outcomeNames[outcome(row)]}`]),sample.id):'<p>当前两个筛选条件没有匹配样本；可切回全部类型。</p>'}</div>${sample?`<article class="case-story"><h3>${esc(sample.id)} · ${outcomeNames[outcome(sample)]}</h3><p>源文件第 ${sample.source_row} 行；实际标签：${sample.label?'垃圾邮件（1）':'正常邮件（0）'}。本站不持有原始主题与正文，仅回放公开统计特征。</p>${mailDuel(sample,state,pair)}${table(['模型','原始分数','校准后概率估计'],Object.keys(MODELS).map(m=>[MODELS[m],num(sample.raw_scores[m]),pct(sample.scores[m])]),'样本模型分数')}<p class="small-note">规则原始分数是四项条件触发占比，不是概率。模型分数对应垃圾邮件标签，不是用户信用或个人风险。</p>${table(['真实输入特征','数值','固定规则'],Object.entries(r.protocol.models.rules).map(([name,threshold])=>[esc(featureLabel(name)),featureValue(name,sample.features[r.features.indexOf(name)]),`≥ ${featureValue(name,threshold)}：${sample.features[r.features.indexOf(name)]>=threshold?'触发':'未触发'}`]),'样本规则与真实特征')}<details><summary>查看全部 ${r.features.length} 项输入特征</summary>${table(['字段','含义','当前值'],r.features.map((name,i)=>[esc(name),esc(featureLabel(name)),featureValue(name,sample.features[i])]),'全部样本特征')}</details></article>`:''}</section>${classificationCosts(payload,state,pair)}${calibrationEvidence(r,state)}${classificationConditions(state)}`;
}
function reportView(payload,state){
 const r=payload.report,rows=payload.rows[state.split];
 const calibration=r[state.split][state.model],brierChange=calibration.calibrated.brier-calibration.raw.brier,eceChange=calibration.calibrated.ece-calibration.raw.ece;
 return `<div class="lesson-controls">${select('cls-split','报告范围',[['test','一次性留出评估'],['validation','开发验证（用于选模）']],state.split)}${select('cls-model','校准诊断模型',Object.entries(MODELS),state.model)}</div><section class="m5-section"><h2>同一分区的模型比较</h2><p>主模型 ${MODELS[r.selected_model]} 在开发验证集按校准后 AP 选出；所有默认阈值在验证集约束误报率 ≤2% 后冻结，留出集不保证满足相同误报率。当前 ${rows.length} 条，垃圾邮件 ${r[state.split].rules.calibrated.positives} 条。</p>${table(['模型','PR-AUC（AP）↑','ROC-AUC ↑','Brier ↓','默认阈值','精确率','召回率','误报率'],Object.entries(MODELS).map(([id,name])=>{const v=r[state.split][id];return [name+(id===r.selected_model?' · 验证集选定':''),num(v.calibrated.ap),num(v.calibrated.roc_auc),num(v.calibrated.brier),num(r.thresholds[id]),pct(v.policy.precision),pct(v.policy.recall),pct(v.policy.fpr)];}),'分类模型完整比较')}${curves(rows,state.model)}<p class="small-note">AP 为 average precision（阶梯积分），不是梯形积分 PR 面积；随机排序的参考正例占比为 ${pct(r[state.split].rules.calibrated.prevalence)}，随数据分布改变。</p></section><section class="m5-section"><h2>${MODELS[state.model]} 的概率校准</h2><p>校准器只在独立校准分区拟合。Brier 是概率与标签的均方误差；ECE 是十个等宽分箱的加权绝对校准误差。分箱少量样本的比例可能不稳定。</p>${table(['分数版本','AP ↑','Brier ↓','Log loss ↓','ECE ↓'],['raw','calibrated'].map(key=>{const v=r[state.split][state.model][key];return [key==='raw'?(state.model==='rules'?'校准前（触发比例）':'校准前'):'校准后',num(v.ap),num(v.brier),num(v.log_loss),num(v.ece)];}),'校准前后指标')}<p class="small-note">本范围校准后 Brier ${brierChange>0?'升高':'降低'} ${Math.abs(brierChange).toFixed(6)}，ECE ${eceChange>0?'升高':'降低'} ${Math.abs(eceChange).toFixed(6)}（两者越低越好）。校准可能在新样本上变差；此处保留两版成绩，不根据留出表现重新选择校准器。</p><div class="classification-calibration">${calibrationChart(r[state.split][state.model].calibrated.bins)}${table(['概率区间','条数','平均概率','实际垃圾比例'],r[state.split][state.model].calibrated.bins.map((b,i)=>[`${pct(b.lower)}～${pct(b.upper)}${i===9?'（含右端）':''}`,b.n,pct(b.mean_score),pct(b.positive_rate)]),'概率校准分箱')}</div></section><section class="case-story"><h2>留出结果的适用范围</h2><p>这是同一历史语料的分组随机留出，不是未来时段、跨发件人或新邮箱测试。相同保留特征不跨分区，近重复邮件仍无法排除。已查看的留出结果不能用于调参后再次称为新独立测试。</p></section>`;
}
function dataView(r){
 return `<section class="case-story"><h2>业务任务与交付内容</h2><dl><div><dt>决策时刻</dt><dd>邮件到达并提取统计特征后，判断是否进入人工复核队列。</dd></div><div><dt>可用输入</dt><dd>词频、字符频率和连续大写长度。数据没有原始正文、主题、时间或发件人身份。</dd></div><div><dt>输出</dt><dd>每条记录的标签分数、校准概率估计、队列标记和评估记录。不连接邮箱或自动删信。</dd></div></dl></section><section class="m5-section"><h2>数据来源与范围</h2><p><a href="https://archive.ics.uci.edu/dataset/94/spambase" target="_blank" rel="noreferrer">UCI Spambase</a>，1999 年发布；原始 ${r.rows} 行、${r.original_features} 项特征，标签 1 为垃圾邮件、0 为正常邮件。原数据无正文可供展示，不虚构主题或邮件内容。</p><p>本次文件检查无缺失或非有限值。预先排除 george、650、hp、hpl 四项与采集来源相关的特征，保留 ${r.features.length} 项。其余收集偏差仍可能存在，不作为通用现代邮件过滤器。</p>${table(['信息','定义','单位'],[['词频','某词出现次数 ÷ 总词数 ×100','百分比'],['字符频率','某字符出现次数 ÷ 总字符数 ×100','百分比'],['大写长度','连续大写平均／最大长度，以及大写总数','字符'],['真实标签','源文件原始分类，不由本项目模型生成','0 / 1']],'数据字段与单位')}</section><section class="m5-section"><h2>分组切分与训练边界</h2><p>用保留特征向量的 SHA-256 分组，共 ${r.unique_groups} 组；相同输入即使标签不同也不跨集合。哈希分配约 60%／15%／10%／15%，实际行数如下。填补、变换与标准化只拟合训练集。</p>${table(['分区','记录数','用途'],[['训练',r.split_sizes.train,'拟合逻辑回归和 LightGBM'],['校准',r.split_sizes.calibration,'只拟合每个模型的 sigmoid 概率映射'],['验证',r.split_sizes.validation,'选择模型和冻结每模型默认阈值'],['留出',r.split_sizes.test,'冻结后一次评分，当前已使用']],'分区与用途')}<p>没有日期与发件人键，无法实施时间或发件人留出。完全相同特征分组只能减少一类重复泄漏，不能消除相近邮件的关联。</p></section><section class="m5-section"><h2>复现与版本</h2><p>实验 ${esc(r.run_id)}；种子 ${r.protocol.seed}。本地 CPU，规则与模型拟合含校准约 ${num(Object.values(r.training_seconds).reduce((a,b)=>a+b,0))} 秒，整段开发约 ${num(r.development_seconds)} 秒；不含下载、页面加载，不是线上延迟。</p><dl class="case-facts"><div><dt>原数据 SHA-256</dt><dd class="case-field">${r.data_sha256}</dd></div><div><dt>模型文件 SHA-256</dt><dd class="case-field">${r.model_sha256}</dd></div><div><dt>训练环境</dt><dd>Python ${r.environment.python}；scikit-learn ${r.environment.sklearn}；LightGBM ${r.environment.lightgbm}</dd></div></dl></section>`;
}
function modelsView(r){
 const ranked=[...r.feature_summary].sort((a,b)=>b.lightgbm_gain-a.lightgbm_gain);
 return `<section class="m5-section"><h2>三个模型的输入与训练方式</h2>${table(['模型','方法','参数与输出'],[['四项规则','free、remove、$ 的频率及最大连续大写长度达到阈值；取触发比例','固定规则，不从测试集学习阈值。原始分数只有五档。'],['逻辑回归','训练中位数填补 → log1p → 训练集标准化 → 线性分类','C=1、最多 3000 次迭代；可解释系数方向，不等于因果。'],['LightGBM','训练中位数填补后由树学习非线性与交互','300 棵树、15 叶、学习率 0.04、最少叶样本 30；本轮未做超参搜索。']],'分类模型方法')}<p>三个模型分别在独立校准集拟合 sigmoid。规则条件在训练前固定；主模型与默认阈值只由验证集选择。源码、模型、协议和数据指纹保存在本地实验目录。</p></section><section class="m5-section"><h2>固定规则定义</h2>${table(['字段','触发条件'],Object.entries(r.protocol.models.rules).map(([name,value])=>[esc(featureLabel(name)),`≥ ${featureValue(name,value)}`]),'规则阈值定义')}</section><section class="m5-section"><h2>训练特征与模型权重</h2><p>按 LightGBM 训练分裂增益排序，展示全部 ${r.features.length} 项；增益不是单样本解释或业务贡献。逻辑回归系数对应 log1p 后标准化输入，正数趋向垃圾邮件。相关特征可能分摊重要性。</p>${table(['特征','训练中位数','训练 P95','逻辑回归系数','LightGBM 分裂增益'],ranked.map(f=>[esc(featureLabel(f.name)),featureValue(f.name,f.median),featureValue(f.name,f.p95),num(f.logistic_coefficient),num(f.lightgbm_gain)]),'训练特征权重')}</section>`;
}
export async function renderClassification(host,current,params){
 const view=params.get('view')||'experience';
 const nav=`<nav class="case-views" aria-label="案例内容">${Object.entries(titles).map(([key,title])=>`<a href="#classify?case=spambase&view=${key}" ${view===key?'aria-current="page"':''}>${title}</a>`).join('')}</nav>`;
 if(params.get('case')!=='spambase'){host.innerHTML='<h1>分类案例不存在</h1><a href="#classify">打开 Spambase</a>';return;}
 host.innerHTML=nav+'<p class="loading-copy">正在读取并核验分类结果…</p>';
 try{
  const {payload,manifest}=await load();if(!current())return;
  const r=payload.report,initialModel=Object.hasOwn(MODELS,params.get('model'))?params.get('model'):r.selected_model,state={split:params.get('split')==='validation'?'validation':'test',model:initialModel,baseline:'rules',baseThreshold:r.thresholds.rules,transition:'all',costs:{fp:10,fn:1,review:.1},mode:'threshold',threshold:r.thresholds[initialModel],share:.2,filter:'all',sample:null};
  host.innerHTML=`<div class="breadcrumb">分类与评分<span>/</span>Spambase</div><header class="page-heading"><div><h1>垃圾邮件识别与复核评分</h1><p>使用公开邮件统计特征，比较规则、逻辑回归与 LightGBM。调整阈值或复核名额，查看识别数量和误标正常邮件的变化。</p></div></header>${nav}<div id="classification-content"></div><footer class="showcase-source"><h2>来源与使用说明</h2><p>Hopkins, M., Reeber, E., Forman, G., &amp; Suermondt, J. (1999). <a href="https://archive.ics.uci.edu/dataset/94/spambase" target="_blank" rel="noreferrer">Spambase · UCI</a>，DOI 10.24432/C53G6X；<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>。本站对特征进行了排除、分组切分、训练与校准；结果不代表数据作者背书或现代邮箱效果。</p><p>实验 ${esc(r.run_id)}。页面只读取保存结果，无客户数据上传、邮箱连接或在线训练。</p><a class="text-link" href="./classification-results/${manifest.path}" download>下载本实验结果与样本</a></footer>`;
  if(Object.hasOwn(MODELS,params.get('baseline')))state.baseline=params.get('baseline');
  state.baseThreshold=r.thresholds[state.baseline];
  for(const key of ['threshold','baseThreshold','share']){const n=Number(params.get(key));if(params.has(key)&&Number.isFinite(n)&&n>=0&&n<=(key==='share'?1:1.000001))state[key]=n;}
  if(['threshold','capacity'].includes(params.get('mode')))state.mode=params.get('mode');
  if(params.has('sample'))state.sample=params.get('sample');
  for(const key of ['fp','fn','review']){const n=Number(params.get('cost_'+key));if(params.has('cost_'+key)&&Number.isFinite(n)&&n>=0&&n<=1000000)state.costs[key]=n;}
  const content=host.querySelector('#classification-content');
  const draw=()=>{
   const active=host.ownerDocument.activeElement?.id;
   content.innerHTML=view==='data'?dataView(r):view==='models'?modelsView(r):view==='report'?reportView(payload,state):experience(payload,state,view==='learn');
   saveSelection('classify',{case:'spambase',view,split:state.split,model:state.model,baseline:state.baseline,threshold:state.threshold,baseThreshold:state.baseThreshold,share:state.share,mode:state.mode,sample:state.sample,...Object.fromEntries(Object.entries(state.costs).map(([k,v])=>['cost_'+k,v]))});
   const fields={'cls-split':'split','cls-model':'model','cls-baseline':'baseline','cls-base-threshold':'baseThreshold','cls-transition':'transition','cls-mode':'mode','cls-threshold':'threshold','cls-share':'share','cls-filter':'filter','cls-sample':'sample'};
   for(const [id,key] of Object.entries(fields)){
    const control=content.querySelector(`#${id}`);if(!control)continue;
    control.onchange=e=>{
     const value=['threshold','baseThreshold','share'].includes(key)?Number(e.target.value):e.target.value;
     if(['threshold','baseThreshold','share'].includes(key)&&(!e.target.value.trim()||!Number.isFinite(value)||value<0||value>(key==='share'?100:1.000001))){content.querySelector('#cls-input-error').textContent='请输入允许范围内的数字；结果仍使用上一次有效参数。';return;}
     state[key]=key==='share'?value/100:value;if(key==='model')state.threshold=r.thresholds[state.model];if(key==='baseline')state.baseThreshold=r.thresholds[state.baseline];draw();
    };
   }
   const costForm=content.querySelector('#cls-cost-form');
   if(costForm)costForm.onsubmit=e=>{
    e.preventDefault();const costs={};
    for(const key of ['fp','fn','review']){const input=content.querySelector('#cls-cost-'+key),value=Number(input.value);if(!input.value.trim()||!Number.isFinite(value)||value<0||value>1000000){content.querySelector('#cls-cost-error').textContent='请输入 0～1,000,000 的有限数字；结果仍使用上一组成本假设。';return;}costs[key]=value;}
    state.costs=costs;draw();content.querySelector('#cls-cost-fp')?.focus({preventScroll:true});
   };
   const apply=content.querySelector('#cls-apply');if(apply)apply.onclick=()=>{const input=content.querySelector(state.mode==='threshold'?'#cls-threshold':'#cls-share');input.onchange({target:input});};
   const reset=content.querySelector('#cls-reset');if(reset)reset.onclick=()=>{state.mode='threshold';state.threshold=r.thresholds[state.model];state.baseThreshold=r.thresholds[state.baseline];draw();};
   if(active&&Object.hasOwn(fields,active))content.querySelector(`#${active}`)?.focus({preventScroll:true});
  };draw();
 }catch(error){if(current())host.innerHTML=nav+`<section class="report-panel"><h1>分类结果暂不可用</h1><p>${esc(error.message)}</p><p>完成训练与结果核验后刷新，不使用模拟成绩代替。</p></section>`;}
}
