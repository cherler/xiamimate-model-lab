# Advanced public-data experiments

This isolated environment and new artifacts preserve the existing UCI and Ta Feng releases. UCI dates have already informed earlier work: every result here is **development after prior feedback**, not a fresh independent test. No customer-data upload or main-site integration.

## Setup and ranking

From project root:

```sh
uv sync --project services/advanced --python 3.12
services/advanced/.venv/bin/python services/advanced/ranking.py
services/advanced/.venv/bin/python services/advanced/verify.py ranking
```

UCI UK positive sales, history from 2010-12-01; training queries at June/July/August 2011 origins have their entire next-month labels before September. Evaluation origins September/October/November are development windows. Each snapshot selects up to 2,000 items by past customer support and 800 customers by a fixed hash before outcomes; only their returning warm-user queries are scored. Preserve non-return counts. This differs from previous experiments: do not compare raw metrics across cohorts.

Fixed candidates union 60 personal decay, 60 ItemCF and 40 popularity, with duplicates removed and no target injection. Targets outside catalog/pool remain in recall denominators. Three identical LambdaRank settings compare behavior, behavior + historical price/name attributes, then + user/item price and TF-IDF matching. TF-IDF is fitted separately on each past snapshot; cosine similarity is comparable across snapshots, unlike arbitrarily rotating text components. Historical transaction prices are not current shelf prices; lexical keyword flags are not curated merchandise categories.

Seeds, configuration, model weights, reload checks, complete ranked outputs, samples, snapshot inputs, source/dependency hashes and per-window statistics are persisted to ignored `artifacts/advanced-runs/`. Pointer files update only after successful completion. Earlier failed/incomplete directories remain separate. Raw data and generated training artifacts are not committed.

The `deep` dependencies are isolated here so earlier frozen environment lockfiles stay unchanged. Current neural model configuration is predeclared in `config.json`; configuration is not evidence that a model has been trained.

## LightGCN graph scoring

Run `services/advanced/.venv/bin/python services/advanced/graph.py`, then `services/advanced/.venv/bin/python services/advanced/verify.py graph`. It reads checksum-verified snapshots and the same candidates from the ranking run, trains 32-dimensional, two-layer LightGCN with BPR and three seeds, and evaluates EASE on the same pool. Rejected negatives exclude all prior observed edges. Checkpoint reload and exact degree normalization are tested. Seed variation is not a confidence interval; standard LightGCN uses interactions, not product attributes. This experiment evaluates scoring within a fixed retrieval pool, not an additional graph recall channel.

Neural unit checks: `services/advanced/.venv/bin/python -m unittest discover -s services/advanced/tests -v`.

## TFT multi-horizon forecasting

Run `services/advanced/.venv/bin/python services/advanced/forecast.py`, then `services/advanced/.venv/bin/python services/advanced/verify.py tft`. Actual PyTorch Forecasting TFT trains on 56-day encoders and 7-day horizons, with static item/historical price, known future calendar and observed-only quantity. Item selection, price metadata, scalers and normalizers use data before August 2011. August validation controls early stopping; September/October/November are development windows. Twenty-four train-selected products produce 504 scored product-days. Zero-filled missing transaction days do not imply observed zero demand.

Compare with the same-scope LightGBM L1, last-week and eight-week weekday median baselines. LightGBM runs in a separate process to avoid macOS OpenMP conflicts with Torch. Saved tree reload predictions agree; changing all future unknown target placeholders must not change TFT output. Persist checkpoints, dataset preprocessing, tree inputs/model, every forecast, quantiles, validation trace and file hashes.

Quantiles are clipped nonnegative and rearranged monotonically. Report pinball loss, empirical coverage and width; marginal daily intervals cannot be added into calibrated weekly intervals. This small one-seed CPU experiment is not proof of deep-model superiority. Current run `tft-20261013T003238011371Z`: TFT WAPE 85.84%, weekday-median 79.94%, same-scope LightGBM 83.73%; P10-P90 coverage 73.41% vs nominal 80%. Do not present these as independent test results or inventory optimization guarantees.

## Frozen sample explanations

`npm run explain:advanced` replays the three saved runs and exports a new static version. It does not fit weights or update training reports. The command runs tree, graph and TFT explanations in separate processes, then publishes checksum-bound JSON. Run it after generating the original ranking, graph and TFT artifacts. A stale explanation/source combination fails export and build.

- Trees: exact TreeSHAP score conservation for three LambdaRank versions (all nine displayed customer windows, Top 10 plus the cutoff competitor), and all 504 same-scope LightGBM forecast rows. Scores are raw margins or units/day before nonnegative clipping, never purchase probabilities.
- Graph: decompose the user-side mean of layers 0/1/2 against the fixed final item embedding into the initial user term and contributions through each directly purchased neighbor. Compare all three seeds' within-pool ranks. This is not edge deletion, retraining, or a causal purchase rationale.
- TFT: restore checkpoint and dataset preprocessing, reconstruct inputs only from saved 56-day histories, training price and known calendar, and check all quantiles against original outputs. Export static/history/decoder variable-selection weights, per-day encoder attention (head mean, retaining decoder attention mass), and a declared sensitivity replay replacing the most recent seven history days with the earlier seven-week weekday medians. Actual future sales are used only for equality checks and retrospective error/coverage display, never input construction. Attention and selection weights do not add up to output units or causal contributions.

The panels cover the original advanced runs; AutoML-selected models, other task scopes and future runs need their own checkpoint-bound exports. `npm run test:deep` and `node --test tests/advanced*.test.mjs` check conservation, source binding and sample correspondence. Explanation JSON is ignored training-derived output, not committed raw data.
