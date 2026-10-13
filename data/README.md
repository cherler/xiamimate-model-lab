# 公开数据与处理

使用 UCI Online Retail II 两张原始表（2009–2011，1,067,371 条原始行）：

- 数据页：<https://archive.ics.uci.edu/dataset/502/online+retail+ii>
- 下载：<https://archive.ics.uci.edu/static/public/502/online%2Bretail%2Bii.zip>
- 许可：CC BY 4.0。
- 署名：Chen, D. (2012). Online Retail II. UCI Machine Learning Repository. <https://doi.org/10.24432/C5CG6D>。

`npm run train` 自动下载并记录 SHA-256，原文件保存在 `raw/`。清洗缓存 `processed/transactions.csv.gz` 与 `audit.json` 由原文件哈希和清洗代码指纹控制，均不提交 Git。

按顺序剔除：完全重复、无效日期或非有限数量/价格、取消订单、非正数量、非正价格、非商品货号（保留 5 位数字加至多 2 个字母）。缺顾客 ID 保留用于销量，不能参与推荐。大额有效正向订单保留并计数。

这些步骤定义的是“正向商品销售行”，不是退货后的净销量或净收入。历史描述可能不准确；页面只展示原数据描述与货号，不编造产品照片。相似度、热门度、顾客示例和展示历史全部来自训练期。预测商品按验证前英国销量选定，缺交易日按零处理，此假设在报告中披露。

当前没有下载 M5；不将 UCI 预测成绩标成 M5 成绩。

首轮实际从公开 GitHub 镜像取得 XLSX（原站下载过慢）：<https://github.com/bonifasiusx/lrfm-analysis-online-retail-store/blob/main/online_retail_II.xlsx>。条件请求 ETag 为 `47b49d0acea9a5b1895997e9df1fc435c42addc9`，完整 XLSX SHA-256 为 `bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980`，与 HuggingFace `michaelmallari/online-retail-ii` 固定版本 `433602ba287f8dc687f4ded85148827eeb4b0c68` 的公开 LFS 哈希一致。文件大小 45,622,278 字节，CRC32 3843187429，与 UCI 原包成员头一致；另与原站已获取的 XLSX 前 22,630,349 字节逐字节比较一致。此校验不声称已下载完整原站 ZIP；原站包头与比对记录保存在本机 `raw/acquisition-verification.json`。

`scripts/download-mirror.py` 是明确选择镜像时的获取工具。`prepare_data.py` 优先使用已完整下载的原站 ZIP，否则使用本机通过固定校验值验证的镜像，均保留来源。

## Ta Feng 版本 1：准备阶段记录

本节保留初次准备记录。后续已完成本地训练和单次最终测试，见 [最终报告](../docs/tafeng-experiment-results.md)；测试分区及访问记录必须保留，不能重置或重新用于选参。

来源：[Kaggle · chiranjivdas09 / Ta Feng Grocery Dataset](https://www.kaggle.com/datasets/chiranjivdas09/ta-feng-grocery-dataset)。2026-10-12 核对发布端 API，版本号 1、许可字段 `CC0: Public Domain`。这是分发者的许可声明，不是另行核验原零售商权利链的结论。原始元数据响应保存在 `raw/ta-feng-v1/kaggle-metadata.json`。

本地 ZIP：`raw/ta-feng-v1/dataset.zip`，14,172,990 字节，SHA-256 `aacd37a048aa6e5b814d7c5301a27ad6fad7a478c6116b6e24eaeb6ac618516a`。成员 `ta_feng_all_months_merged.csv`，817,741 行，覆盖 120 个日历日。保留有效正向交易，本版本没有因此删除行；不使用年龄、邮编或成本做特征。日期没有日内时间和订单号，只能构造购物日篮子。

| 分区 | 日期（含首尾日） | 交易行 | 用途 |
| --- | --- | ---: | --- |
| 初始训练 | 2000-11-01—2000-12-31 | 401,838 | 初始拟合、固定商品选择 |
| 开发验证 | 2001-01-01—2001-01-31 | 216,864 | 模型比较、参数选择 |
| 封存测试 | 2001-02-01—2001-02-28 | 199,039 | 最终 release 后一次评分，本次未评分 |

`artifacts/protocols/ta-feng-evaluation-v1/` 保存开发区、封存区、训练期选出的 50 件商品和哈希清单，均不提交 Git、不通过当前网页提供。结构审计允许接触完整文件日期和数量，但没有按测试结果筛选商品或展示测试销量分布。单月／四个周窗口仍不能证明跨季节稳定性。

原始获取命令（仅在文件缺失时执行，不覆盖已有冻结材料）：

```sh
mkdir -p data/raw/ta-feng-v1
curl --fail --location --max-time 60 'https://www.kaggle.com/api/v1/datasets/download/chiranjivdas09/ta-feng-grocery-dataset?datasetVersionNumber=1' -o data/raw/ta-feng-v1/dataset.zip
curl --fail --location --max-time 30 'https://www.kaggle.com/api/v1/datasets/list?search=ta-feng-grocery-dataset' -o data/raw/ta-feng-v1/kaggle-metadata.json
npm run prepare:evaluation
npm run verify:evaluation
```

首次准备固定源码、文档与源数据的哈希；后续修改应建立协议新版本。元数据接口的下载量等动态字段可能变化，因此迁移本次完整冻结状态时，需要一起保留原元数据响应、分区、`manifest.json` 和 `docs/evaluation/protocol-lock.json`；重新下载建立的是新的准备记录，不能冒充原哈希状态。测试开启记录也必须迁移，不能因换电脑而重置独立测试次数。

完整规则见 [评估协议](../docs/evaluation/evaluation-protocol.md)，机器审计见 [data-readiness.json](../docs/evaluation/data-readiness.json)。现有 UCI 原数据与实验均保留。
