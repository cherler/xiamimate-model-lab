# R4 智能检索与匹配：SciFact 文献检索

2026-10-14。目标是展示对同一批查询的关键词、语义向量、融合与重排能力，以及质量／计算成本取舍。页面使用已保存公开查询回放，不连接客户知识库。

## 来源与许可

- [SciFact 原项目](https://github.com/allenai/scifact)：Wadden et al., *Fact or Fiction: Verifying Scientific Claims*, EMNLP 2020。原项目 LICENSE 明确 claims 与 evidence annotations 为 CC BY 4.0；corpus abstracts 来自 S2ORC，ODC-By 1.0。
- [BEIR 分发](https://huggingface.co/datasets/BeIR/scifact)：Thakur et al., *BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models*, 2021；其数据卡标 CC BY-SA 4.0。保留原上游声明，本项目改编展示数据包按 CC BY-SA 4.0 提供，并附 ODC-By、CC BY 署名与来源。应用代码与数据分开，不扩大该许可到其他案例。
- 原 corpus 来源：Lo et al., *S2ORC: The Semantic Scholar Open Research Corpus*, 2020。抽取标题、摘要仍保留文档 ID、英文原文和来源查询链接；不伪造中文翻译或论文结论。
- 编码器 `sentence-transformers/all-MiniLM-L6-v2`、重排器 `cross-encoder/ms-marco-MiniLM-L6-v2` 模型卡均为 Apache-2.0，固定精确 revision；仅使用本地推理，不上传查询，不在此数据集微调。

## 冻结协议

`services/retrieval/protocol.json` 在评估前保存并提交。

- 全部 5,183 文档；BEIR test 的全部 300 查询。train qrels 不用于训练或选参。
- 构造标题＋摘要输入；BM25 不截断，ASCII 字母数字分词，无词干化或停用词移除，k1=1.2、b=0.75。与 Elasticsearch 等工具实现不同，不能直接拼接其成绩。
- 向量为 384 维归一化 float32，精确点积检索，最多 256 token。
- BM25 与 dense 各取前 100，等权 RRF，常数 60；按文档 ID 固定破同分。
- 重排只读取 RRF 前 50 个候选，query＋document 合计最多 256 token。保留 51～100 原始尾部；重排不增加候选，因此 Recall@50、@100 必须与 RRF 一致。
- 所有查询排名和逐阶段耗时保存后，才加载相关性标签评分。标签只用于 NDCG@10、Recall@10、MRR@10、Recall@50／100 和错误回放；不按结果挑查询或调整配置。
- 已知公开基准，预训练语料可能重叠，不能宣称全新独立测试或“从未见过这些论文”。相关性标签只表达文献检索关系，不证明主张为真；未标注文档按评估协议记 0，但页面称“未标注相关”，不推断绝对不相关。
- CPU 4 线程，批次32；模型先预热。每查询一次，BM25 分词与检索、dense 编码与搜索、融合、重排分开计时。hybrid／rerank 端到端耗时由所需阶段相加，记录 p50／p95，不作为并发服务 SLA。
- 分别记录原文、稀疏索引、词表、向量文件、模型文件的大小，建索引时间及进程峰值内存。不是仅用向量大小代表全部部署成本。

## 页面

沿用既有浅色设计和 frontend-design 规范：背景 #f6fafc，正文 #17324d，当前方案 #087f9d，对照 #af8038，边线 #dce7ee；现有系统字体，左对齐。主体为英文查询、并排结果列表、真实标题／摘要和相关标签；窄屏堆叠。内部页签为体验、数据、方法与索引、效果报告，不按四个模型拆主菜单。

体验支持筛选固定查询、当前与对照方法、K=5/10；展示两种排名变化、逐查询命中与未召回标注文献。报告保留全部查询均值、逐查询改善／退步、PR 相关指标、候选上限与真实耗时。空筛选、数据缺失、版本不一致必须明确显示，不生成假结果。

验收：指标可从保存列表复算；稳定同分和候选约束测试；资源哈希核验；现有 4 项项目检查；桌面与手机交互；功能完成分别提交 Git。暂不建设实时全文搜索服务或 RAG 答案生成。
