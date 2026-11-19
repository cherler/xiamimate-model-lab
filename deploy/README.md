# 主站接入与公开部署

源码：[cherler/xiamimate-model-lab](https://github.com/cherler/xiamimate-model-lab)（公开）。访问：[虾米伙伴在线版](https://xiamimate.com/model-lab/) · [GitHub Pages 静态版](https://cherler.github.io/xiamimate-model-lab/)。

## GitHub Pages

用户于 2026-11-19 明确要求公开源码并部署 Pages。使用 `.github/workflows/pages.yml`，由 `main` 推送或手动启动；仓库 Pages 的 Source 选择 GitHub Actions，不设置自定义域名，不影响既有虾米伙伴服务。

1. 新环境按根 README 下载 `deploy/pages-evidence.json` 锁定的 Release 附件，执行 `scripts/pages_evidence.py restore`。脚本同时验证归档和逐文件哈希、路径与类型，拒绝不完整归档和覆盖不同结果。
2. 工作流执行语法、前端与恢复脚本测试，再执行 `npm run build:pages`。构建校验全部展示证据，包含九类业务和 M5／Dressipi；Pages 使用独立页眉及项目子路径。
3. 官方 Pages artifact/deploy Actions 发布 `dist/`；部署任务仅使用 `pages:write` 和 `id-token:write`，读取附件使用自带的只读 GitHub token，无需添加个人令牌或 AI 密钥。

Pages 无法运行本项目 Node AI 后端。该构建禁用 AI 请求，保留 Agent 工作流、架构和方法页面，并提供虾米伙伴在线执行入口；需求可在浏览器本地整理和下载，外链只带公开场景参数，不自动传递问题、顾客选择或需求草稿。主站 `--online-ai` 构建不受影响。

如后续更新展示证据：先使用已保存实验导出并完成 `build:pages` 校验，再运行 `python3 scripts/pages_evidence.py pack <新附件路径> --tag <新发布标签>`；审阅新清单、上传同名 Release 附件后再推送锁文件。归档只收录允许目录内的展示文件，原始归档、模型权重、训练工作目录、密钥与旧导出不随之发布。不要覆盖旧附件或重新训练来补齐已消费的测试结果。

## 构建与检查

先恢复已核验的本地展示导出包；它们按 `.gitignore` 不随 Git 推送。干净 clone 不包含训练数据和展示结果，不能直接构建；缺包时构建明确失败，不临时重训或填造结果。

执行 `npm run check`、`npm test`、`npm run test:ml`、`npm run build`。默认 `npm run build` 校验基础案例证据并排除 M5／Dressipi、营销增量与游戏反外挂。正式展示发布使用 `npm run build:showcase`：启用 `--competition-showcase --business-showcase`，逐文件核验四项研究案例的当前清单与结果，只复制清单内展示资源并开启入口。两种构建默认禁用在线 AI；部署独立服务后，追加 `-- --online-ai` 显式启用页面请求。只上传 `dist/`，不能上传项目根目录、`.env`、artifacts 或 apps/web 原目录。

## 主站框架

`/model-lab/` 下读取同源 `/chrome/manifest.json`、`chrome.css` 与 `chrome.js`，调用真实 `XiamiChrome.header/footer`；模块 key 为 `model-lab`。主站 `lib/modules.ts`、后台白名单、运营台清单保持一致。案例无需登录，共用页眉的账号状态不代表模型工坊有客户数据同步或训练账户。

本模块导航保留案例体验、模型解读、教学拆解、场景扩展和方案与合作。独立端口及文件预览不加载主站框架；主站框架故障时保留返回主站与联系方式。主站与模块构建后执行 `node scripts/preview-platform.mjs`，在 5336 端口核验真实子路径和共用框架。

## 云端

现有主机别名为 `xiamimate-app-01`。按 commit 将 `dist/` 上传到 `/srv/xiamimate/model-lab/releases/<commit>/`，核验文件校验和后将 `current` 软链指向该版本。Caddy 使用本目录片段，保留 hash 深链接，资源缺失返回真实 404，无 SPA 的错误资源兜底。AI 使用下文的独立生产入口，不直接代理本机开发服务。

先准备模块文件和路由，校验 Caddy 后 reload，再发布包含第五模块入口的主站构建及共享框架。后端只同步模块白名单并重启使其生效，运营台同步第五模块清单；不迁移数据库，不改其他模块显隐。

验收主站进入、返回主站、应用切换、七例加载、模型／教学入口、下载、深链接刷新、手机导航与公开构建研究数据排除。来源署名与完整评估范围随结果一起发布。

## 2026-10-16 首次正式发布

工坊发布版本 `2192a85`，主站 `4971969`，后端模块白名单 `d5f5bec`，运营台 `dd37f18`。262 个公开文件与本地校验和一致。七类案例、公网页眉页脚、首页入口和深链接刷新已核验。GitHub 后续文档提交不改变当前线上代码版本。

首页曾因缺少缓存控制显示旧四应用入口，现已设置 `Cache-Control: no-cache`，部署镜像记录在后端 `88de012`。已有旧缓存首次可能需强制刷新；不依赖查询参数作为正式入口。详细验收与未完成收尾见 `docs/case-depth-plan.md`。

## 2026-10-16 研究案例展示范围更新

用户明确要求将 M5 和 Dressipi 案例放到线上作为展示。本次使用 `build:showcase`，仅发布当前清单内经过哈希校验的保存结果，不上传原始数据归档、模型权重、旧导出版本或密钥。该发布选择不代表获得数据提供方的额外授权，来源／条款与评估限制继续显示。原冻结清单中的 `public_export_allowed=false` 记录的是当时导出状态，保留原样；不篡改实验文件以制造授权记录。默认构建仍排除两案例，部署时须明确选择展示构建。

服务器 `/srv/xiamimate/model-lab/current` 是网站静态目录，不是源码目录，不能放 `.env`。AI 运行文件和配置使用下列独立目录。


## 在线 AI 部署（2026-10-16）

用户明确授权使用项目根 `.env` 上线。只传输 `MODEL_LAB_AI_*` 六项配置，不传其他项目变量或整个源码目录；绝不输出密钥。配置文件 `/etc/xiamimate/model-lab.env`，所有者 root:model-lab、权限 0640，父目录 0750。修改配置后执行 `systemctl restart model-lab-assistant`。

- 运行目录：`/srv/xiamimate/model-lab-api/releases/<commit>`，`current` 指向该版本；包含 `services/assistant/`、生产启动脚本、仅声明 ES Modules 的 package.json。`apps/web` 链接到同版本静态结果包，复用核验后的案例资料。
- 运行环境：独立 Node 22 `/opt/xiamimate-node22/bin/node`，不替换主站 Node。安装官方 tar 包并核验官方 SHA-256。
- 使用本目录 `model-lab-assistant.service`，低权限 `model-lab` 用户，仅监听 `127.0.0.1:8340`，不提供静态文件或目录浏览。配置通过 `MODEL_LAB_ENV_FILE` 读取。
- Caddy 在静态路由之前代理 `/model-lab/api/assistant/*`，去掉 `/model-lab` 前缀；Host 固定为主站，POST 必须包含精确同源 Origin。Origin 校验不是身份认证；服务是公开、有限额度的案例演示，不接通主站积分。
- 默认全站每小时 20 次分析、最多 2 个同时执行、90 秒任务超时、48KB 请求体、固定工具白名单；不能指定外部网址、模型或密钥。小时额度是进程内限制，重启重置，并非按账号计费或抗滥用身份验证。
- `npm run build:showcase -- --online-ai` 生成本次展示版；仅前端开关变化，密钥不会进入构建。默认构建仍可独立静态运行。
- 上线检查：status/options、跨站拒绝、密钥 URL 不可访问、真实问答与 Agent 工具计算、需求草稿；回退时关闭前端开关或恢复先前静态版本并停止该服务，不影响其他应用。

## 2026-10-28 Agent 页面更新发布

代码版本 `15ad441` 已推送 GitHub `main`。使用 `npm run build:showcase -- --online-ai` 构建，静态与 API 的 `current` 分别指向各自 `releases/15ad441`；保留原 `4e2db54` 版本。374 个静态文件和 9 个 API 文件逐文件 SHA-256 核验通过。服务器继续使用既有 `/etc/xiamimate/model-lab.env`，未修改密钥、主站代码或代理配置。

本次上线 Agent 紧凑布局、工作流说明和架构可视化；保留原有七案例、M5／Dressipi 与在线 AI。营销增量和反外挂的源码已同步，结果包仍按现行构建规则排除，未开放线上入口。

公网验收：页面、Agent 样式与流程脚本、AI 开关及两竞赛案例清单均与本地构建哈希一致；status/options 正常。固定流程返回 200，两个工具均成功；真实 MiniMax-M3 Agent 返回 200，耗时 3.733 秒，五条工具记录成功，计算报告校验通过。本轮浏览器自动验收连接连续超时，未取得新的线上截图；发布前同版代码的本地桌面、手机与交互验收见 `docs/agent-cooperation-plan.md`。

## 2026-10-28 营销增量与反外挂发布范围补齐

用户确认线上应包含这两项已完成的新案例。正式展示构建不再沿用仅本地的入口开关，包含九类数据建模业务及 AI Agent；四个阅读模块共用同一导航，保留选择和深链接。`business-showcase.mjs` 检查清单路径、文件哈希、运行版本与统计完整性，仅允许当前清单和结果进入发布包；反外挂必须通过已有阈值修正版校验。旧导出、原始数据、模型权重继续排除。

默认构建排除与正式展示构建包含均已验证；`npm run check`、292 项前端／服务测试、132 项 Python 测试通过。两案例的“本地研究”页签调整为“研究实验展示”，来源与评估限制保留，未改变模型或重新评估留出数据。

发布代码版本 `a40e391`，静态与 API 的 `current` 已切换至该版本。378 个静态文件及 9 个 API 文件服务器 SHA-256 核对通过；公网两案例清单、当前结果、入口开关和页面脚本与构建一致，旧结果路径返回 404，在线 AI 配置正常。Chrome 实际验收两案例体验页，10 个业务入口可见、结果正常加载、反外挂模型解读往返跳转正确；已保存线上截图。GitHub 同步包含上轮尚未推送的发布记录 `fd2c236`。
