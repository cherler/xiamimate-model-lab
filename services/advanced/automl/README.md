# Cross-model and feature selection (AutoML phase 2)

This is a small, explicit family/feature search on public UCI data. It adds model selection above the existing Optuna studies; it does not generate arbitrary architectures or infer business goals. No customer uploads, visitor-triggered training, AutoDL scheduler or automatic replacement of old defaults.

## Protocol fixed before running

- Recommendation: June/July labeled queries train the trees. All nine candidates score the **same** August returning-user queries and retrieved candidates. Full-target NDCG@10 selects configurations; missed retrieval targets remain in the denominator. Five LightGBM groups hold hyperparameters and tree count fixed: behavior, behavior+price, behavior+name, behavior+all attributes, full user/item matching. Decay, ItemCF, EASE and LightGCN complete the grid.
- Forecast: same 24 pre-August-selected products; training labels end before August. Seven candidates predict August 1/8/15/22 origins (672 non-overlapping product-days). All use WAPE on identical rows, rather than comparing TFT's overlapping training validation sequences against another model's monthly score. Candidates: last week, eight-week weekday median, Ridge, three LightGBM groups (history, +calendar, +historical price), fixed-config TFT. Product identity is held constant across tree groups.
- Previous Optuna parameters and epoch counts are fixed inputs, linked by hashes. TFT is freshly fitted for five fixed epochs with constant-rate Adam; no validation scheduler or checkpoint selection occurs in this stage. Its result need not reproduce the previous HPO checkpoint. This is **not nested validation**: previous August tuning informed these configurations.
- Select two preferences using validation alone: best accuracy; lowest cost among candidates within **1% relative** quality loss of best. Also show the accuracy/cost Pareto frontier. Failed candidates are preserved and excluded; incomplete candidate grids block publication. There is no guaranteed improvement.
- Cost = one fresh fit plus full validation scoring, measured sequentially on local CPU (two threads). Shared feature/catalog construction is measured separately. Startup, past HPO and data preparation are excluded. Rule methods consume precomputed shared features. Recommendation scoring includes record/metric calculation; forecast scoring times point prediction. Compare costs **within a task only**. Single-run wall time is noisy; this is not production latency, a memory benchmark or a GPU/cloud-price estimate.
- Freeze selection and validation hashes **before** preparing replay. Only selected configurations replay September/October/November. Trees for recommendation refit June/July/August labels at the fixed tree count; graphs use each origin's past. Forecast weights remain fitted before August; encoders/lag features read observations available before each replay origin.
- UCI replay outcomes have already informed earlier development; all results remain **development after prior feedback**, not independent confirmation or business gain. Ta Feng's consumed final test remains untouched.

## Commands and records

```sh
npm run train:automl
# Resume an interrupted run only if its code/config/dependency/data fingerprints still match:
npm run train:automl -- --resume automl-<saved-run-id>
npm run verify:automl
npm run export:automl
npm run build
```

`artifacts/advanced-runs/automl-*/` contains source snapshots, protocol, shared input bundles, candidate weights, validation rows, cost records, immutable selection and selected replay rows. `checksums.json` binds every saved file. The public export contains only the verified report, no weights or raw training data. `#automl` is phase 2; `#automl?view=tuning` preserves phase 1.

Workers for recommendation trees, recommendation graph, forecast trees and TFT run in separate sequential processes to avoid macOS OpenMP conflicts. Each worker has a 900-second timeout. Partial attempts remain on disk; a process failure stops publication rather than inventing a candidate score. A new code version creates a new run. Early development attempts preserved: `automl-20261013T023033192135Z` (native-library deadlock interrupted), `automl-20261013T023421414067Z` (scheduler compatibility failure before TFT fitting). They are not completed experiments or silently counted as successes.

## Further work (not implemented)

Unseen public dataset/time-range confirmation; multi-seed/repeated cost measurements; joint family/feature/hyperparameter budget allocation; graph candidate retrieval; richer covariates and forecasting interval calibration; optional AutoDL execution queue once measured workload warrants it. Feature-group differences here describe one fixed model setting, not causal importance or guaranteed feature usefulness.
