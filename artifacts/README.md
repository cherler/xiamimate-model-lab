# 实验产物

每次真实训练在 `runs/retail-<UTC时间>/` 下保存独立目录，成功后才更新 `latest.json`。失败运行不发布。

- `config.json`：推荐切分、种子、参数候选、目标定义。
- `data-audit.json`：来源、原文件哈希、清洗逐步计数。
- `model.json`、`itemcf.npz`、`popularity.npy`：真实训练目录、历史、相似度和热门度。
- `profiles.json`：固定随机训练顾客最近公开购买记录。
- `test-predictions-{popular,itemcf,basket}.csv.gz`：同一测试顾客的完整目标、推荐和逐顾客分数。
- `forecast-ridge-<origin>.npz`：每个回测起点的标准化参数、Ridge 系数及截距。
- `forecast-series.json`、`forecast-predictions.csv.gz`：预测曲线、实际结果及逐商品日结果。
- `report.json`：指标、验证选参记录、配对 bootstrap、版本与限制说明。
- `source/`：训练源码、依赖锁快照。
- `checksums.json`：以上各文件的 SHA-256。

原始数据与产物均忽略 Git。不得把未运行的实验填成已完成或把离线结果称为业务收益。
