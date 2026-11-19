# 虾米模型工坊 · 业务建模案例与评估

**公开数据、实际模型结果、同范围基线对照。**

面向评估算法定制能力的团队与学习建模的开发者，展示从业务问题、数据处理、模型选择到效果评估的完整案例。先看输入输出与效果，再深入方法、成本和适用条件。

[在线查看案例](https://cherler.github.io/xiamimate-model-lab/) · [案例导览](docs/case-walkthroughs.md) · [实验与评估文档](docs/README.md) · [部署说明](deploy/README.md)

## 九类业务，沿着问题看模型

| 业务方向 | 展示重点 |
| --- | --- |
| 商品推荐 | 复购与新商品发现、推荐依据、命中与覆盖 |
| 销量预测 | 逐日与周度预测、基线比较、误差与偏差 |
| 分类与评分 | 阈值、校准、名额与输入特征价值 |
| 智能检索 | 关键词、向量、混合检索与重排的质量和成本 |
| 异常检测 | 事件覆盖、漏检、重复告警与处理负担 |
| 零售分群 | 价值与商品偏好、群体覆盖和分群稳定性 |
| 决策优化 | 在库存、成本与服务假设下比较补货方案 |
| 营销增量 | 随机邮件实验中的多动作效果估计与策略评估 |
| 游戏反外挂 | 瞄准轨迹风险评分、跨设备评估与误报边界 |

另有 M5 销量预测、Dressipi 会话推荐及 AI Agent 工作流与架构说明。具体方法、数据范围、已运行结果和限制在各案例内标明。

## 看清模型带来了什么

- **先看业务输入与输出**：用真实案例说明模型解决哪一段问题。
- **与相同范围的基线比较**：同时呈现总体表现、分组差异和具体样本。
- **保留没有胜出的结果**：方法更复杂，不代表效果更好。
- **把成本放进比较**：查看延迟、索引、资源、覆盖与误差代价。
- **沿证据继续追问**：数据来源、实验协议、报告与方法说明可以相互核对。

例如 Ta Feng 复购任务通过了预设增益筛选，而同批新商品发现与周度预测没有通过；页面同时保留成功与失败的结果。完整口径见 [Ta Feng 实验报告](docs/tafeng-experiment-results.md)。

## 适合怎样使用

**评估定制开发能力**：从一个接近你业务的案例开始，确认可用数据、目标、基线、约束与验收方式。项目提供案例展示与方案参考，当前不提供客户数据上传或在线训练。

**学习建模与工程实现**：沿案例查看特征、模型、评估协议与实现代码，理解每一步选择及其代价。教学拆解与真实实验分别说明。

**了解 AI Agent 应用**：查看工具调用、业务数据与工作流的连接方式。Pages 提供静态案例和说明；问 AI、Agent 执行及需求对话通过明确入口前往独立在线服务。

## 运行展示站

浏览 [GitHub Pages](https://cherler.github.io/xiamimate-model-lab/) 无需安装。自行部署需要 Node.js 22+、Python 3 和 GitHub CLI，前端无 npm 依赖。

```bash
git clone https://github.com/cherler/xiamimate-model-lab.git
cd xiamimate-model-lab
tag=$(node -p "require('./deploy/pages-evidence.json').tag")
asset=$(node -p "require('./deploy/pages-evidence.json').asset")
gh release download "$tag" --repo cherler/xiamimate-model-lab --pattern "$asset" --dir /tmp/model-lab-evidence
python3 scripts/pages_evidence.py restore "/tmp/model-lab-evidence/$asset"
npm run build:pages
npm run preview
```

打开 <http://127.0.0.1:5330>。展示附件带有哈希校验，用于恢复已保存结果；此流程不下载训练数据、不重训模型，也不重新开启已使用的测试集。

## 项目结构

```text
apps/web/            案例展示、图表、模型解读与方案入口
services/            Python 数据处理、建模、评估与可选服务
services/configs/    固定实验配置
docs/                案例报告、方法说明与工程决策
docs/evaluation/     评估协议、范围与证据记录
scripts/             校验、结果导出和静态构建
tests/               前端逻辑、服务与证据检查
deploy/              部署流程与展示附件清单
data/                数据说明；原始与加工数据不入 Git
artifacts/           实验产物说明；训练产物不入 Git
```

## 结果与使用范围

公开数据案例不是客户项目，历史评估不是线上收益证明。模型得分、经营模拟与真实收益分别说明；原始数据、模型权重和完整训练产物不提交 Git。

展示结果通过 [Release 附件](https://github.com/cherler/xiamimate-model-lab/releases)恢复。各案例保留来源、署名、许可状态、失败结果和评估边界；仓库公开不改变第三方数据与模型的许可。实验记录与复核方法见 [开发与实验记录](docs/DEVELOPMENT.md)。

[虾米伙伴在线版](https://xiamimate.com/model-lab/)由个人维护，可能随时关闭或失效；其 AI 功能需要在线服务。GitHub Pages 的案例展示和已发布附件独立可用。

## 虾米伙伴系列

[虾米跨境](https://github.com/cherler/xiamimate-crossborder) · [虾米看 AI](https://github.com/cherler/xiamimate-ai-atlas) · [虾米看股](https://github.com/cherler/xiamimate-stock-lab) · [虾米 CS 课堂](https://github.com/cherler/xiamimate-cs-lab) · [模型工坊](https://github.com/cherler/xiamimate-model-lab)

这些项目由个人持续维护。欢迎通过仓库 Issues 反馈问题、提出具体使用场景；觉得有用，也欢迎 Star 或分享。
