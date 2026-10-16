import {isCrossContext} from './anomaly-cross-metrics.js';
import {saveSelection} from './navigation-state.js';
import {CASE_EXERCISES,exerciseHref} from './case-exercises.js';
import {PUBLIC_CASE_PATHS,caseMethodHref,publicCasePath} from './case-paths.js';
// Reading contracts describe frozen evidence; live scores remain in the original reports.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const CASE_READINGS={
 'recommend:tafeng':{
  name:'Ta Feng 购买行为推荐',input:'顾客在推荐时点前的购买历史',output:'分开生成复购与未购商品发现的 Top 10 商品列表',
  verdict:'老客复购通过预设增益筛选；未购商品发现没有通过。',
  evidence:'先比较同一顾客的推荐，再看完整回访人群。复购通过原增益筛选，发现未通过；条件 Recall 不等于全购物篮覆盖。',
  scope:'2001 年二月已完成的测试回放；测试已参与后续反馈，不能重新当作未见测试。',
  needs:'稳定的顾客与商品编码、交易日期；复购需要已有购买记录。可售推荐还需要库存与商品状态。',
  delivery:'候选生成、排序与规则回退；同人群基线报告、候选覆盖和新老客诊断。',
  limit:'本例缺少曝光和未购买反馈，无法证明转化提升；商品名称展示也不代表模型使用文本特征。',
  evidenceTargets:['完整测试人群的模型比较','老客复购'],
 },
 'recommend:dressipi':{
  name:'Dressipi 会话商品推荐',input:'购买前的浏览顺序与匿名商品属性',output:'本次会话的商品候选与排序列表',
  verdict:'加入属性改善了固定候选内的前十命中；候选外目标仍无法靠排序找回。',
  evidence:'比较行为规则与学习排序，再看固定候选下的属性消融。区分未召回、未进前 100 和前 10 外，保留没有改善的特征组合。',
  scope:'已知公开数据的开发验证；展示样本不代表全体验证会话。研究实验展示，不是官方成绩。',
  needs:'完整浏览会话、购买标签、跨商品一致的属性编码，并确认这些字段在推荐时可得。',
  delivery:'多路候选、属性匹配、学习排序、固定候选消融与冷商品分组诊断。',
  limit:'排序无法补回候选外的目标；属性对每个失败组的独立增益尚未验证，新目录效果需要另测。',
  evidenceTargets:['首轮模型对比','完整模型：召回与排序阶段分解'],research:true,
 },
 'forecast:m5':{
  name:'M5 商品销量预测',input:'商品历史销量、商品结构、提前已知的日历与价格',output:'未来 28 天商品日预测及门店、品类汇总',
  verdict:'复杂模型并非每项指标都胜出；中位数基线领先的结果仍保留。',
  evidence:'同时比较层级误差、商品日误差和总量偏差。检查各窗口与困难商品；中位数基线占优的指标仍保留。',
  scope:'CA_1 单门店缩减实现；保留窗口已使用，区间证据只覆盖已评估的开发范围。研究实验展示。',
  needs:'连续商品日销量、稳定编码，以及预测时已经确定的未来价格与活动计划。',
  delivery:'特征时点审计、滚动预测、分层与分组评价，以及有对应证据范围的区间评估。',
  limit:'不是完整冠军模型或排行榜复现；没有受控特征消融，不能将总增益归给价格或日历。历史销量可能受缺货影响。',
  evidenceTargets:['当前窗口的完整指标','各窗口模型对比'],research:true,
 },
 'forecast:uci':{
  name:'UCI 周销量预测',input:'预测起点前的商品销量历史',output:'未来七天总销量，另保留独立的 28 天逐日实验',
  verdict:'LightGBM 的周总量误差低于最强简单基线，但未通过预设增益筛选。',
  evidence:'周预测比较误差、偏差与逐窗变化；后八窗口补充参考区间的覆盖、宽度及越界诊断。逐日实验只有三个起点，区间证据仍不足。',
  scope:'已有多轮反馈的 UCI 开发回放，周任务为 12 商品 × 12 起点；不是新的独立测试。',
  needs:'商品、交易日期、销量及取消退货口径；需求预测还需确认缺货、促销与营业状态。',
  delivery:'强基线与模型比较、时间边界审计、逐商品误差及区间诊断、批量预测。',
  limit:'预测量不是订货量；周总量没有逐日分配或区间保证。经营补货需要额外库存、提前期和成本信息。',
  evidenceTargets:['07 / 独立任务：7 天总销量','相同 144 个商品周上的比较'],
 },
 'forecast:tafeng':{
  name:'Ta Feng 七日销量预测',input:'周起点前已结束的销量记录',output:'固定商品接下来七天的总销量',
  verdict:'LightGBM 未通过预设筛选；上周销量在本次测试中仍是更强的简单基线。',
  evidence:'同时看全部商品周的 WAPE、总量偏差和胜出周数，保留模型未通过增益筛选的结果。',
  scope:'二月四个起点、固定 50 商品的已完成测试；后续反馈不能变成新的独立验证。',
  needs:'连续商品销量和一致的时间口径；预测目标是记录销量，促销和库存状态在本例中未知。',
  delivery:'历史特征、时间切分、强基线对照、误差分解与固定批量输出。',
  limit:'低 WAPE 不等于高准确率或更少缺货，零销量与总量偏差需要同时检查。',
  evidenceTargets:['七天销量','全部 200 个商品周的比较'],
 },
 'recommend:uci':{
  name:'UCI 推荐与特征实验',input:'推荐时点前的交易行为与方法实际使用的商品特征',output:'带回退规则的商品排序与历史样本回放',
  verdict:'不同方法在复购、新商品与目录覆盖上的取舍不同，复杂模型并非普遍占优。',
  evidence:'比较同顾客、同候选规则下的方法；再检查复购与新商品的分组差异，避免将复购优势写成发现能力。',
  scope:'经过多轮选模和调参的历史开发验证；展示顾客与完整评估人群分开。',
  needs:'稳定交易和商品编码；需要属性的方法还要有推荐前已知且可对齐的属性。',
  delivery:'推荐候选、模型排序、经营规则回退、特征实验及人群诊断。',
  limit:'交互没有曝光与实验分流，离线命中不能换算成交额；复杂模型并非必然优于个人复购。',
  evidenceTargets:['05 / 推荐误差与人群分析','01 / 推荐模型对比'],
 },
 'classify:spambase':{
  name:'垃圾邮件识别与复核评分',input:'邮件词频、字符频率与大写统计特征',output:'风险分数和给定阈值或名额下的复核判定',
  verdict:'留出集冻结阈值下，LightGBM 比逻辑回归少漏 29 条、少误标 2 条，增加 27 条待复核。',
  evidence:'比较规则、逻辑回归和 LightGBM 的识别与复核量，再切换相同复核名额。单条样本展示主要特征贡献；纠正与新增错误均保留。',
  scope:'分组切分的历史数据留出结果；留出已使用，阈值交互只是已知结果回放。没有邮件原文。',
  needs:'在判定时可用的特征、明确标签、误标与漏判代价，以及复核容量。',
  delivery:'规则与模型比较、阈值与名额选择、逐样本评分解释、错误迁移、校准评价及复核清单原型。',
  limit:'旧邮件特征不能代表现代邮箱；概率校准不保证改善，也未验证实际人工复核成本。',
  evidenceTargets:['识别改善与新增错误','同一分区的模型比较'],
 },
 'retrieve:scifact':{
  name:'科学文献检索与相关性排序',input:'科学查询与候选文献的标题、摘要',output:'按相关性排列的文献及召回、重排位置',
  verdict:'重排的整体排序增益很小，计算耗时明显增加；未召回文献无法被重排挽回。',
  evidence:'比较同查询的关键词、语义和重排结果，再看全部查询的收益、遗漏与计算成本。未标注不等于不相关。',
  scope:'全部 300 条已知公开查询，预训练模型本地推理；没有本地微调，无法排除预训练重叠。',
  needs:'可检索文本、目标领域查询与相关性评价，明确检索深度和响应时间要求。',
  delivery:'文档索引、混合召回、重排与阶段诊断；按查询分组核对效果和计算代价。',
  limit:'候选外文献无法靠重排找回；相关性排序不是事实核查或自动生成结论。新领域需独立验证。',
  evidenceTargets:['哪些查询受益，哪些查询退步','全部 300 条查询的离线评估'],
 },
 'anomaly:nab':{
  name:'设备监控与异常告警',input:'按时间到达的单变量监控观测与过去窗口',output:'异常分数、阈值触发和冷却后的告警',
  verdict:'三条序列没有同一个全面占优的方法；减少告警也可能漏掉事件。',
  evidence:'对齐同一事件的多方法告警，分开首次发现、重复告警、窗口外告警及漏检；降低告警数也可能丢失事件。',
  scope:'NAB 三条已知公开序列，固定校准阈值；采用本站事件与告警指标，不是官方全套评分。',
  needs:'时间戳和采样频率、已知正常校准段，以及事件定义和可承受告警负担。',
  delivery:'时序特征、分数与阈值、冷却策略、事件回放及误报漏报核算。',
  limit:'标注窗口首报不是故障发生延迟；异常分数不能诊断根因，仍缺真实处置与新设备验证。',
  evidenceTargets:['默认策略的告警负担与漏检拆解','固定阈值与 60 分钟冷却的评估'],
 },
 'segments:retail':{
  name:'零售顾客分群与行为画像',input:'观察时点前 180 天的购买间隔、订单数与正向金额',output:'规则组、模型群以及群体画像与跨月迁移',
  verdict:'两种分群能给出不同画像与迁移诊断，但没有证明营销收益。',
  evidence:'先看同顾客的两种归组，再分开看重拟合稳定性与跨月行为变化。群编号不是等级，轮廓分数不是准确率。',
  scope:'UCI 两期历史快照与初始样本重拟合；后续消费只作描述，没有营销干预对照。',
  needs:'稳定顾客编码、交易口径与观察周期；运营行动还需结合商品、利润和触达条件。',
  delivery:'RFM 特征、规则与聚类画像、距离拆解、群体稳定性与迁移分析。',
  limit:'分成不同人群不自动带来收益；人群行动是待验证假设，离开观察人群不等于永久流失。',
  evidenceTargets:['重拟合稳定与跨月变化分别评价','同一批顾客在两种方法中的分布'],
 },
 'decision:retail':{
  name:'有限预算下的多商品补货',input:'七日需求预测、假设库存与成本、预算和库容',output:'满足资源与整包约束的补货清单',
  verdict:'场景目标成本改善，事后模拟成本却退步；需求与成本假设决定取舍。',
  evidence:'固定策略比较预测、固定预测比较策略，再拆分采购、持有和缺货费用。默认优化的场景目标改善，事后模拟成本却退步。',
  scope:'12 商品 × 12 独立七日窗口的已知开发回放；每窗重置库存，成本为假设，不是真实利润。',
  needs:'真实库存与在途、采购和持有成本、缺货代价、包装尺寸与供应提前期。',
  delivery:'预测到订单的转换、整数约束求解、策略对照、逐商品成本与资源敏感性诊断。',
  limit:'求解最优不保证未来收益；目前没有连续库存仿真、真实供应条件和独立经营验证。',
  evidenceTargets:['预测与策略的贡献对照','全部十二个窗口的模拟结果'],
 },
};
export function isPreferenceContext(page,params){return page==='segments'&&(params.has('basis')?params.get('basis')!=='rfm':!params.has('method'));}
export function caseReading(page,params){
 const original=CASE_READINGS[`${page}:${params.get('case')}`];
 if(original&&page==='retrieve'&&params.get('view')==='costs')return {...original,name:'检索效果与端到端成本',verdict:'前 50 重排提高了整体排序；全库扫描相对前 50 重排更慢，整体排名质量反而下降。',evidence:'同机比较关键词、混合召回、前 50／100 多向量重排与全库精确扫描；保留池外找回、丢失目标和退步查询。',scope:'全部 300 条已知英文基准查询、5,183 文献；预热 CPU 完整串行流水线，不含网络和并发，不是服务 SLA。',delivery:'候选遗漏审计、文本覆盖对照、索引准备及查询成本评估。',limit:'没有压缩 ANN、并发、更新或百万文库验证；检索质量不是用户节省时间或实际财务收益。',evidenceTargets:['完整检索效果与成本','增益是否值得增加搜索范围']};
 if(original&&page==='classify'&&params.get('view')==='inputs')return {...original,name:'分类输入价值与采用条件',verdict:'词频有较明确的历史排序增量；完整输入并不在所有复核队列上更好。',evidence:'五组输入分别训练逻辑回归与 LightGBM，固定预算；比较同名额得失、排序和概率误差，全部实验臂保留。',scope:'429 条已知开发验证记录，不读取原留出；阈值在校准分区冻结，不能与旧留出成绩混合。',delivery:'特征组消融、强基线对照、输入质量审计及采用条件分析。',limit:'没有输入采集成本、原始正文、时间和发件人，尚未验证现代邮箱迁移；不是因果分析。',evidenceTargets:['同一复核名额下的输入与模型增量','排序增量与概率可靠性']};
 if(original&&page==='anomaly'&&isCrossContext(params))return {...original,name:'跨序列异常发现与告警负担',input:'五类单变量信号的当前观测与过去历史',output:'固定阈值、处理额度下的告警与事件记录',verdict:'43 条新序列中，Isolation Forest 减少窗口外告警，但漏检多于固定规则。',evidence:'相同处理上限比较额外发现、丢失事件、重复与窗口外告警；统一额度不等于实际告警次数相同。',scope:'43 条序列、78 个评估事件，旧三条五事件单独保留；已知公开基准，不是独立新系统验证。',limit:'标注窗口不等于确认故障，窗口外告警未经人工确认为误报；没有多变量诊断和真实处置证据。',evidenceTargets:['同等处理额度下的发现能力','阈值校准与实际处理负担']};
 if(original&&page==='retrieve'&&params.get('experiment')==='colbert')return {...original,
  verdict:'全块 ColBERT 在同文本、同候选比较中提高了平均排名质量，仍有退步查询。',
  evidence:'同文本比较模型，同模型比较首块与全块；并列查询质量、离线编码、缓存存储和重排耗时。候选池不变，不代表召回能力提高。',
  scope:'300 条已知英文基准查询的开发重排；未本地微调，不能排除预训练重叠。',
  limit:'仅重排原混合候选前 50；不证明全库多向量召回、中文迁移、并发或客户收益。',
  evidenceTargets:['长摘要重排：ColBERT 与交叉编码器'],
 };
 if(!original||!isPreferenceContext(page,params))return original;
 return {...original,input:'前 180 天的顾客商品购买记录',output:'商品偏好社群、代表商品、价值层交叉画像与稳定性诊断',
 verdict:'偏好四群补充商品区分，仍有价值层退步；核心群加热门回退对四群方案一升一降。',
 evidence:'按同一回访人群、原价值层比较商品重合增量；再看核心群覆盖与全量热门回退、抽样稳定性和新客分配缺口。后续重合不是营销效果，轮廓分数不是准确率。',
 scope:'两期已知公开数据上的开发实验；后续 30 天购买只作偏好延续诊断，不是独立测试或营销收益。',
 delivery:'购买偏好编码、Leiden 社群、HDBSCAN 密度群、同特征方法对照、逐顾客关系解释与稳定性诊断。',
 evidenceTargets:['分群方案的增量与覆盖','同一价值层内，偏好信息增加了什么']};
}
export function caseExercise(page,params){
 const original=CASE_EXERCISES[`${page}:${params.get('case')}`];
 if(page==='retrieve'&&params.get('view')==='costs')return {...original,metric:'候选外找回与完整流水线成本',recipe:'核对同一查询的相关文献在原候选、两侧前十／前百中的去向；完整耗时先逐查询测量，再求分位数，不相加组件 P95。',failure:'扩大搜索空间会引入新的竞争文献；全库打分不保证前十找回，离线完整流水线也不包含网络和排队。',anchor:null};
 if(page==='classify'&&params.get('view')==='inputs')return {...original,metric:'特征组消融与同名额得失',recipe:'同一批记录分别删除输入组、重新训练，比较新找回与丢失的垃圾邮件；其差等于净找回增量。AP 评价整个排序，不等于前若干名的发现量。',failure:'相关输入可能互相替代；已知开发样本、删减输入重合和名额上限限制结论，不能推断实际采集成本收益。',anchor:null};
 if(page==='anomaly'&&isCrossContext(params))return {...original,metric:'校准阈值、处理额度与逐事件漏检',recipe:'比较同阈值有无处理上限的告警；展开逐点记录，区分未超阈值、冷却和额度抑制。',failure:'过去校准无法保证未来告警负担；额度满时可能漏掉后续事件。',anchor:null};
 return isPreferenceContext(page,params)?{...original,metric:'顾客偏好、归属依据与群体商品占比',recipe:'核对购买记录到偏好编码、图邻居或中心距离，再查看群内购买人数占比；每种方法使用自己的归属依据。',failure:'近邻图变化、降维信息损失与大量未归群会影响解释；局部连接强度不是正确率。',anchor:null}:original;
}
export const READING_STEPS={example:{view:'experience',label:'1 · 看输入与结果'},evidence:{view:'report',label:'2 · 看效果与代价'},fit:{view:'data',label:'3 · 看适用与交付'}};
export function readingHref(page,params,step){
 const q=new URLSearchParams(params);q.set('view',page==='retrieve'&&params.get('view')==='costs'?'costs':page==='classify'&&params.get('view')==='inputs'?'inputs':READING_STEPS[step].view);q.set('walk',step);q.delete('item');
 return `#${page}?${q}`;
}
export function readingHtml(page,params){
 const key=`${page}:${params.get('case')}`,c=caseReading(page,params);if(!c)return '';
 const exercise=caseExercise(page,params),publicPath=publicCasePath(key);
 const lessonHref=exerciseHref(page,params);const focusedLesson=lessonHref?.startsWith('#learn?')?`${lessonHref}&focus=calculation`:lessonHref;
 const step=Object.hasOwn(READING_STEPS,params.get('walk'))?params.get('walk'):null;
 return `<section class="case-reading" aria-label="${esc(c.name)}案例结论"><div class="reading-summary"><div class="reading-intro"><strong>${esc(c.name)}</strong><p>${esc(c.input)} → ${esc(c.output)}。</p></div><div class="reading-conclusion"><span>${c.research?'本地研究结论':'固定评估结论'}</span><strong>${esc(c.verdict)}</strong><p>${esc(c.scope)}${c.research?' 研究实验展示；原始数据使用范围以数据提供方条款为准，本站不授予数据再分发或商业使用许可。':''}</p></div></div><ol class="reading-steps">${Object.entries(READING_STEPS).map(([key,v])=>`<li><a data-reading-step="${key}" href="${esc(readingHref(page,params,key))}" ${step===key?'aria-current="step"':''}>${v.label}</a></li>`).join('')}</ol>${publicPath?`<nav class="reading-study-links" aria-label="本案例方法与计算"><span>继续了解本例</span><a data-reading-method href="${esc(caseMethodHref(page,params))}">查看建模方法</a><a data-reading-study href="${esc(focusedLesson)}">查看逐项计算</a></nav>`:''}<details class="reading-context"><summary>对照方法与证据范围</summary><p>${esc(c.evidence)}</p><p>上方是固定报告的结论摘要；切换下方样本、模型或规则时，以对应的页面结果和完整报告为准。</p></details><details class="reading-fit" ${step==='fit'?'open':''}><summary>适用条件与可委托范围</summary><dl><div><dt>所需条件</dt><dd>${esc(c.needs)}</dd></div><div><dt>已展示的能力</dt><dd>${esc(c.delivery)}</dd></div><div><dt>尚未证明</dt><dd>${esc(c.limit)}</dd></div></dl><p>以上能力可用于讨论定制范围；新业务的效果、接口与验收要求需另行约定。本站目前仅展示公开案例，没有接入客户数据。</p><a href="#delivery">查看定制服务与交付范围</a></details>${exercise?`<details class="reading-exercise"><summary>计算与实验阅读 · ${esc(exercise.metric)}</summary><p>${esc(exercise.recipe)}</p><p>失效条件：${esc(exercise.failure)}</p><a data-reading-calculation href="${esc(exerciseHref(page,params))}">打开真实记录与计算明细</a><p class="reading-scope">使用已有结果，不重新训练或选择最优样本；实验范围、输入版本及参数见原页面与报告记录。</p></details>`:''}</section>`;
}
export function canShowReading(host){
 return !/暂不可用|暂未就绪|案例不存在|正在读取|当前构建未包含/.test([...host.querySelectorAll('h1,h2,.loading-copy,.report-panel>p')].map(e=>e.textContent).join(' '));
}
export function mountCaseReading(host,page,params,{navigate=true}={}){
 const c=caseReading(page,params);if(!c||!canShowReading(host))return;
 const expanded=host.querySelector('.case-reading-disclosure')?.open;
 host.querySelector('.case-reading-disclosure')?.remove();
 host.querySelector('.reading-entry')?.remove();
 const body=host.querySelector('#case-content'),heading=host.querySelector('.page-heading,.m5-heading');
 if(!heading)return;
 const html=`<details class="case-reading-disclosure" ${expanded?'open':''}><summary>案例说明、评估结论与适用条件</summary>${readingHtml(page,params)}</details>`;
 const footer=(body||host).querySelector('.showcase-source');
 if(footer)footer.insertAdjacentHTML('beforebegin',html);else (body||host).insertAdjacentHTML('beforeend',html);
 heading.insertAdjacentHTML('afterend','<div class="reading-entry"><button class="text-link" type="button">查看案例说明与评估范围 ↓</button></div>');
 host.querySelector('.reading-entry button').onclick=()=>{const panel=host.querySelector('.case-reading-disclosure');panel.open=true;const summary=panel.querySelector('summary');summary.focus({preventScroll:true});summary.scrollIntoView({block:'start'});};
 const guide=host.querySelector('.case-reading');
 // Refresh from the current route because controls may have changed the saved selection.
 guide.querySelectorAll('[data-reading-step]').forEach(a=>a.onclick=()=>{const live=new URLSearchParams(location.hash.split('?')[1]||'');a.href=readingHref(page,live,a.dataset.readingStep);});
 guide.querySelector('[data-reading-method]')?.addEventListener('click',e=>{e.currentTarget.href=caseMethodHref(page,new URLSearchParams(location.hash.split('?')[1]||''));});
 guide.querySelector('[data-reading-calculation]')?.addEventListener('click',e=>{e.currentTarget.href=exerciseHref(page,new URLSearchParams(location.hash.split('?')[1]||''));});
 guide.querySelector('[data-reading-study]')?.addEventListener('click',e=>{const href=exerciseHref(page,new URLSearchParams(location.hash.split('?')[1]||''));e.currentTarget.href=href?.startsWith('#learn?')?`${href}&focus=calculation`:href;});
 const walk=navigate?params.get('walk'):null;let target;
 if(walk==='fit')target=guide.querySelector('.reading-fit');
 else if(walk==='evidence')target=[...host.querySelectorAll('h2')].find(h=>c.evidenceTargets.includes(h.textContent.trim()));
 else if(walk==='calculation'){const exercise=CASE_EXERCISES[`${page}:${params.get('case')}`];target=exercise?.anchor?host.querySelector(`[data-calculation="${exercise.anchor}"]`):null;if(target)target.parentElement.open=true;}
 else if(walk==='example')target=(body||host).querySelector('h1');
 if(target){const live=new URLSearchParams(location.hash.split('?')[1]||'');live.set('walk',walk);saveSelection(page,Object.fromEntries(live));for(let el=target.parentElement;el&&el!==host;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
}

export function deliveryCaseLinks(){
 return `<section class="delivery-evidence" id="delivery-cases"><h2>七类业务的案例与交付能力</h2><p>先按业务场景判断是否相关，再查看公开案例中实际完成的方法和证据。新业务的数据、效果与验收要求需另定，不将公开案例成绩作为收益承诺。</p><div class="delivery-case-list">${PUBLIC_CASE_PATHS.map(item=>{const [page,id]=item.key.split(':'),c=CASE_READINGS[item.key];return `<article><span class="delivery-case-type">${esc(item.title)} · ${esc(item.caseName)}</span><h3>${esc(item.scene)}</h3><dl><div><dt>要做的判断</dt><dd>${esc(item.decision)}</dd></div><div><dt>展示交付</dt><dd>${esc(c.delivery)}</dd></div></dl><p class="small-note">证据边界：${esc(c.limit)}</p><a href="${esc(readingHref(page,new URLSearchParams({case:id}),'fit'))}">查看案例条件与证据</a></article>`;}).join('')}</div></section>`;
}
