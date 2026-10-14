// Explanations match the saved UCI implementations, not hypothetical algorithms.
const common={group:'uci',caseId:'uci',task:'next_basket',output:'下一购买时点商品的 Top 10 排序；正式评估允许复购、无探索。'};
export const UCI_RECOMMENDATION_GUIDE=[
 {...common,id:'uci-popular',title:'热门商品',kind:'非个性化基线',variants:[{model:'popular',label:'热门商品'}],input:'预测时点前的商品购买者人数。',process:'按历史购买人数排序；无需个人历史。',features:'商品热度；不使用商品名称或类别。',use:'建立低成本基线，并为没有购买历史的顾客提供回退。',example:'不同顾客在相同排除规则下看到同一热门顺序；这是对照，不是个性化效果。',limit:'容易集中在热门商品，不能识别个人复购习惯；新上架且无交互商品没有专门机制。'},
 {...common,id:'uci-personal',title:'个人购买习惯基线',kind:'行为规则',variants:[
  {model:'personal_frequency',label:'个人高频复购',process:'同顾客、商品、订单先去重，再按不同购买订单数排序。'},
  {model:'personal_recent',label:'个人最近购买',process:'按 1 / (1 + 距最近购买天数) 计分，近期商品得分更高。'},
  {model:'personal_decay',label:'近期加权复购',process:'每次购买贡献 exp(−距起点天数 / 90)，同商品累加；兼顾频次与近期性。'}],input:'顾客、商品、历史订单及购买时间；仅使用起点前事件。',process:'从个人购买历史构造排序分数。',features:'购买订单数、最近购买间隔、时间衰减。',use:'检验复购习惯本身能解释多少下一单需求，再判断是否需要学习群体关系。',example:'经常买但很久没买的商品，在高频和衰减规则下可能排在不同位置。',limit:'不能从个人历史学习未购商品偏好；零分商品可按热度补位，新顾客热门回退。'},
 {...common,id:'uci-neighbors',title:'共购相似与最近一单',kind:'协同过滤',variants:[
  {model:'itemcf',label:'ItemCF',process:'以全部历史商品为种子，累加共购相似邻居的分数。'},
  {model:'basket',label:'最近一单搭配',process:'使用同一个 ItemCF 相似度矩阵，只以最近一单的商品作为种子。'}],input:'二元顾客—商品购买关系；最近一单方法另读取订单时间。',process:'共购余弦相似度加入支持度收缩，再汇总相似邻居。',features:'共同购买者、商品支持度、历史或最近购物篮。',use:'比较长期偏好与最近购物意图是否适合当前任务。',example:'两种方法的差别是种子历史范围，不是训练了两套不同的语义模型。',limit:'共同购买不等于商品功能相似；稀有商品共购不足，且订单时间不能证明真实购买意图。'},
 {...common,id:'uci-als',title:'ALS',kind:'隐式反馈矩阵分解',variants:[{model:'als',label:'ALS'}],input:'历史顾客—商品购买矩阵与隐式反馈置信权重。',process:'交替学习 64 维顾客和商品向量；保存参数为正则 0.1、30 次迭代，按向量内积排序。',features:'购买关系；没有商品文本、价格或类别输入。',use:'从群体交互中学习潜在偏好，与个人复购规则接受同范围比较。',example:'潜在向量可以连接没有直接共购的商品，但效果必须通过后续购物篮评分验证。',limit:'潜在维度不能解释为具体商品属性；冷启动依赖热门回退，训练更复杂不保证超越个人规则。'},
 {...common,id:'uci-hybrid',title:'ALS＋复购融合',kind:'信号融合',variants:[{model:'hybrid',label:'ALS＋复购融合'}],input:'ALS 分数与 90 天衰减个人购买分数。',process:'ALS 负分截为 0，两路分别按各自最大值归一化，再以 25% ALS＋75% 衰减复购加权。',features:'群体购买关系与个人购买日期；不是增加了商品属性。',use:'检验在强个人基线上引入群体关系是否产生额外排序增益。',example:'权重由开发窗口比较后保存；25% 是融合权重，不是购买概率。',limit:'同一批窗口已参与选权重，成绩属于开发验证；不能当作独立测试或直接承诺转化提升。'},
];
