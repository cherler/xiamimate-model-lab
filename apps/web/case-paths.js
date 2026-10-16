import {sectionHref} from './navigation-state.js';
import {exerciseHref} from './case-exercises.js';

// Public cases only. Research previews have separate access and usage limits.
export const PUBLIC_CASE_PATHS=[
 {key:'recommend:tafeng',title:'商品推荐',caseName:'Ta Feng 购买行为',scene:'零售会员复购与商品发现',decision:'给一位顾客排出已购商品的复购顺序，并检验能否发现未购商品。',method:'个人复购规则对照 ALS 与衰减融合；未购商品发现单独评估。'},
 {key:'forecast:uci',title:'销量预测',caseName:'UCI 零售交易',scene:'多商品短期销量预估',decision:'估计每件商品未来七天的销售总量，供备货讨论使用。',method:'四周中位数对照 LightGBM，检查误差、偏差与逐窗口胜出。'},
 {key:'classify:spambase',title:'分类与评分',caseName:'Spambase 邮件',scene:'待复核邮件筛选',decision:'在人工复核名额内找出更多垃圾邮件，同时控制正常邮件误标。',method:'固定规则对照逻辑回归与 LightGBM，分开看识别和误标。'},
 {key:'retrieve:scifact',title:'智能检索',caseName:'SciFact 文献',scene:'科研文献候选检索',decision:'按查询找出相关文献，并衡量排序质量与计算耗时。',method:'关键词、语义、融合与重排逐级比较，检查候选漏召回。'},
 {key:'anomaly:nab',title:'异常检测',caseName:'NAB 监控序列',scene:'设备与业务信号异常告警',decision:'从连续观测中发出有限告警，兼顾事件发现与告警负担。',method:'固定规则、滚动 MAD 与孤立森林跨序列对照，检查冷却和处理额度下的漏检与负担。'},
 {key:'segments:retail',title:'零售分群',caseName:'UCI 零售顾客',scene:'会员运营分层',decision:'依据既有购买行为划分可描述的人群，并检查画像与跨月变化。',method:'RFM 规则对照 KMeans，查看标准化输入、中心与稳定性。'},
 {key:'decision:retail',title:'决策优化',caseName:'UCI 零售补货模拟',scene:'预算与库容受限的补货',decision:'在整包、预算和库容约束下形成多商品补货清单。',method:'点预测规则对照场景优化，拆开预期目标与事后模拟成本。'},
].map(c=>{const [page,id]=c.key.split(':');return {...c,methodHref:caseMethodHref(page,new URLSearchParams({case:id}))};});

export function publicCasePath(key){return PUBLIC_CASE_PATHS.find(c=>c.key===key)||null;}
export function caseMethodHref(page,params){
 const q=new URLSearchParams(params);
 if(!q.has('task')&&['recommend','forecast'].includes(page))q.set('task',page==='forecast'?'weekly_sales':q.get('case')==='uci'?'next_basket':'repurchase');
 return sectionHref('models',page,q);
}
export function publicLessonHref(key){
 const [page,id]=key.split(':');
 const href=exerciseHref(page,new URLSearchParams({case:id}));
 return href;
}
