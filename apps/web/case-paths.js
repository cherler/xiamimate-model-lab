import {exerciseHref} from './case-exercises.js';

// Public cases only. Research previews have separate access and usage limits.
export const PUBLIC_CASE_PATHS=[
 {key:'recommend:tafeng',title:'商品推荐',caseName:'Ta Feng 购买行为',scene:'零售会员复购与商品发现',decision:'给一位顾客排出已购商品的复购顺序，并检验能否发现未购商品。',method:'个人复购规则对照 ALS 与衰减融合；未购商品发现单独评估。',methodHref:'#models?case=tafeng&task=repurchase&model=als_decay_25&focus=detail'},
 {key:'forecast:uci',title:'销量预测',caseName:'UCI 零售交易',scene:'多商品短期销量预估',decision:'估计每件商品未来七天的销售总量，供备货讨论使用。',method:'四周中位数对照 LightGBM，检查误差、偏差与逐窗口胜出。',methodHref:'#models?case=uci&task=weekly_sales&model=lightgbm&focus=detail'},
 {key:'classify:spambase',title:'分类与评分',caseName:'Spambase 邮件',scene:'待复核邮件筛选',decision:'在人工复核名额内找出更多垃圾邮件，同时控制正常邮件误标。',method:'固定规则对照逻辑回归与 LightGBM，分开看识别和误标。',methodHref:'#classify?case=spambase&view=models'},
 {key:'retrieve:scifact',title:'智能检索',caseName:'SciFact 文献',scene:'科研文献候选检索',decision:'按查询找出相关文献，并衡量排序质量与计算耗时。',method:'关键词、语义、融合与重排逐级比较，检查候选漏召回。',methodHref:'#retrieve?case=scifact&view=models'},
 {key:'anomaly:nab',title:'异常检测',caseName:'NAB 监控序列',scene:'设备监控告警',decision:'从连续观测中发出有限告警，兼顾事件发现与告警负担。',method:'固定阈值对照滚动统计、MAD 与孤立森林，检查冷却代价。',methodHref:'#anomaly?case=nab&view=models'},
 {key:'segments:retail',title:'零售分群',caseName:'UCI 零售顾客',scene:'会员运营分层',decision:'依据既有购买行为划分可描述的人群，并检查画像与跨月变化。',method:'RFM 规则对照 KMeans，查看标准化输入、中心与稳定性。',methodHref:'#segments?case=retail&view=models'},
 {key:'decision:retail',title:'决策优化',caseName:'UCI 零售补货模拟',scene:'预算与库容受限的补货',decision:'在整包、预算和库容约束下形成多商品补货清单。',method:'点预测规则对照场景优化，拆开预期目标与事后模拟成本。',methodHref:'#decision?case=retail&view=models'},
];

export function publicCasePath(key){return PUBLIC_CASE_PATHS.find(c=>c.key===key)||null;}
export function caseMethodHref(page,params){
 const id=params.get('case');
 const fallback=publicCasePath(`${page}:${id}`)?.methodHref;
 if(!fallback&&!['recommend','forecast'].includes(page))return null;
 const q=new URLSearchParams(params);
 q.delete('walk');q.delete('view');q.delete('topic');q.delete('lesson');
 if(['recommend','forecast'].includes(page)){
  if(!q.has('task'))q.set('task',page==='forecast'?'weekly_sales':id==='uci'?'next_basket':'repurchase');
  q.set('focus','detail');return `#models?${q}`;
 }
 q.set('view','models');return `#${page}?${q}`;
}
export function publicLessonHref(key){
 const [page,id]=key.split(':');
 const href=exerciseHref(page,new URLSearchParams({case:id}));
 return href?.startsWith('#learn?')?`${href}&focus=calculation`:href;
}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function casePathDirectory(mode){
 const teaching=mode==='teaching';
 const label=teaching?'七案例计算入口':'七案例方法入口';
 return `<section class="case-path-directory" aria-label="${label}"><div class="case-path-heading"><div><span class="guide-kicker">七类业务 · 公开案例</span><h2>${teaching?'从真实记录复算结果':'按业务问题查看方法'}</h2></div><p>${teaching?'每个入口打开该案例已保存的计算或实验记录。Ta Feng 提供完整指标课；其他案例在案例页查看逐项拆解。':'每个入口说明要做出的业务判断，方法页展示输入、基线、模型和适用条件。'}</p></div><ol class="case-path-list">${PUBLIC_CASE_PATHS.map((c,i)=>`<li id="case-path-${c.key.replace(':','-')}"><span class="case-path-index">${String(i+1).padStart(2,'0')}</span><div class="case-path-content"><strong>${esc(c.title)}</strong><span>${esc(c.scene)} · ${esc(c.caseName)}</span><p>${esc(teaching?c.method:c.decision)}</p></div><div class="case-path-actions"><a class="${teaching?'outline':'primary'}" href="${esc(c.methodHref)}">查看方法</a><a class="${teaching?'primary':'outline'}" href="${esc(publicLessonHref(c.key))}">查看计算</a></div></li>`).join('')}</ol></section>`;
}
