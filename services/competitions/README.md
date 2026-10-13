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

Dataset terms currently block public lead-generation use without appropriate permission. Exact champion repository has not been verified; the verified MIT repository is **fourth place**, not first. No data has been downloaded. The project must not silently accept terms, use a mirror to bypass them, or label anonymous attribute codes as real product names.

Preparation can proceed without data: session-disjoint temporal evaluation, MRR@100/Recall@100, candidate filtering, popularity/co-occurrence baselines and schema validation. Once access and usage are resolved: baseline → attribute-aware LightGBM ranker → SIHG4SR reproduction in an isolated compatible environment → development-only tuning and one frozen evaluation. Report official third-party MRR 0.20762 separately, never as our result. Exact champion replication remains pending verified source availability.

## Local commands

```sh
npm run prepare:m5
npm run train:m5
npm run verify:m5
# After reviewing frozen development selection; one recorded reserved-window access:
npm run final:m5 -- --run-id m5-<saved-run-id>
npm run verify:m5
```

The import verifies the pinned archive Git blob and records SHA-256 for each whitelisted CSV. It never extracts `sales_test_evaluation.csv`. Development loads sales columns only through d_1913; reserved predictions and selection are persisted before d_1914–1941 labels are loaded. A store/origin access ledger survives run changes. Verification recomputes saved metrics without rereading reserved labels. Every run snapshots code, protocol, source/data/dependency hashes, cohort, predictions, models and costs. No competition export command is provided while public-use rights are unresolved.
