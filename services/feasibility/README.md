# 模型升级适配审查

本目录只审查数据与运行成本，不训练 SASRec、不微调 ColBERT、不改写已有模型成绩。详细决策见 `docs/case-depth-plan.md` 的第二轮。

## 推荐序列

`uv run python services/feasibility/sequence_audit.py` 生成 `docs/evaluation/sequence-readiness-v1.json`，只含聚合统计与源文件哈希。

UCI 使用已校验清洗缓存；Ta Feng 通过 `load_development`，不解析封存的二月购买标签。每个顾客同一时间的不同商品作为无序集合；不以商品编号创造先后。时间戳篮子与保守的购物日长度同时报告。统计阈值 2／3／5／10／20 用于描述，非“适合深度模型”的通用合格线。历史重复商品占比的分母为相邻历史篮子目标商品数，不是未来测试 Recall。

## ColBERT 运行原型

环境复用锁定的 `services/retrieval/uv.lock`：`uv sync --project services/retrieval`。首次从官方仓库缓存固定模型（约 418 MiB safetensors），在该环境执行：

```python
from huggingface_hub import snapshot_download
snapshot_download('colbert-ir/colbertv2.0', revision='c1e84128e85ef755c096a95bdb06b47793b13acf', allow_patterns=['*.json','*.txt','README.md','model.safetensors','artifact.metadata'])
```

运行 `uv run --project services/retrieval python services/feasibility/colbert_probe.py`。协议在 `colbert-protocol.json`；所有模型权重严格加载，缺失参数直接失败。输出聚合审查到 `docs/evaluation/colbert-feasibility-v1.json`，具体样本与 token 匹配保存于忽略 Git 的 `artifacts/feasibility/colbert-probe-v1.json`。样本按 ID 哈希选取，没有按相关性选文献。未来重复执行会更新成本测量，不更新任何正式检索成绩；原测量可从 Git 追溯。

本地实现使用官方 ColBERTv2 BERT 和 128 维投影权重，复现 token 标记、查询 MASK 扩展、标点屏蔽、归一化与 MaxSim 的基本语义。没有安装或验收官方 PLAID 引擎、残差压缩索引与增量索引。尚未完成官方引擎逐分数一致性对照，不能称完整官方复现。查询特殊 token 与 MASK 仍参与得分；逐 token 匹配是模型相似度分解，不是事实证据、因果解释或相关性概率。

CPU 用 4 线程，文献编码 batch=4；小样本计时不含权重加载与下载。50 文献匹配计时仅用于已缓存向量的候选评分，不包括召回与文献编码，不是端到端延迟。全库向量占用按全部文献实际保留 token 数估计，仅向量负载，不含索引辅助结构；float16 为存储假设，本轮计算 float32。线性编码时间外推不是实测全库耗时。

## 来源与许可

- [SASRec 原作者实现](https://github.com/kang205/SASRec)：Apache-2.0；原版输入是有序单商品交互，下一购物篮改造需明确命名，不能冒充原版复现。
- [ColBERT 官方项目](https://github.com/stanford-futuredata/ColBERT)、[模型卡](https://huggingface.co/colbert-ir/colbertv2.0)、[固定版本配置](https://huggingface.co/colbert-ir/colbertv2.0/blob/c1e84128e85ef755c096a95bdb06b47793b13acf/artifact.metadata)：项目 MIT、权重模型卡声明 MIT；预训练来源为 MS MARCO，非本地 SciFact 微调。权重下载在本机缓存，不进入网页发布包。若未来再分发权重／官方代码，随包保留其许可与署名。
- 数据沿用 UCI／Ta Feng／SciFact 原案例来源与边界；ColBERT 预训练与公开基准重叠无法排除，数据的许可不因模型 MIT 自动改变。审查没有读取新的相关性标签。

检查：根目录 Python 测试包含序列统计边界；`uv run --project services/retrieval python -m unittest discover -s services/feasibility -p test_colbert_probe.py -v` 核查 MaxSim 求和、置换不变性与负相似度。小样本全分数等于各 query token 最大匹配之和也在运行时核对。
