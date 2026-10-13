"""Generate local research notes from a verified completed run; no web export."""
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.competitions.m5_data import ROOT, RAW, digest
from services.competitions.m5_verify import verify

pointer = json.loads((ROOT / 'artifacts/competition-m5.json').read_text())
run = ROOT / 'artifacts/competition-runs' / pointer['run_id']
if digest(run / 'report.json') != pointer['report_sha256']:
    raise ValueError('report pointer differs')
verify(run)
report = json.loads((run / 'report.json').read_text())
if 'final' not in report:
    raise ValueError('complete reserved-window evaluation before generating final research notes')
if report['config']['protocol'] != 'm5-local-core-v1' or report['config']['store'] != 'CA_1':
    raise ValueError('this research-note template describes the frozen v1 CA_1 pilot only')
names = {'seasonal_naive': '上周同日', 'weekday_median_8w': '八周同星期中位数',
         'weekday_mean_8w': '八周同星期均值', 'lgbm_tweedie_core': 'LightGBM Tweedie 核心版'}
calendar = pd.read_csv(RAW / 'calendar.csv')
dates = lambda o: f'{calendar.iloc[o].date}～{calendar.iloc[o+27].date}'
lines = [f'# M5 与 Dressipi 复现记录（2026-10-13）', '',
         f'运行：`{run.name}`。本地 CPU；M5 首轮缩减复现完成，Dressipi 仅完成无真实数据的准备。', '',
         '这是本地研究记录，尚未获准接入对外商业展示。M5 公开展示许可待核实；Dressipi 需取得适当数据访问与用途许可。没有发布新案例，也没有改动旧案例的默认模型。', '',
         '## 范围与复现程度', '',
         f'- CA_1 门店全部 {report["series"]:,} 个商品；28 天预测；每折训练最近 1,095 天，RMSSE 分母使用起点之前的完整历史。',
         '- 固定 42 个特征：商品／部门／品类，28～42 天滞后、移位 28 天的滚动统计、日历／节假日／SNAP、提供的价格及历史价格统计。未来日历和价格按竞赛已知协变量使用。',
         '- 独立实现冠军非递归门店模型的核心思路，不是原代码逐字移植。1000 棵树、127 叶、学习率 0.05；原门店方案为 3000 棵、255 叶、0.015。未复现完整 220 模型、递归预测、层级集成和全部特征。',
         '- 主指标为本门店范围的 12 层级 scope WRMSSE，越低越好；单门店部分层级重合，权重与完整 30,490 序列不同，**不能直接对比冠军排行榜分数**。WAPE 与总量偏差同时保留，不能把 1−WAPE 称为准确率。',
         '- 配置在结果出现前冻结；两个开发窗口平均主指标选模。保留窗口为官方公开验证时段，不是竞赛私榜，也不是冠军方法从未见过的数据；本项目第一次查看该窗口，现已消耗。', '',
         '## 两折开发结果', '',
         '| 窗口 | 模型 | scope WRMSSE ↓ | 商品日 WAPE ↓ | 总量偏差 |',
         '| --- | --- | ---: | ---: | ---: |']
for fold in report['folds']:
    for name, metrics in fold['models'].items():
        lines.append(f'| {dates(fold["origin"])} | {names[name]} | {metrics["scope_wrmsse"]:.5f} | {metrics["wape"]:.2%} | {metrics["bias"]:+.2%} |')
lines += ['', f'冻结选择：{names[report["selection"]["winner"]]}。两折平均 scope WRMSSE：', '',
          '| 模型 | 开发均值 |', '| --- | ---: |']
for name, score in report['selection']['scores'].items():
    lines.append(f'| {names[name]} | {score:.5f} |')
lines += ['', f'## 保留窗口：{dates(report["final"]["origin"])}', '',
          '冻结模型重新拟合后先保存预测，再记录标签访问，最后评分。不得根据本表重选模型后仍称同一窗口独立测试。', '',
          '| 模型 | scope WRMSSE ↓ | 商品日 WAPE ↓ | 总量偏差 |', '| --- | ---: | ---: | ---: |']
for name, metrics in report['final']['models'].items():
    lines.append(f'| {names[name]} | {metrics["scope_wrmsse"]:.5f} | {metrics["wape"]:.2%} | {metrics["bias"]:+.2%} |')
lines += ['', '## 事后诊断：门店总量与商品日误差', '',
          '先将同一天所有商品相加，再算门店每日总量 WAPE。这与商品日 WAPE 回答不同问题，不能替代主指标，也不参与选模。误差可能在汇总时抵消；因此两种粒度都保留。', '',
          '| 模型 | 门店每日总量 WAPE | 商品日 WAPE |', '| --- | ---: | ---: |']
actual = np.load(run / 'reserved-actual.npz')['actual']
predictions = np.load(run / 'reserved-predictions.npz')
for name, metrics in report['final']['models'].items():
    daily = float(np.abs(actual.sum(axis=0) - predictions[name].sum(axis=0)).sum() / actual.sum())
    lines.append(f'| {names[name]} | {daily:.2%} | {metrics["wape"]:.2%} |')
lines += ['', 'Tweedie 训练目标接近条件均值，层级 RMSSE 对平方误差敏感；中位数对应绝对误差目标。因此模型可能在层级得分、总量偏差上更好，在商品日 WAPE 上仍输给中位数。竞赛成绩不能代替补货收益证明，也不能宣称复杂模型全面领先。', '',
          '## 本地成本与检查', '', '| 起点 | 训练行数 | 特征准备 | 模型拟合 | 28天预测 |', '| --- | ---: | ---: | ---: | ---: |']
for fold in report['folds'] + [report['final']]:
    cost = fold.get('cost')
    if cost:
        lines.append(f'| d_{fold["origin"]} | {cost["train_rows"]:,} | {cost["feature_seconds"]:.1f}秒 | {cost["fit_seconds"]:.1f}秒 | {cost["predict_seconds"]:.1f}秒 |')
lines += ['', '本机 CPU 两线程，单次耗时不等于生产延迟或云端报价。原始数据、模型、逐条预测、源码快照与访问日志存放于忽略 Git 的实验目录。', '',
          '- `npm run verify:m5`：从保存预测重算指标和开发选优，不重新打开保留标签。',
          '- `npm run verify:m5-weights`：全体 30,490 个底层序列的销售额权重与归档权重最大差约 5×10⁻¹³；不读取私榜标签。',
          '- 训练前两次数据格式适配失败留存记录，均未拟合模型或开启保留标签。', '',
          '## Dressipi 当前状态与剩余工作', '',
          '- 已完成会话边界检查、时间切分、MRR@100／Recall@100、热门／共现／匿名属性基线，以及测试。测试使用人工小样本，不是 Dressipi 模型效果。',
          '- 官方数据访问页在本机无法完成加载；未下载数据、未代为接受条款，也没有训练或编造 MRR。商品属性为匿名代码，不会补造真实品名或图片。',
          '- 核实的 SIHG4SR MIT 仓库为第四名，论文／仓库报告 MRR 0.20762，**不是我们的成绩，也不是冠军**。精确冠军仓库仍未核实。',
          '- 原版 v2 依赖 Python 3.8、Torch 1.10、DGL 0.7.2、CUDA 11.3；需独立 Linux 环境，尚未做环境可运行性验证。', '',
          '## 下一阶段', '',
          '1. M5：先解决对外使用范围，再扩展多门店、完整特征和原版预算，最后逐步补齐递归与多层级集成；每项变更仅使用开发窗口。当前保留窗口已消耗，不能反复选优。',
          '2. Dressipi：取得官方数据及适当用途许可、确认可复现的参考方案，再运行真实基线、属性排序和图模型；明确区分冠军、第四名与自有改进。',
          '3. 展示：许可允许且结果核验后再做页面接入，保留原有失败案例；突出目标、特征、对照、成本与限制，不承诺线上经营收益。', '',
          '## 来源', '',
          '- [M5 官方方法与 A1 代码](https://github.com/Mcompetitions/M5-methods)，固定提交 `18e4e776cfa1ded3b387fabe008c6c2c44922007`。',
          '- [Nixtla 数据读取说明](https://github.com/Nixtla/datasetsforecast/blob/main/datasetsforecast/m5.py)；镜像固定提交 `72b8e7fd3b565b3c538adcb1d1a05117d8562d7e`，逐文件校验见本地数据清单。软件许可不等于数据商用授权。',
          '- [M5 数据页](https://www.kaggle.com/competitions/m5-forecasting-accuracy/data)：许可依竞赛规则，当前规则正文未能读取，不推定商用许可。',
          '- [Dressipi 数据说明](https://www.recsyschallenge.com/2022/dataset.html)、[官方条款](https://www.recsyschallenge.com/2022/Dressipi2022_TC.pdf)。',
          '- [第四名 SIHG4SR 代码](https://github.com/Intel-bigdata/recsys2022_intel_submission)，固定提交 `72a9d8970b09f641e2e89adadcd5b86b9a9770a2`。', '']
target = ROOT / 'docs/competition-reproduction.md'
target.write_text('\n'.join(lines))
print(target)
