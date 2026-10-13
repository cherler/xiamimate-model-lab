// Explanations for saved UCI experiments; this module does not train models.
const v=(model,label,process)=>({model,label,process});
const daily={group:'forecast',caseId:'uci',task:'daily_sales',output:'未来 28 天逐日销量（件／天）'};
const weekly={group:'forecast',caseId:'uci',task:'weekly_sales',output:'未来完整七天销量（件）'};
const history='截至当前起点的历史销量、预测步长、星期／月份与商品独热编码；不使用未来实际销量。';
export const FORECAST_GUIDE=[
 {...daily,id:'uci-daily-baselines',title:'逐日历史基线',kind:'销量参照',variants:[
 v('seasonal','上周同期','取预测起点前最后完整七天销量，按星期循环重复四次。'),
 v('weekday_mean','近四周同星期均值','对历史四个星期中相同星期几的销量取平均，重复预测未来四周。'),
 v('zero','全部预测为零','未来每天均预测为零；用于衡量模型是否比零预测更好。'),
 v('mean28','近28天日均值','以最近 28 天销量均值作为未来每天的预测。'),
 v('median28','近28天日中位数','以最近 28 天销量中位数作为未来每天的预测。'),
 v('weekday_median','近8周同星期中位数','对历史八周中相同星期几的销量取中位数，循环预测未来四周。')],input:'起点前最近 7、28 或 56 天的日销量；全零方法无需输入。',process:'根据所选方法复用历史水平或同星期规律。',use:'衡量销量的水平与星期规律本身有多少预测能力。',limit:'无法感知未提供的促销或库存；零销量多时中位数可能长期偏低。',features:'历史销量及目标星期；未使用商品属性。',example:'所有方法使用相同 12 件商品、三个窗口，共 1,008 个商品日，不能删除零销量或误差大的样本。'},
 {...daily,id:'uci-daily-ets',title:'AutoETS',kind:'统计时间序列',variants:[v('autoets','AutoETS','逐商品自动选择指数平滑结构，预测未来 28 天；季节周期设置为 7 天。')],input:'每件商品在预测起点之前的日销量序列。',use:'与同星期基线、线性模型及树模型比较。',limit:'拟合失败或超时会回退上周同期；报告保留回退次数。',features:'历史销量的水平、趋势与季节结构；没有商品属性输入。',example:'逐日预测与七天合计是不同任务，即使同名模型也必须分别评估。'},
 {...daily,id:'uci-daily-lgbm',title:'LightGBM · 逐日预测',kind:'梯度提升树',variants:[
 v('lightgbm','LightGBM · 原始特征 / Tweedie','在原始销量上比较 L2、Poisson、Tweedie 后，开发选择 Tweedie、31 叶子、200 棵树；使用基础历史特征。'),
 v('lgbm_history_l1','丰富历史 LightGBM · L1','在丰富历史特征上优化原始销量的绝对误差（L1）；强调绝对偏差，不能保证总量无偏。'),
 v('lgbm_history_l2','丰富历史 LightGBM · L2','在相同丰富历史特征上优化原始销量的平方误差（L2）；大误差的训练惩罚更重。'),
 v('lgbm_history_log','丰富历史 LightGBM · log-L2','在相同丰富历史特征上拟合 log1p 销量的平方误差，再以 expm1 反变换并裁为非负。')],input:history,process:'汇总多个商品的训练样本，逐步学习树模型；以预测步长作为输入直接预测各未来日。',use:'比较非线性特征关系，以及特征和目标函数对预测的影响。',limit:'这四种是同一树模型家族的不同实验，不是四种深度网络。最低 WAPE 的 L1 仍明显低估总量。',features:'基础：滞后 1／7／14／28 天、7／28／56 天均值、28 天波动、步长、日历和商品编码。丰富版本再加同星期均值／中位数、零销量比例、最大最小值及距正销量天数。',example:'L1、L2、log-L2 共享丰富特征，可比较目标函数；原版与丰富 L1 同时改变特征和目标，差值不能全部归因为特征。'},
 {...weekly,id:'uci-weekly-baselines',title:'周销量历史基线',kind:'销量参照',variants:[
 v('zero','全部预测为零','未来七天总量预测为零，作为统一误差参照。'),
 v('last_week','上周总销量','直接沿用预测起点前完整七天的销量总和。'),
 v('four_week_mean','近四周周均值','先将历史 28 天分成四个完整周，再取四个周总量的均值。'),
 v('four_week_median','近四周周中位数','先将历史 28 天分成四个完整周，再取四个周总量的中位数。')],input:'当前起点前四个完整周的销量。',use:'为每周更新的七天总销量建立有竞争力的比较对象。',limit:'不使用促销、价格或库存；不等于无约束需求预测。',features:'历史周销量；全零方法不需要销量特征。',example:'每周预测七天总量，不把日中位数乘以七冒充周中位数。'},
 {...weekly,id:'uci-weekly-ets',title:'AutoETS · 七天合计',kind:'统计时间序列',variants:[v('autoets','AutoETS · 7日合计','在各周起点用过去的日销量拟合指数平滑，预测七天后求和。')],input:'每件商品在各预测起点前的完整日销量历史。',use:'比较统计模型与直接预测周总量的树模型。',limit:'逐商品失败时回退上周总量并留存原因；没有经过校准的预测区间。',features:'日销量序列的时间结构，不读取商品属性。',example:'当前起点只能使用当时已发生的数据；12 个起点分别预测，合计 144 个商品周。'},
 {...weekly,id:'uci-weekly-lgbm',title:'LightGBM · 七天总量',kind:'梯度提升树',variants:[v('lightgbm','直接预测7日总量 · LightGBM','所有商品共用树模型，训练标签为未来完整七天合计；开发选择 L1、31 叶子，每周起点重新训练。')],input:'起点前至少 56 天的日销量、商品编码与日历。',use:'学习周销量水平、波动、近期趋势与商品差异之间的非线性关系。',limit:'本轮相对最强基线的增益不足预设门槛，未通过开发筛选；仍不是独立测试。',features:'过去四周总量、四周均值／中位数、八周均值／波动、近期日销量统计、零销量比例、短期趋势、月份／星期和商品独热编码。',example:'直接优化七天总量，与预测每天再求和是不同建模方式；评分时对同一批商品周比较。'},
];
