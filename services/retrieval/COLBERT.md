# ColBERT 同候选、同文本开发实验

运行 `colbert-20261014T124255210873Z`，协议 `colbert-study-protocol.json`。没有本地训练、微调、超参搜索或结果驱动的参数变更。沿用已看过的 SciFact 300 查询，只作已知基准开发比较，不作为独立测试。

## 可复核范围

- 原混合检索前 50 候选不变，51–100 原样保留。候选并集 4,639 篇，不是全库多向量召回。
- 标题＋摘要按最多 160 WordPiece、步长 128 分块，不限制块数，共 13,399 块。两模型读取同一原文子串；cross pair 不超过 256 tokens，ColBERT doc 上限 180。查询同取前 61 WordPiece，ColBERT 加标记成为 64 位置；查询长度并非原官方默认 32。
- 首块与全块最高分构成二乘二比较，区分模型与覆盖贡献。原交叉编码器成绩保留为不同输入策略的历史参考。
- 同词表不代表模型内部计算相同。ColBERT 文档离线编码；交叉编码器每次联合编码查询文档。耗时列不含原候选召回、加载／下载，也不含 ColBERT 的离线文档编码；均为一次预热后本机回放，不是 SLA。
- 每查询保留所有四种候选分数、排名、最高块索引；全块 ColBERT 前三篇保存完整词元 MaxSim 分解，含特殊标记和 MASK。匹配不是事实或因果证据。
- 官方代码固定至 `cc4f3dc91c0b45d2d08c251d9d95178285c65f1c`，核心 tokenizer／标记／mask／encoding／reduce 与本地适配逐项比较。没有官方 PLAID、压缩索引、全引擎一致性验收。

## 本次结果

| 同池方法 | NDCG@10 | Recall@10 | 重排中位 ms |
| --- | ---: | ---: | ---: |
| 交叉编码器首块 | 0.659829 | 0.804889 | 289.18 |
| ColBERT 首块 | 0.668928 | 0.787556 | 22.12 |
| 交叉编码器全块 | 0.695211 | 0.827611 | 809.57 |
| ColBERT 全块 | 0.718254 | 0.848222 | 24.92 |

全块模型差值 0.023043；查询 bootstrap 95% 区间 [0.004379, 0.041628]，2,000 次、种子 42。56 条改善、31 条退步、213 条持平。候选 Recall@50 所有方法均为 0.937，不产生召回增益。首块模型差区间跨零，且 ColBERT 首块 Recall 较低，不可称全面更优。

增加覆盖本身有贡献：ColBERT 全块相对首块 NDCG +0.049326，交叉编码器 +0.035382。最高块规则有长度偏置；多块候选占比 <80% 的查询仅 1 条，不足以判断短文表现。长查询 54 条，分组不等同于新领域证明。

4 CPU 线程，文档编码 364.35 秒，float32 向量负载约 804.58 MiB，文件约 812.95 MiB，进程峰值约 2.78 GiB。正式索引压缩、并发与端到端召回尚未评估。

## 复核与重新实验

先完成原 SciFact 数据和推理导出；依赖固定在 `uv.lock`。两套权重必须在 Hugging Face 缓存中，均使用协议／父协议固定 revision；不在网页下载模型。可用 `huggingface_hub.snapshot_download` 获取固定版本的官方模型，不能替换为最新 revision 后复用本次成绩。

```sh
uv sync --project services/retrieval --frozen
services/retrieval/.venv/bin/python -m services.retrieval.prepare_colbert_reference
services/retrieval/.venv/bin/python -m unittest discover -s services/retrieval/tests -v
services/retrieval/.venv/bin/python -m services.retrieval.verify_colbert_study
services/retrieval/.venv/bin/python -m services.retrieval.colbert_study export
```

`verify` 不重新排序／训练；核验冻结源、标签访问、逐项指标和配对区间，生成 `docs/evaluation/colbert-development-v1.json` 聚合记录。前端与构建另用独立 JavaScript 校验原候选／标签、排名、指标、解释、分组和成本。

需要重新实验时使用 `python -m services.retrieval.colbert_study`，产生新时间戳目录，不覆盖旧实验；新变更须另定协议与证据级别，不能把已知标签重新称为未见测试。

本次完整排名已冻结后，初次评分因父产物没有 `notice` 字段而失败。修正为父导出器的 `NOTICE` 常量，使用 `resume-score colbert-20261014T124255210873Z` 只重做后处理。保留原 label-access、冻结脚本快照及 `scoring-recovery.json`，记录修复原因、时间和新后处理源码哈希；没有删访问记录或重跑模型。

## 来源与许可

- [ColBERT 官方实现](https://github.com/stanford-futuredata/ColBERT/tree/cc4f3dc91c0b45d2d08c251d9d95178285c65f1c)，MIT；参考文件及 LICENSE 逐文件哈希固定。
- [ColBERTv2 权重](https://huggingface.co/colbert-ir/colbertv2.0/tree/c1e84128e85ef755c096a95bdb06b47793b13acf)，模型卡声明 MIT；不随网页分发权重。
- [交叉编码器](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2/tree/233902d25c440f23af6f7d6e94d2946bac0bee0a)，父实验固定权重。
- 数据保留 SciFact CC BY 4.0、S2ORC ODC-By、BEIR CC BY-SA 来源；新增改编数据仍按 CC BY-SA 4.0，完整署名及 ColBERT MIT 许可随结果包提供。
