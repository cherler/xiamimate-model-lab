# Competition reproduction

Isolated from UCI development and Ta Feng's consumed test. No customer uploads or web-triggered training. All competition data/models/reports stay outside the web build and Git until appropriate public-use rights are established. Dataset provenance and code licensing are separate in `sources.json`.

## M5 first stage

Independent implementation of the **nonrecursive store-level core** of the first-place solution; **not** a bit-for-bit port, not the complete 220-model ensemble. Champion source pinned to organizer commit `18e4e776cfa1ded3b387fabe008c6c2c44922007`, A1. The original store model uses 3,000 trees, learning rate .015 and 255 leaves. Our CPU pilot fixes 1,000 trees, .05, 127 leaves and a 1,095-day training window before evaluating. It omits target mean encodings, some price statistics, recursive variants and store/category/department ensembles. These differences must accompany every result.

- Cohort: **all CA_1 items**, selected by store identity before inspecting scores; no best-selling subset or post-result sample selection.
- Horizon: 28 days. Development origins d_1857 and d_1885; report both, select by their mean scope WRMSSE. Parameters/tree budget are fixed, no early stopping against future labels.
- Reserved origin d_1913 (public competition validation horizon d_1914–1941). Initially sealed; selection must be saved before access. It is a fresh project holdout, **not** the private competition test (d_1942–1969), nor an unseen dataset for the published champion method. Once consumed it is permanently recorded and no longer available for new model selection.
- Main metric: the guide's 12 hierarchy levels, post-first-sale RMSSE denominator and last-28-day sales-dollar weights, then average across levels. On one store this is **scope WRMSSE**, not official full-data leaderboard WRMSSE; aggregated levels differ/collapse. Also report per-level errors, WAPE, MAE and signed bias. Zero positive-weight scale fails explicitly.
- Baselines: last week repeated, eight-week same-weekday median, eight-week same-weekday mean. All use identical items/origins/horizons.
- Features: item/department/category, lag 28–42, rolling mean/std shifted 28 days, calendar/events/SNAP, provided weekly price and causal price history. Future price/calendar are known covariates **under competition assumptions**; prices being known 28 days ahead is not a general real-business guarantee.
- Do not load private-test labels. Do not use champion saved predictions as our trained model. Official rank/score and our local reduced reproduction remain separate.
- Full scale next: compare missing feature groups on development only; add recursive/store/category/department ensemble, restore exact reference budgets, freeze before one explicitly versioned final replay. Full ensemble may require longer CPU jobs; a GPU is not automatically beneficial for this solution.

## Dressipi stage

The pinned third-party training mirror has now been downloaded, verified and used for the independent local CPU pilot below. Public lead-generation use remains disabled pending appropriate permission. Exact champion code has not been verified; no champion/GNN reproduction or third-party score display is claimed. Anonymous attribute codes are used as codes, never invented product names.

## Local commands

```sh
npm run prepare:m5
npm run verify:m5-weights
npm run train:m5
npm run verify:m5
# After reviewing frozen development selection; one recorded reserved-window access:
npm run final:m5 -- --run-id m5-<saved-run-id>
npm run verify:m5
```

The import verifies the pinned archive Git blob and records SHA-256 for each whitelisted CSV. It never extracts `sales_test_evaluation.csv`. Development loads sales columns only through d_1913; reserved predictions and selection are persisted before d_1914–1941 labels are loaded. A store/origin access ledger survives run changes. Verification recomputes saved metrics without rereading reserved labels. Every run snapshots code, protocol, source/data/dependency hashes, cohort, predictions, models and costs. Local-only export commands verify saved results. Default public builds exclude both competition data bundles.

`verify:m5-weights` independently compares last-28-day revenue weights for all 30,490 bottom series with archived organizer validation weights; it reads no validation/private target labels. It is an arithmetic audit, not full-scope model evaluation.

Dressipi preparation now includes `dressipi.py` and `dressipi-protocol.json`: schema checks, whole-session date splits, all-session MRR/Recall, train-only co-occurrence, popularity and anonymous attribute baselines. Tests use invented fixtures only and do not imply measured Dressipi accuracy. SIHG4SR has not been trained; the local CPU pilot below supersedes the initial data-preparation status. Original v2 environment is pinned for a future isolated Linux run (Python 3.8 / Torch 1.10 / DGL 0.7.2 / CUDA 11.3); compatibility and hardware requirements remain untested.


## Dressipi local CPU pilot v2 (2026-10-13)

The user requested checking a non-official download. A pinned training-file mirror was located at `yuanhenglee/RecSys-Dressipi`, commit `e91a0ef5d84aab5e000746b6da9e4e0e5ee615ec`. The importer verifies LFS SHA256 / Git-blob identity, retains resumable chunks, downloads only three training CSVs, and records the organizer's later research/education statement separately from historical competition terms. No registration form or terms acceptance is performed. A mirror does not establish commercial redistribution rights; both M5 and Dressipi exports are excluded from default public builds.

The new independent pipeline is **not a champion/GNN port**. It fixes pre-March statistics from at most 100,000 sessions, learns a LightGBM LambdaRank model from at most 3,000 March sessions, then evaluates at most 1,000 April sessions. Complete sessions are assigned chronologically and sampled by SHA256 of session ID, without target-dependent selection. Baselines remain frozen before March. All catalogue IDs are candidates before per-session viewed-item exclusion; retrieval unions top 100 popularity/co-occurrence/anonymous-attribute candidates, with no target injection. Retrieval misses remain zero in full-validation MRR@100 and Recall@100; only positive-containing training queries can train the ranker. This is development evidence, not the official candidate/prefix-truncated test protocol.

```sh
npm run prepare:dressipi
npm run train:dressipi
npm run export:dressipi
```

Training saves provenance, protocol, catalogue, frozen model checksum, every validation ranking, fixed samples, measured costs, report and file checksums. Export recomputes ranking metrics from saved predictions and verifies sample identity. Frontend lives at `#recommend?case=dressipi`; absent data shows that this build does not include local research results, never third-party scores. The original `dressipi-protocol.json` remains historical preparation; `dressipi-local.json` defines this bounded pilot. Public publication remains disabled. No existing M5 or Ta Feng holdout is reopened.

Completed local pilot: `dressipi-20261013T085519500339Z`. On 1,000 complete April sessions, LightGBM MRR@100 = 0.08399357 and Recall@100 = 0.365; the strongest baseline MRR is co-occurrence (0.05540824), while anonymous attributes have baseline Recall 0.324. These are sampled development results, with different candidate/training scope from the competition. No official score is included in the UI.

## Frontend case explanations and M5 details

All four datasets now have a task-specific `view=data` page. M5 also has `models`, `report`, and `training` views inside the forecast case. The exporter includes the saved feature gains; the browser normalizes all 42 gains and labels them as training importance, not causal/ablation evidence. Reports preserve the three windows, all four methods and all twelve levels, including repeated levels caused by single-store scope. Training details show measured rows/times and distinguish implemented work from unrun tuning/SHAP/full ensembles. No training or holdout access was performed for these UI additions.

Validation: 38 frontend tests, 49 Python tests, syntax checks and public build passed. Desktop route/selector checks passed. Follow-up verification completed at 390×844 and 1440×1000. Mobile case tabs now wrap into three columns. M5 data/model/report/training/experience views, Dressipi model/session switching, UCI report tabs and Ta Feng data explanations fit the viewport; wide tables scroll inside their containers. Window/model changes and keyboard tab navigation were verified, with no browser console errors. Screenshots are saved under design/.


## Dressipi fixed-pool feature study

`npm run study:dressipi` uses `dressipi-study.json`, frozen before this study's evaluation, and the saved v2 run. All four variants share the source hashes, chronological splits, SHA-256 sampled cohorts, three retrieval channels, candidate pools, fitting queries and LambdaRank parameters. Three models are newly fitted: behavior (6 columns), attributes (5), and combined (9). The full 12-column model reuses the original saved booster and must reproduce every original top-100 list exactly. Both session context columns are shared across variants.

This is **ranking-side ablation**: the behavior variant still has an attribute-aware retrieval pool, and attribute-ranking ties use frozen purchase popularity. It is not an end-to-end removal of all information from another feature family. April already informed development; no fresh test or significance claim is made. Retrieval misses remain in all evaluation denominators.

The study saves the protocol and provenance before fitting, caches training/validation feature matrices, records their frozen hashes and training query identities, saves all four boosters and every validation ranking, and exports a recomputed report only after checks pass. `npm run export:dressipi` verifies the optional study pointer and ties it to the original run before adding a hashed `study.json` resource. An inconsistent study blocks export rather than silently falling back.

Diagnostics partition all sessions into candidate misses, retrieved targets below rank 100, ranks 11–100, and ranks 1–10. Fixed bins cover session length, target historical purchases, last-item attribute count, and view attribute coverage. Target popularity is used only for post-hoc grouping. Channel-exclusive hits describe coverage, not retrained channel-removal gains. Empty groups have no score.

Dressipi now has `experience`, `data`, `models`, `report`, and `training` tabs inside the recommendation case. The report includes channel coverage, diagnostic grouping, and four feature variants; the model page includes all 12 definitions and training gain shares; training records distinguish preparation, fit, prediction, and reused weights. Default public builds continue to omit all Dressipi result bundles.

Completed study: `dressipi-study-20261013T093700960231Z`. MRR@100 / Recall@100 / Recall@10: behavior 0.05991 / 33.3% / 10.1%; attributes 0.04351 / 32.5% / 9.0%; combined 0.08249 / 36.5% / 16.5%; full 0.08399 / 36.5% / 16.0%. Full-model failure stages contain 586 / 49 / 205 / 160 sessions respectively. Retrieval remains the principal coverage bottleneck. Attribute retrieval uniquely covers 240 targets; 517 targets have zero purchases in the sampled frozen statistics (not necessarily new items globally). All viewed items have attributes, so missing-coverage groups remain empty with null metrics.

验收：40 项前端测试、54 项 Python 测试、语法检查和公开构建通过。实际 390×844 与 1440×1000 视口检查通过，报告分组切换、空分组、模型／训练页和原体验模型切换正常；整页无横向溢出，宽表在容器内滚动，浏览器无错误。截图保存在 design/dressipi-diagnostics-mobile.jpg、design/dressipi-diagnostics-desktop.jpg、design/dressipi-ablation-desktop.jpg。
