# 主站接入与公开部署

源码：`https://github.com/cherler/xiamimate-model-lab`（私有）。访问：`https://xiamimate.com/model-lab/`。

## 构建与检查

先恢复已核验的本地展示导出包；它们按 `.gitignore` 不随 Git 推送。干净 clone 不包含训练数据和展示结果，不能直接构建；缺包时构建明确失败，不临时重训或填造结果。

执行 `npm run check`、`npm test`、`npm run test:ml`、`npm run build`。公开 `dist/` 会校验全部七案例证据，排除 M5／Dressipi 研究结果，写入公开静态模式，禁用在线 AI 请求。只上传 `dist/`，不能上传项目根目录、`.env`、artifacts 或 apps/web 原目录。

## 主站框架

`/model-lab/` 下读取同源 `/chrome/manifest.json`、`chrome.css` 与 `chrome.js`，调用真实 `XiamiChrome.header/footer`；模块 key 为 `model-lab`。主站 `lib/modules.ts`、后台白名单、运营台清单保持一致。案例无需登录，共用页眉的账号状态不代表模型工坊有客户数据同步或训练账户。

本模块导航保留案例体验、模型解读、教学拆解、场景扩展和方案与合作。独立端口及文件预览不加载主站框架；主站框架故障时保留返回主站与联系方式。主站与模块构建后执行 `node scripts/preview-platform.mjs`，在 5336 端口核验真实子路径和共用框架。

## 云端

现有主机别名为 `xiamimate-app-01`。按 commit 将 `dist/` 上传到 `/srv/xiamimate/model-lab/releases/<commit>/`，核验文件校验和后将 `current` 软链指向该版本。Caddy 使用本目录片段，保留 hash 深链接，资源缺失返回真实 404，无 SPA 的错误资源兜底。不代理或部署本机 AI 服务。

先准备模块文件和路由，校验 Caddy 后 reload，再发布包含第五模块入口的主站构建及共享框架。后端只同步模块白名单并重启使其生效，运营台同步第五模块清单；不迁移数据库，不改其他模块显隐。

验收主站进入、返回主站、应用切换、七例加载、模型／教学入口、下载、深链接刷新、手机导航与公开构建研究数据排除。来源署名与完整评估范围随结果一起发布。
