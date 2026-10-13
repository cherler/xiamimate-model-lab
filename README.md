# 模型工坊 · 推荐与预测

独立的公开数据案例项目，服务于定制开发展示与教学。前端、Python 服务、数据和训练产物均独立，没有接入虾米伙伴主站。

当前后续范围已明确为**模型能力与量化统计展示站**，暂不开发客户数据接入。上线缺口、展示架构、增值项和后续轮次见 [展示站上线规划](docs/launch-roadmap.md)。

历史第三轮：九种推荐策略、原 28 天逐日强基线、独立的 7 天总销量任务与误差诊断。实际结果见 [第三轮实验说明](docs/experiment-summary-v3.md)，任务边界见 [第三轮计划](docs/round3-plan.md)。[第二轮结果](docs/experiment-summary-v2.md) 与原产物保留。

Ta Feng 新案例已经按 [固定评估协议](docs/evaluation/evaluation-protocol.md) 完成训练、开发演练与单次 2 月测试，见 [最终实验报告](docs/tafeng-experiment-results.md)和[模型方法](docs/tafeng-model-methods.md)。复购融合 NDCG 从 0.17904 提升到 0.19067，通过预设增益筛选；新商品发现弱于 ItemCF，周度 LightGBM 低估约 46%，两项未通过。**Ta Feng 三项任务现已接入网页，作为默认案例；UCI 第三轮保留在案例选择中。**

## 进阶模型实验（2026-10-13）

已按顺序完成特征工程与 LightGBM LambdaRank、LightGCN（三个种子）和真实 TFT，均在本地 CPU 训练与评估。打开 `#advanced` 可切换模型、查看历史属性与真实样本、同范围指标、分位数区间及模型解读；`#advanced?task=forecast` 直达预测。本轮全部为 **UCI 测试后开发实验，非独立确认测试**，不能与旧案例直接计算增益。

完整特征排序 Recall@10 16.67%，同范围衰减基线 14.73%；LightGCN 10.56%–11.15%。TFT WAPE 85.84%，未超过八周同星期中位数 79.94%；P10–P90 实际覆盖 73.41%，低于名义 80%。保留失败，模型复杂度不代替效果证明。

```sh
uv sync --project services/advanced --python 3.12
npm run train:ranking
npm run train:graph
npm run train:tft
npm run export:advanced
npm run test:deep
```

已有完整产物时仅需导出；不要为补旧展示包重新训练 Ta Feng。新模型保存于独立 `artifacts/advanced-runs/`，新页面资源位于 `apps/web/advanced-results/`，二者均不入 Git。构建必须通过原展示包、进阶包、AutoML 调优包和模型选择包校验。详细协议、数据边界与复现说明见 [进阶实验说明](services/advanced/README.md)。未使用 AutoDL 或云端付费资源。

## 运行

需要 Node.js 22+、uv、Python 3.12。macOS 上 LightGBM 需要 OpenMP 运行库，可使用 `brew install libomp` 安装。

```sh
cd /Users/liuzhenhai/projects/xiamimate/xiamimate-model-lab
uv sync --python 3.12
npm run export:showcase
npm run dev
```

打开 <http://127.0.0.1:5328>。已有完整产物与展示包时可直接 `npm run dev`。`export:showcase` 需要本地固定 UCI 与 Ta Feng 产物，不会下载数据、训练或重新开启测试；缺少产物时明确失败。新环境需恢复这些已保存的实验，不能重新跑已消耗的 Ta Feng 测试来补包。第三轮也只用本地 CPU；线程数固定为 2，没有使用 AutoDL、GPU 或云端付费资源。`npm run train` 保留第一轮复现入口；运行完成会将页面切回第一轮对应报告与模型。

首次训练获取 UCI Online Retail II，读取原始两张 Excel 表并清洗；后续使用经 SHA-256 校验的缓存。完整模型、配置、逐条预测、报告和校验清单全部保存成功后，才原子更新 `artifacts/latest.json`。失败不会替换上一次可用版本；页面不触发长训练，也不会显示合成指标来掩盖失败。

本机原数据为 `data/raw/verified-mirror.xlsx`，来自经核验的公开镜像。完整 SHA-256 与独立公开 LFS 校验值一致，大小和 CRC32 与 UCI 原包成员头一致，原站已下载的 22,630,349 字节也逐字节一致。报告保留 `mirror_used` 和实际来源。重新获取可用 `uv run python scripts/download-mirror.py`，脚本锁定版本并校验完整文件。

`npm run build` 先校验展示包，再输出前端 `dist/`。Ta Feng 页面读取已核验的保存结果，不依赖推理 API；UCI 原交互仍需要同源本地 Python API。全站独立静态发布和远程部署尚未完成；本地服务仍只监听本机。客户数据接入、账号和在线训练不在当前范围。

## 展示接入第一轮

- 两案例清单绑定固定实验与证据类型；默认 Ta Feng，UCI 不被替换或混算。UCI 当前 API 版本不匹配清单时明确报错。
- Ta Feng 复购与发现各 4 种已评估方法，展示历史、Top 10、实际目标、个例指标与完整人群对照；24 名训练顾客固定抽样，未回访样本保留，另列 3 名新顾客回退示例。
- 50 商品 × 4 周起点 × 6 方法，全部 200 个商品周可切换；显示七天总量、误差、偏差，保留强基线与未通过结论。
- `npm run export:showcase` 校验完整实验文件并复算推荐和周预测统计，生成约 745 KiB 的案例资源（包含 UCI 展示数据），文件不提交 Git。重复导出保持版本一致，失败不更新清单。
- 前端校验 Ta Feng 资源哈希与实验版本；报告 JSON 和全部商品周 CSV 可下载。实现与验收见 [展示接入记录](docs/showcase-iteration-1.md)。

## 推荐可读性增强

Ta Feng 增加购买购物日数、最近购买、历史排序与点击联动，冻结基线和当前模型并排显示命中与名次变化；同样有效或更差的个例如实展示。UCI 已加入 154 条中文参考译名并保留英文原文。所有原始推荐与预测输出保持不变，详情见 [行为证据与译名更新](docs/showcase-behavior-update.md)。

## 模型解读页面

导航「模型解读」或 `#models`：18 组说明、34 个案例内方法，覆盖 Ta Feng 全部 14 种最终评估方法，以及 UCI 的 EASE、13 种逐日预测方法和 6 种周预测方法。同一算法在不同案例／任务中分别计数，不代表 34 种算法。按任务展示输入、处理、输出、适用范围与限制；量化成绩读取同一展示清单内的报告并核验哈希，不复制手填数字。UCI 样本与完整评估仍依赖本地 API。

特征地图明确已使用、部分使用、开发候选、仅展示与未使用。样本入口带案例、任务、模型参数，自动定位相应推荐方法或逐日／周度预测。开发检查新增报告映射与覆盖完整性验证，16 项前端／展示测试与 32 项 Python 测试通过；桌面 1440×1000 和手机 390×844 已检查。预测页可直接打开当前方法的解读，解读也能返回对应任务和模型。该轮未改变训练、指标与冻结实验；随后 LightGBM 推荐排序、LightGCN 与 TFT 已在独立进阶实验中实现，见上方进阶实验与下方 AutoML 说明。

## 第三轮新增能力

- 个人高频、最近购买、90 天衰减复购与 ALS 融合；同一下一单任务中融合 Recall@10 为 14.76%，强复购基线已有 14.57%，主要收益来自复购信息。
- 原 28 天逐日任务新增零预测、均值、中位数和同星期中位数，以及丰富历史特征的 LightGBM L1 / L2 / log-L2。最低 WAPE 77.51%，但总量仍低估约 49.67%。
- 独立的 7 天总销量任务每周重训，12 个起点、144 个商品周。WAPE 52.48%，对最强基线只改善 2.96%，未通过预设 10% 改善筛选。
- 效果报告可查看历史活跃度、购物篮大小、复购／首次商品、零销量／常规／尖峰日和全部 SKU 的诊断。
- 第三轮入口 `train:v3` 依赖配置中固定父实验 `retail-20261011T121416Z`，会先核验哈希。父产物缺失时需恢复它或明确重新选择父实验；不会静默换数据或指标。

## 第二轮模型与交互（保留对照）

- 推荐：热门、ItemCF、最近一单搭配、CPU ALS、EASE。共享每个窗口的二元购买矩阵与商品目录。支持模型切换、新顾客热门回退、排除已购、探索、数量设置，以及对应模型的推荐依据。
- 预测：上周同期、近四周同星期均值、AutoETS、受限 AutoARIMA、Ridge、LightGBM。沿用英国 12 件活跃高销量商品，直接预测未来 28 天。可切换商品、窗口和模型，曲线、误差、偏差与假设补货量同步更新。**数据为 UCI，不是 M5。**
- 比较：推荐报告 Recall@10、NDCG@10、命中率、目录覆盖与冷启动分层；预测报告 WAPE、MAE、总量偏差及逐商品/窗口成绩。较差模型和统计拟合回退也保留。
- 资源与复现：记录 CPU 环境、种子、候选参数、拟合耗时、进程内存、矩阵大小、推荐排序 P50/P95；保存源码快照与依赖锁。服务不读取 Python pickle。
- 展示：业务视角与技术视角，完整 JSON 报告、五类推荐逐顾客预测、六类预测逐日结果均可下载。

## 第二轮统一评估协议

配置在 `services/configs/round2.json`，三个起点固定为 **2011-09-01、2011-10-01、2011-11-01**。每个起点训练只使用此前记录。推荐验证下一个自然月每位顾客第一单；销量预测验证起点起 28 天。预测商品只在最早起点之前选定，不根据验证表现删选商品。

推荐允许复购；候选为至少两位训练顾客买过的全部商品，不抽样负例。未知顾客统一热门回退，未见目标商品留在分母。推荐成绩先在窗口内按顾客平均，再将三个窗口等权平均；跨月出现的同一顾客不是独立新样本。当前交互推荐使用 11 月 1 日之前训练的模型。

销量缺交易日填 0，大额订单保留。每条训练样本的完整 28 天标签严格早于其窗口起点。LightGBM 用原始数量标签，比较 L2 / Poisson / Tweedie，共 6 组；Ridge 保留 log1p 标签与 alpha=1。AutoARIMA 限制 p/q/P/Q、最多 20 个搜索模型，统计方法每个模型/窗口隔离进程限时 90 秒，失败明确回退上周同期并记录原因。

预测汇总 WAPE = 全部绝对误差 / 全部真实销量，MAE 为每商品日误差，总量偏差 = (预测总量 − 实际总量) / 实际总量。零真实销量时 WAPE/偏差为空。绝对偏差超过 20% 显示开发警示，不能把这个门槛当作生产验收标准。

**三个窗口既用于选参，也用于比较，属于开发验证，不是全新独立测试。** 第一轮已经查看过其中部分日期；本轮不宣称独立测试或商业收益。第一轮的切分与数字仍见 [首轮实验说明](docs/experiment-summary.md)，不能与第二轮不同范围的数字直接计算提升。

推荐分数不是概率，不跨算法比较数值大小；潜在因子不编造业务含义，EASE 贡献不解释为因果。预测没有库存、促销信息或校准区间，不能推断缺货时的真实需求。补货是用户输入假设库存的情景计算，未实现收益证明或线上 A/B 实验。

## 验证

```sh
npm run check
npm test
npm run test:ml
npm run build
npm run verify:v3
npm run verify:evaluation
npm run verify:tafeng -- final-20261012T010749Z
```

`verify:v3` 校验父实验未改写，重训新增推荐、逐日和周度模型，并复算全部诊断与筛选条件。`verify:v2` 用于第二轮版本，校验全部文件哈希、从真实源数据重建目标和时间边界、重训早期窗口的入选推荐模型、回放五种推荐全部顾客结果、重训三个窗口的入选 LightGBM，核对保存模型的曲线与逐条指标。统计方法的实际拟合输出、输入历史和失败信息单独保存；该核验脚本不再次运行完整 AutoETS/AutoARIMA 搜索。

`npm test` 保留旧合成教学规则测试；它不能证明真实模型有效。真实模型由 Python 单元测试与实际产物复核共同验证。`scripts/verify-run.py` 根据产物版本分派第一、二、三轮检查。

`verify:evaluation` 只核对新协议、数据分区、代码和文档哈希及测试开启状态，不训练、不计算封存成绩。`prepare:evaluation` 首次从已下载且固定校验值的 Ta Feng 原文件准备分区；已有分区时只验证，不重写。数据获取和迁移说明见 [数据说明](data/README.md)。6 项新增协议测试仅使用临时人工样本，覆盖时间越界、篡改检测、不完整开发决策和重复测试读取拒绝。

`verify:tafeng` 复核已保存的新案例产物，不重新开启封存源数据。`train:tafeng` 是开发入口，但本次测试已经消耗，因此会拒绝继续沿用这份测试做“全新独立”开发；后续新训练需要明确标记测试反馈状态或新建数据协议。请保留访问记录，不能删除它来重置次数。

## 目录

- `apps/web/`：无依赖前端，`round-two.js` 负责第二轮，`real-cases.js` 保留第一轮。旧 `demo-engine.js` 不参与真实页面指标。
- `services/prepare_data.py`：数据获取、校验、清洗与审计。
- `services/train_v3.py`、`services/configs/round3.json`：第三轮增量训练、诊断与独立周度实验。
- `services/train_v2.py`、`services/configs/round2.json`、`services/ml/`：第二轮训练与评估。
- `services/train.py`：保留第一轮训练入口。
- `services/train_tafeng.py`、`services/ml/tafeng.py`：新案例开发、演练、冻结与单次最终评估，结果独立写入 `artifacts/tafeng-runs/`。
- `services/server.py`：本地静态与推理 API，验证模型哈希后原子加载。
- `artifacts/runs/<run_id>/`：每次实验的独立产物，忽略 Git。
- `data/raw/`、`data/processed/`：公开原始数据和缓存，忽略 Git。
- `docs/`：计划、实验结论、验证说明。
- `docs/evaluation/`、`services/configs/evaluation-v1.json`：新场景规格、冻结协议、数据可用性审计与哈希锁。
- `services/ml/evaluation_protocol.py`：开发区读取、训练标签边界与最终测试单次访问约束。
- `artifacts/protocols/`：本地开发／封存分区和访问记录，忽略 Git；不被当前页面 API 读取。
- `design/`：概念图与真实页面截图；概念图不代表实验结果。

## 数据署名

Chen, D. (2012). **Online Retail II**. UCI Machine Learning Repository. <https://doi.org/10.24432/C5CG6D>，CC BY 4.0。原始数据：<https://archive.ics.uci.edu/dataset/502/online+retail+ii>。本项目进行了去重、订单筛选、时间切分、建模与商品日聚合；实验结论不代表原数据作者的结论。


## AutoML 实验室（2026-10-13）

第一阶段（现位于 `#automl?view=tuning`）已接入 Optuna：自动超参搜索、提前剪枝、持久化续跑、验证集选优、冻结后回放、完整试验记录、前后指标与真实样本。该阶段覆盖超参优化与有限特征开关。跨模型与分组特征选择已在下述第二阶段实现；任意特征流水线搜索和 AutoDL 调度尚未实现。框架选择与复现说明见 [调优说明](services/advanced/hpo/README.md)。

本地 CPU 共运行 28 次试验：LightGBM 12 次（4 完成、8 剪枝）、LightGCN 8 次（5 完成、3 剪枝）、TFT 8 次完成。LightGBM 推荐 NDCG@10 从 0.28194 到 0.28109，未改善；LightGCN 三种子 Recall@10 从 10.56%–11.15% 到 11.40%–11.65%，种子 42 的 NDCG 略降，另外两种子改善；TFT WAPE 从 85.84% 到 84.58%，仍弱于同范围中位数 79.94% 与 LightGBM 83.73%。TFT 区间覆盖从 73.41% 到 80.16%，同时平均宽度从 99.77 到 133.05 件，不能只展示覆盖提升。

所有配置按 8 月验证结果选择，9–11 月只用于冻结后的开发回放；由于这些历史结果已被查看，仍不属于独立确认测试。原默认模型、旧成绩、失败记录和 Ta Feng 测试状态保持不变。新增导出资源与模型权重不提交 Git，新环境需要恢复完整产物。

```sh
# 已有产物时，核验并导出，不重新训练
npm run verify:tuning
npm run export:tuning
npm run check
npm test
npm run test:ml
npm run test:deep
npm run build
# 开新研究；不要复用已冻结或代码版本不一致的研究名
npm run tune:lightgcn -- --name next-study --phase search --trials 8
```

页面验收包括桌面 1440×1000、手机 390×844、三模型切换、剪枝试验详情和真实样本。截图见 `design/automl-desktop.png` 与 `design/automl-mobile.png`。


## AutoML 第二阶段：模型、特征与成本选择（2026-10-13）

`#automl` 现在是跨模型选择页；`#automl?view=tuning` 保留上一轮 28 次超参试验。新增 **9 个推荐候选、7 个预测候选** 的真实训练与验证，按预设规则给出“验证精度最佳”和“精度相对落后不超过 1% 时成本最低”两个方案，并展示 Pareto 图、全部候选、特征分组消融、冻结后回放与固定基线。

| 任务 | 8 月验证选优 | 9–11 月开发回放 |
| --- | --- | --- |
| 推荐 | LightGBM 完整匹配特征；NDCG@10 0.33069，纯行为组 0.30420 | Recall@10 16.39%，NDCG@10 0.28109；不是新的模型精度突破 |
| 预测·精度最佳 | TFT WAPE 84.82% | WAPE 84.92%，仍未超过同范围中位数基线 79.94% |
| 预测·成本优先 | LightGBM 历史＋日历，WAPE 85.12% | WAPE 83.43%；验证冻结时选入，未根据回放重新挑选 |

本阶段 TFT 用上一轮参数与固定 5 轮重新训练，采用固定学习率，不使用验证调度器；因此其权重和结果不等于上一轮选定的 checkpoint。所有树特征组共用参数；名称、价格、用户匹配进入不同分组，成绩来自真实验证，不能解释为因果贡献。成本单列共同准备，模型内耗时不含历史 HPO；本机单次耗时不能作为生产延迟或云报价。

```sh
npm run train:automl
npm run verify:automl
npm run export:automl
npm run build
```

已有完整产物时只需核验与导出。流程会绑定数据、依赖、父模型与源码，冻结验证选择后再回放；保留失败和历史运行。完整协议与恢复方式见 [第二阶段说明](services/advanced/automl/README.md)。未修改旧默认模型、未接入客户数据、未重开 Ta Feng 最终测试，也没有使用 AutoDL。

本轮验收：26 项前端／导出测试、34 项既有 Python 测试、16 项进阶测试通过；完成指标复算、构建、桌面 1440×1000 与手机 390×844 检查。实际截图：`design/automl-selection-desktop.png`、`design/automl-selection-mobile.png`。
