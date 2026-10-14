// Reading contracts describe frozen evidence; live scores remain in the original reports.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const CASE_READINGS={
 'recommend:tafeng':{
  name:'Ta Feng 购买行为推荐',input:'顾客在推荐时点前的购买历史',output:'分开生成复购与未购商品发现的 Top 10 商品列表',
  evidence:'先比较同一顾客的推荐，再看完整回访人群。复购通过原增益筛选，发现未通过；条件 Recall 不等于全购物篮覆盖。',
  scope:'2001 年二月已完成的测试回放；测试已参与后续反馈，不能重新当作未见测试。',
  needs:'稳定的顾客与商品编码、交易日期；复购需要已有购买记录。可售推荐还需要库存与商品状态。',
  delivery:'候选生成、排序与规则回退；同人群基线报告、候选覆盖和新老客诊断。',
  limit:'本例缺少曝光和未购买反馈，无法证明转化提升；商品名称展示也不代表模型使用文本特征。',
  evidenceTargets:['完整测试人群的模型比较','老客复购'],
 },
 'recommend:dressipi':{
  name:'Dressipi 会话商品推荐',input:'购买前的浏览顺序与匿名商品属性',output:'本次会话的商品候选与排序列表',
  evidence:'比较行为规则与学习排序，再看固定候选下的属性消融。区分未召回、未进前 100 和前 10 外，保留没有改善的特征组合。',
  scope:'已知公开数据的开发验证；展示样本不代表全体验证会话。仅限本地研究预览，不是官方成绩。',
  needs:'完整浏览会话、购买标签、跨商品一致的属性编码，并确认这些字段在推荐时可得。',
  delivery:'多路候选、属性匹配、学习排序、固定候选消融与冷商品分组诊断。',
  limit:'排序无法补回候选外的目标；属性对每个失败组的独立增益尚未验证，新目录效果需要另测。',
  evidenceTargets:['首轮模型对比','完整模型：召回与排序阶段分解'],research:true,
 },
 'forecast:m5':{
  name:'M5 商品销量预测',input:'商品历史销量、商品结构、提前已知的日历与价格',output:'未来 28 天商品日预测及门店、品类汇总',
  evidence:'同时比较层级误差、商品日误差和总量偏差。检查各窗口与困难商品；中位数基线占优的指标仍保留。',
  scope:'CA_1 单门店缩减实现；保留窗口已使用，区间证据只覆盖已评估的开发范围。仅限本地研究预览。',
  needs:'连续商品日销量、稳定编码，以及预测时已经确定的未来价格与活动计划。',
  delivery:'特征时点审计、滚动预测、分层与分组评价，以及有对应证据范围的区间评估。',
  limit:'不是完整冠军模型或排行榜复现；没有受控特征消融，不能将总增益归给价格或日历。历史销量可能受缺货影响。',
  evidenceTargets:['当前窗口的完整指标','各窗口模型对比'],research:true,
 },
 'forecast:uci':{
  name:'UCI 周销量预测',input:'预测起点前的商品销量历史',output:'未来七天总销量，另保留独立的 28 天逐日实验',
  evidence:'周预测在相同商品周上比较误差、偏差与胜出窗口；逐日实验单独评价，不能跨粒度计算提升。',
  scope:'已有多轮反馈的 UCI 开发回放，周任务为 12 商品 × 12 起点；不是新的独立测试。',
  needs:'商品、交易日期、销量及取消退货口径；需求预测还需确认缺货、促销与营业状态。',
  delivery:'强基线与模型比较、时间边界审计、逐商品误差诊断和批量预测。',
  limit:'预测量不是订货量；周总量没有逐日分配或区间保证。经营补货需要额外库存、提前期和成本信息。',
  evidenceTargets:['07 / 独立任务：7 天总销量','相同 144 个商品周上的比较'],
 },
 'forecast:tafeng':{
  name:'Ta Feng 七日销量预测',input:'周起点前已结束的销量记录',output:'固定商品接下来七天的总销量',
  evidence:'同时看全部商品周的 WAPE、总量偏差和胜出周数，保留模型未通过增益筛选的结果。',
  scope:'二月四个起点、固定 50 商品的已完成测试；后续反馈不能变成新的独立验证。',
  needs:'连续商品销量和一致的时间口径；预测目标是记录销量，促销和库存状态在本例中未知。',
  delivery:'历史特征、时间切分、强基线对照、误差分解与固定批量输出。',
  limit:'低 WAPE 不等于高准确率或更少缺货，零销量与总量偏差需要同时检查。',
  evidenceTargets:['七天销量','全部 200 个商品周的比较'],
 },
 'recommend:uci':{
  name:'UCI 推荐与特征实验',input:'推荐时点前的交易行为与方法实际使用的商品特征',output:'带回退规则的商品排序与历史样本回放',
  evidence:'比较同顾客、同候选规则下的方法；再检查复购与新商品的分组差异，避免将复购优势写成发现能力。',
  scope:'经过多轮选模和调参的历史开发验证；展示顾客与完整评估人群分开。',
  needs:'稳定交易和商品编码；需要属性的方法还要有推荐前已知且可对齐的属性。',
  delivery:'推荐候选、模型排序、经营规则回退、特征实验及人群诊断。',
  limit:'交互没有曝光与实验分流，离线命中不能换算成交额；复杂模型并非必然优于个人复购。',
  evidenceTargets:['05 / 推荐误差与人群分析','01 / 推荐模型对比'],
 },
 'classify:spambase':{
  name:'垃圾邮件识别与复核评分',input:'邮件词频、字符频率与大写统计特征',output:'风险分数和给定阈值或名额下的复核判定',
  evidence:'先看同一邮件的判定，再看纠正了多少错误、增加了多少误标。校准与识别能力分开，成本使用显式假设。',
  scope:'分组切分的历史数据留出结果；留出已使用，阈值交互只是已知结果回放。没有邮件原文。',
  needs:'在判定时可用的特征、明确标签、误标与漏判代价，以及复核容量。',
  delivery:'规则与模型比较、阈值与名额选择、错误迁移、校准评价及复核清单原型。',
  limit:'旧邮件特征不能代表现代邮箱；概率校准不保证改善，也未验证实际人工复核成本。',
  evidenceTargets:['识别改善与新增错误','同一分区的模型比较'],
 },
 'retrieve:scifact':{
  name:'科学文献检索与相关性排序',input:'科学查询与候选文献的标题、摘要',output:'按相关性排列的文献及召回、重排位置',
  evidence:'比较同查询的关键词、语义和重排结果，再看全部查询的收益、遗漏与计算成本。未标注不等于不相关。',
  scope:'全部 300 条已知公开查询，预训练模型本地推理；没有本地微调，无法排除预训练重叠。',
  needs:'可检索文本、目标领域查询与相关性评价，明确检索深度和响应时间要求。',
  delivery:'文档索引、混合召回、重排与阶段诊断；按查询分组核对效果和计算代价。',
  limit:'候选外文献无法靠重排找回；相关性排序不是事实核查或自动生成结论。新领域需独立验证。',
  evidenceTargets:['哪些查询受益，哪些查询退步','全部 300 条查询的离线评估'],
 },
 'anomaly:nab':{
  name:'设备监控与异常告警',input:'按时间到达的单变量监控观测与过去窗口',output:'异常分数、阈值触发和冷却后的告警',
  evidence:'对齐同一事件的多方法告警，分开首次发现、重复告警、窗口外告警及漏检；降低告警数也可能丢失事件。',
  scope:'NAB 三条已知公开序列，固定校准阈值；采用本站事件与告警指标，不是官方全套评分。',
  needs:'时间戳和采样频率、已知正常校准段，以及事件定义和可承受告警负担。',
  delivery:'时序特征、分数与阈值、冷却策略、事件回放及误报漏报核算。',
  limit:'标注窗口首报不是故障发生延迟；异常分数不能诊断根因，仍缺真实处置与新设备验证。',
  evidenceTargets:['默认策略的告警负担与漏检拆解','固定阈值与 60 分钟冷却的评估'],
 },
 'segments:retail':{
  name:'零售顾客分群与行为画像',input:'观察时点前 180 天的购买间隔、订单数与正向金额',output:'规则组、模型群以及群体画像与跨月迁移',
  evidence:'先看同顾客的两种归组，再分开看重拟合稳定性与跨月行为变化。群编号不是等级，轮廓分数不是准确率。',
  scope:'UCI 两期历史快照与初始样本重拟合；后续消费只作描述，没有营销干预对照。',
  needs:'稳定顾客编码、交易口径与观察周期；运营行动还需结合商品、利润和触达条件。',
  delivery:'RFM 特征、规则与聚类画像、距离拆解、群体稳定性与迁移分析。',
  limit:'分成不同人群不自动带来收益；人群行动是待验证假设，离开观察人群不等于永久流失。',
  evidenceTargets:['重拟合稳定与跨月变化分别评价','同一批顾客在两种方法中的分布'],
 },
 'decision:retail':{
  name:'有限预算下的多商品补货',input:'七日需求预测、假设库存与成本、预算和库容',output:'满足资源与整包约束的补货清单',
  evidence:'固定策略比较预测、固定预测比较策略，再拆分采购、持有和缺货费用。默认优化的场景目标改善，事后模拟成本却退步。',
  scope:'12 商品 × 12 独立七日窗口的已知开发回放；每窗重置库存，成本为假设，不是真实利润。',
  needs:'真实库存与在途、采购和持有成本、缺货代价、包装尺寸与供应提前期。',
  delivery:'预测到订单的转换、整数约束求解、策略对照、逐商品成本与资源敏感性诊断。',
  limit:'求解最优不保证未来收益；目前没有连续库存仿真、真实供应条件和独立经营验证。',
  evidenceTargets:['预测与策略的贡献对照','全部十二个窗口的模拟结果'],
 },
};
export const READING_STEPS={example:{view:'experience',label:'1 · 看输入与结果'},evidence:{view:'report',label:'2 · 看效果与代价'},fit:{view:'data',label:'3 · 看适用与交付'}};
export function readingHref(page,params,step){
 const q=new URLSearchParams(params);q.set('view',READING_STEPS[step].view);q.set('walk',step);q.delete('item');
 return `#${page}?${q}`;
}
export function readingHtml(page,params){
 const c=CASE_READINGS[`${page}:${params.get('case')}`];if(!c)return '';
 const step=Object.hasOwn(READING_STEPS,params.get('walk'))?params.get('walk'):null;
 return `<section class="case-reading" aria-label="${esc(c.name)}案例导读"><div class="reading-intro"><strong>${esc(c.name)} · 案例导读</strong><p>${esc(c.input)} → ${esc(c.output)}。</p></div><ol class="reading-steps">${Object.entries(READING_STEPS).map(([key,v])=>`<li><a data-reading-step="${key}" href="${esc(readingHref(page,params,key))}" ${step===key?'aria-current="step"':''}>${v.label}</a></li>`).join('')}</ol><p class="reading-evidence">${esc(c.evidence)}</p><details class="reading-fit" ${step==='fit'?'open':''}><summary>适用条件与可委托范围</summary><dl><div><dt>所需条件</dt><dd>${esc(c.needs)}</dd></div><div><dt>已展示的能力</dt><dd>${esc(c.delivery)}</dd></div><div><dt>尚未证明</dt><dd>${esc(c.limit)}</dd></div></dl><p>以上能力可用于讨论定制范围；新业务的效果、接口与验收要求需另行约定。本站目前仅展示公开案例，没有接入客户数据。</p><a href="#delivery">查看定制服务与交付范围</a></details><p class="reading-scope">${esc(c.scope)}${c.research?' 对外使用许可尚未确认；公开构建不包含本案例结果。':''}</p></section>`;
}
export function canShowReading(host){
 return !/暂不可用|暂未就绪|案例不存在|正在读取|当前构建未包含/.test([...host.querySelectorAll('h1,h2,.loading-copy,.report-panel>p')].map(e=>e.textContent).join(' '));
}
export function mountCaseReading(host,page,params){
 const c=CASE_READINGS[`${page}:${params.get('case')}`];if(!c||!canShowReading(host))return;
 host.querySelector('.case-reading')?.remove();
 const body=host.querySelector('#case-content');
 if(body)body.insertAdjacentHTML('beforebegin',readingHtml(page,params));
 else{const heading=host.querySelector('.page-heading');if(!heading)return;heading.insertAdjacentHTML('afterend',readingHtml(page,params));}
 const guide=host.querySelector('.case-reading');
 // Refresh from the current route because controls may have changed the saved selection.
 guide.querySelectorAll('[data-reading-step]').forEach(a=>a.onclick=()=>{const live=new URLSearchParams(location.hash.split('?')[1]||'');a.href=readingHref(page,live,a.dataset.readingStep);});
 const walk=params.get('walk');let target;
 if(walk==='fit')target=guide.querySelector('.reading-fit');
 else if(walk==='evidence')target=[...host.querySelectorAll('h2')].find(h=>c.evidenceTargets.includes(h.textContent.trim()));
 else if(walk==='example')target=(body||host).querySelector('h1');
 if(target){for(let el=target.parentElement;el&&el!==host;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
}
