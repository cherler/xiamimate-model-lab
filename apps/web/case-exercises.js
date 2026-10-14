// Exercises point to existing frozen rows and calculations; no synthetic scores.
export const CASE_EXERCISES={
 'recommend:tafeng':{href:'#learn?lesson=recommend',metric:'Recall 与 NDCG',recipe:'在一位顾客的固定目标集合中数命中，再按名次折扣计算 DCG／IDCG；目标为空时 Recall 不定义。',failure:'解释为什么复购命中高，仍可能遗漏购物篮中的未购商品。'},
 'forecast:tafeng':{href:'#learn?lesson=forecast',metric:'WAPE 与总量偏差',recipe:'先将同一范围的绝对误差相加，再除以实际销量之和；带符号误差相加得到偏差，零总量时两项比例不定义。',failure:'解释为什么高估和低估会抵消偏差，却不会抵消 WAPE。'},
 'recommend:uci':{view:'report',target:'展开三个窗口的推荐成绩与冷启动分层',metric:'逐窗 Recall 与人群范围',recipe:'查看三个窗口的 Recall 与老客／新客分层；主指标先按窗统计再等权汇总，不能改成展示顾客的平均值。',failure:'解释为什么个人复购的改善不能证明新商品发现有效。'},
 'forecast:uci':{view:'experience',target:'逐窗口对照与计算方法',metric:'商品周绝对误差差',recipe:'逐行计算基线绝对误差减当前模型绝对误差，再对同一批商品周求和；负值表示当前误差更大。',failure:'解释为什么周总量改善不等于逐日尖峰预测改善。'},
 'recommend:dressipi':{view:'experience',target:'计算与解释边界',metric:'目标名次与倒数名次',recipe:'查看同会话目标在两方法前 100 中的位置，出现则 RR=1／名次，否则按当前截断范围记 0。前 10 展示不等于前 100 评价。',failure:'区分候选未召回与候选内排序靠后，说明增加排序特征能解决哪一层。'},
 'forecast:m5':{view:'experience',target:'查看逐日计算与解释边界',metric:'逐日绝对误差贡献',recipe:'将每天的基线绝对误差减模型绝对误差加总，核对四周贡献；汇总层级与单品层级分别计算。',failure:'解释为什么门店汇总改善不保证每个商品都改善，也不证明某类特征有效。'},
 'classify:spambase':{view:'experience',target:'冻结阈值对照与错误迁移计算',metric:'误标与漏判迁移',recipe:'当前误报 = 对照误报 − 纠正误报 + 新增误报；当前漏报同理。用同分区全量计数核对，不能只数筛选后的样本。',failure:'解释为什么找回更多垃圾邮件可能增加正常邮件的复核负担。'},
 'retrieve:scifact':{view:'experience',target:'查看原文词项、融合计算与截断范围',metric:'两路排名的融合分数',recipe:'同一文献在每路出现时贡献 1／(60＋名次)，未出现贡献 0；两路求和并核对保存的融合分数。',failure:'解释为什么进入前 100 但未进重排前 50 的文献不能靠本次重排挽回。'},
 'anomaly:nab':{view:'experience',target:'查看冷却抑制的代价与漏检原因',metric:'原始触发与发出告警',recipe:'核对原始触发 = 发出告警 + 冷却抑制；再区分首次、重复、窗口外告警和未发现的事件，不混用观测点与事件分母。',failure:'解释冷却为什么可能减少重复，也可能抑制一个新事件的首次告警。'},
 'segments:retail':{view:'experience',target:'查看标准化输入、各中心与逐维计算',metric:'最近与次近中心距离差',recipe:'对数及固定缩放后，分别计算 R、F、M 到两个中心的平方差；三维差之和应等于次近距离平方减最近距离平方。',failure:'解释距离小为什么不是高消费概率，以及跨月迁移为什么不等于训练不稳定。'},
 'decision:retail':{view:'experience',target:'查看成本差的计算与证据范围',metric:'逐商品模拟成本',recipe:'采购 = 包数×每包件数×采购价；再加持有与缺货惩罚。逐商品费用差加总，核对同条件两策略的总成本差。',failure:'解释优化目标更低但事后成本更高时，差异来自哪些费用和需求假设。'},
};
export function exerciseHref(page,params){
 const c=CASE_EXERCISES[`${page}:${params.get('case')}`];if(!c)return null;if(c.href)return c.href;
 const q=new URLSearchParams(params);q.set('view',c.view);q.set('walk','calculation');q.delete('item');return `#${page}?${q}`;
}
