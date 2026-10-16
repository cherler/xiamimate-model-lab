# 主站接入与公开部署

源码：`https://github.com/cherler/xiamimate-model-lab`（私有）。访问：`https://xiamimate.com/model-lab/`。

## 构建与检查

先恢复已核验的本地展示导出包；它们按 `.gitignore` 不随 Git 推送。干净 clone 不包含训练数据和展示结果，不能直接构建；缺包时构建明确失败，不临时重训或填造结果。

执行 `npm run check`、`npm test`、`npm run test:ml`、`npm run build`。默认 `npm run build` 校验七案例证据并排除 M5／Dressipi。用户已明确选择发布两项研究案例时，运行 `npm run build:showcase`：额外逐文件核验两案例清单，只复制清单内展示资源，开启案例入口。两种构建均写入公开静态模式并禁用在线 AI 请求。只上传 `dist/`，不能上传项目根目录、`.env`、artifacts 或 apps/web 原目录。

## 主站框架

`/model-lab/` 下读取同源 `/chrome/manifest.json`、`chrome.css` 与 `chrome.js`，调用真实 `XiamiChrome.header/footer`；模块 key 为 `model-lab`。主站 `lib/modules.ts`、后台白名单、运营台清单保持一致。案例无需登录，共用页眉的账号状态不代表模型工坊有客户数据同步或训练账户。

本模块导航保留案例体验、模型解读、教学拆解、场景扩展和方案与合作。独立端口及文件预览不加载主站框架；主站框架故障时保留返回主站与联系方式。主站与模块构建后执行 `node scripts/preview-platform.mjs`，在 5336 端口核验真实子路径和共用框架。

## 云端

现有主机别名为 `xiamimate-app-01`。按 commit 将 `dist/` 上传到 `/srv/xiamimate/model-lab/releases/<commit>/`，核验文件校验和后将 `current` 软链指向该版本。Caddy 使用本目录片段，保留 hash 深链接，资源缺失返回真实 404，无 SPA 的错误资源兜底。不代理或部署本机 AI 服务。

先准备模块文件和路由，校验 Caddy 后 reload，再发布包含第五模块入口的主站构建及共享框架。后端只同步模块白名单并重启使其生效，运营台同步第五模块清单；不迁移数据库，不改其他模块显隐。

验收主站进入、返回主站、应用切换、七例加载、模型／教学入口、下载、深链接刷新、手机导航与公开构建研究数据排除。来源署名与完整评估范围随结果一起发布。

## 2026-10-16 首次正式发布

工坊发布版本 `2192a85`，主站 `4971969`，后端模块白名单 `d5f5bec`，运营台 `dd37f18`。262 个公开文件与本地校验和一致。七类案例、公网页眉页脚、首页入口和深链接刷新已核验。GitHub 后续文档提交不改变当前线上代码版本。

首页曾因缺少缓存控制显示旧四应用入口，现已设置 `Cache-Control: no-cache`，部署镜像记录在后端 `88de012`。已有旧缓存首次可能需强制刷新；不依赖查询参数作为正式入口。详细验收与未完成收尾见 `docs/case-depth-plan.md`。

## 2026-10-16 研究案例展示范围更新

用户明确要求将 M5 和 Dressipi 案例放到线上作为展示。本次使用 `build:showcase`，仅发布当前清单内经过哈希校验的保存结果，不上传原始数据归档、模型权重、旧导出版本或密钥。该发布选择不代表获得数据提供方的额外授权，来源／条款与评估限制继续显示。原冻结清单中的 `public_export_allowed=false` 记录的是当时导出状态，保留原样；不篡改实验文件以制造授权记录。默认构建仍排除两案例，部署时须明确选择展示构建。

服务器 `/srv/xiamimate/model-lab/current` 是网站静态目录，不是源码目录，不能放 `.env`。当前没有部署独立模型工坊源码或 AI 服务；日后新增服务时，其源码和私密配置须位于静态目录以外。
