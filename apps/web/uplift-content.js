export const UPLIFT_METHODS={
 s:{name:'S-Learner · LightGBM',status:'已运行',how:'把邮件动作作为输入，拟合一个响应模型；对同一顾客分别输入不发、男装邮件、女装邮件，比较预测结果。',use:'适合作为统一强基线；实现和部署简单。',risk:'如果动作信号弱，模型可能主要学习自然购买倾向，甚至忽略动作。',source:'https://www.pywhy.org/EconML/spec/estimation/metalearners.html'},
 t:{name:'T-Learner · LightGBM',status:'已运行',how:'为三个动作分别拟合响应模型，再计算两种邮件相对不发邮件的预测差。',use:'便于解释动作差异和响应概率；需要每个动作有足够样本。',risk:'不同模型的误差会相减；小组、低转化目标尤其不稳定。',source:'https://www.pywhy.org/EconML/spec/estimation/metalearners.html'},
 x:{name:'X-Learner · LightGBM',status:'已运行',how:'先拟合响应模型，构造未观测反事实的伪效应，再分别学习并加权。本例两种邮件分别对不发邮件，条件分配概率为 1/2。',use:'处理组与对照组规模不平衡时值得比较；属于 Meta-Learner 家族。',risk:'伪效应也有估计误差；不平衡并不保证 X-Learner 胜出。',source:'https://arxiv.org/abs/1706.03461'},
 r:{name:'R-Learner · LightGBM',status:'已运行',how:'三折交叉拟合结果均值，减去均值和已知动作概率，以加权残差损失拟合条件增量。',use:'直接学习效应，减少自然响应水平对增量学习的干扰。',risk:'低重叠会放大噪声；无法修复未记录混杂。本例是已知概率的随机分配。',source:'https://arxiv.org/abs/1712.04912'},
 linear_dml:{name:'线性 DML · 交叉拟合',status:'已运行',how:'与 R-Learner 共用折外结果残差和动作残差，最终用带交互项的线性残差回归估计异质效应。本站自实现，未声称调用完整 EconML。',use:'适合作为结构简洁的正交化对照；DML 是框架，最终模型不必是线性的。',risk:'线性效应假设限制复杂异质性；交叉拟合不等于消除了所有偏差或混杂。',source:'https://www.pywhy.org/EconML/spec/estimation/dml.html'},
 tarnet:{name:'TARNet',status:'规划 · 未运行',how:'共享特征表示，为处理与对照设置不同结果头，以观测结果训练后比较反事实预测。',use:'复杂非线性、多源特征、充足数据时作为深度因果基线。',risk:'共享表示不自动获得无混杂条件；两种结果头不提供真实个体因果标签。DeepCausal Network 在此作为深度因果模型方向。',source:'https://arxiv.org/abs/1606.03976'},
 dragonnet:{name:'Dragonnet',status:'规划 · 未运行',how:'在结果头之外学习动作分配概率，利用表示共享，并可引入 targeted regularization 校正目标估计。',use:'作为需要检查混杂控制、处理分配和效应估计的深度因果对照。',risk:'随机实验的分配概率已知，不应假设新增概率头必然更好；定向正则及倾向截断需单独消融，无法消除未测混杂。',source:'https://arxiv.org/abs/1906.02120'},
 descn:{name:'DESCN',status:'规划 · 未运行',how:'Deep Entire Space Cross Networks：ESN 联合建模处理概率与响应，X-network 引入中间伪处理效应，针对处理偏差与样本不平衡。',use:'后续结合作者的优惠券数据与实现核对结构、损失、消融和随机种子。',risk:'原论文主体为二元动作；网络多任务不等于多个营销目标已联合优化。不能保证深网超过树模型，也不能消除未测混杂。',source:'https://arxiv.org/abs/2207.09920'},
};
export const UPLIFT_SCENARIOS=[
 {name:'人群圈选',covered:'本例已验证建模与离线评估流程：同名额比较邮件增量与自然响应排序。',data:'干预前顾客快照、随机对照、动作分配概率、完整结果窗口。',method:'S/T/X、R-Learner、DML；后续因果森林或 DESCN。',evidence:'看相同预算的增量及成对区间，不能用高转化率替代增量。'},
 {name:'渠道择优',covered:'未验证。数据中的 channel 是历史购买渠道，不是本次触达动作。',data:'邮件／短信／Push／不触达的可达性、随机动作、实际成本。',method:'多动作 CATE＋预算和触达约束；保留不触达选项。',evidence:'对照最佳单渠道与随机匹配，评估净增量、覆盖、重叠与渠道成本。'},
 {name:'商品／优惠券／红包匹配',covered:'本例仅有两种邮件主题；没有 SKU、券面额或红包实验。',data:'当时可用候选、随机券额、实际核销补贴、毛利、资格、库存。',method:'候选召回后估计多动作或剂量响应，再优化净价值分配。',evidence:'增量毛利减实际补贴；点击、领券和核销是中间结果，不能直接证明增量。'},
 {name:'触达时机与频次',covered:'未验证。单次两周实验不能回答一天发几次或几点发送。',data:'多期用户状态、每次动作概率、间隔、疲劳／退订、延迟转化。',method:'微随机试验、序列因果模型，数据充分后考虑受约束离线策略学习。',evidence:'跨期累计增量与退订成本、持久随机留出、频控满足率。'},
 {name:'素材选择',covered:'主题层有部分覆盖，未验证文案、图片或新素材泛化。',data:'随机素材分配、版本、创意表征、相同预算、用户级重复曝光。',method:'内容表征＋多动作效应；有探索日志后考虑上下文 Bandit。',evidence:'看成交／收入增量而非单看点击；记录探索概率和延迟奖励。'},
 {name:'持续度量与多目标决策',covered:'本例分别预测访问、购买、销售额；尚未实现多目标联合最优或长期增量。',data:'持续对照、固定归因窗、毛利／成本、退订等负向目标、策略版本。',method:'分层 A/B，合适条件下用 IPW／DR 离线评估，预算约束和 Pareto 取舍。',evidence:'预设主目标与护栏；监测增量、区间、漂移，处理反复查看带来的多重检验。'},
];
