# 训练与服务

`npm run train` 离线运行下载、审计、选参、推荐和预测评估，完成后发布最新产物指针。`npm run dev` 启动独立本地 Python 服务，监听 `127.0.0.1:5328`；可用 `MODEL_LAB_PORT` 改端口。

| 接口 | 用途 |
|---|---|
| `GET /api/v1/health` | 训练产物是否就绪、版本 |
| `GET /api/v1/experiments/latest` | 完整指标、切分、数据审计、选参、环境 |
| `GET /api/v1/customers` | 训练期固定随机抽取的 24 位匿名顾客及最近记录 |
| `POST /api/v1/recommendations` | 实时读取已训练相似度，排序并执行规则 |
| `GET /api/v1/forecasts` | 保存的真实历史回测序列、指标 |
| `GET /api/v1/report.json` | 可下载报告 |
| `GET /api/v1/test-predictions-itemcf.csv.gz` | 推荐逐顾客预测与真实下一单 |
| `GET /api/v1/forecast-predictions.csv.gz` | 商品日实际值、基线与模型预测 |
| `GET /api/v1/checksums.json` | 产物 SHA-256 清单 |

推荐请求示例：

```json
{"customer_id":"new","strategy":"itemcf","limit":10,"exclude_purchased":false,"exploration":0}
```

策略 `popular/itemcf/basket`；数量 1–20，探索 0–100 整数；严格验证类型。分数不是概率。`evaluation_policy_matches` 只表明规则与报告设置一致，不表示个体推荐效果已被证明。未知顾客回退。探索是显式业务加分规则，不是重新训练；需要重新评估才能报告其效果。

模型用 JSON、NPY 和稀疏 NPZ 保存，不加载 pickle。服务加载前核验必要产物哈希；只允许下载白名单文件。切换最新实验时使用锁。训练不从 HTTP 触发。

预测接口目前返回已保存的两段历史回测结果；不是接受任意新数据的在线预测端点。训练模型系数和标准化参数已保存，可供复现。客户数据上传与接入不在当前展示项目范围。

## 展示数据

`npm run export:showcase` 从固定的 UCI 与 Ta Feng 已存实验导出 `apps/web/showcase/`。Ta Feng 的推荐、周预测与效果报告由前端读取并核验哈希，不新增训练或推理接口。UCI 的原接口与最新实验指针保留；前端检查当前 API 的实验是否与案例清单一致。完整静态发布属于后续阶段。
