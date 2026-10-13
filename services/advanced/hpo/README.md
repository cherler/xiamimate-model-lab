# Offline AutoML / hyperparameter optimization

Optuna is the experiment engine; this is the **hyperparameter optimization portion of AutoML**, not a general automatic business-modeling platform. No customer upload, public train endpoint, automatic default-model replacement or cloud scheduler. NNI has broader NAS/compression/training-service features, but its official repository was archived on 2024-09-18, so the current project chooses Optuna for its existing Python trainers. Sources: https://github.com/microsoft/nni and https://optuna.org/ (checked 2026-10-13).

## Run and resume

From repository root, `uv sync --project services/advanced --python 3.12`, then:

```
npm run tune:lightgbm -- --name my-study
npm run tune:lightgcn -- --name my-study
npm run tune:tft -- --name my-study
npm run verify:tuning
npm run export:tuning
```

`--phase search` leaves the study open for more trials; `--trials 20` specifies a TOTAL attempt budget, including completed/pruned/failed trials. `--seconds` is an Optuna soft wall-time limit: the active trial may finish after that limit. `--phase evaluate` freezes the best completed validation trial and saves replay results. Default `all` searches, freezes and replays. A frozen study cannot be extended; use a new name. Repeating a completed version returns its saved replay. Configuration, dependency versions, data hash, original model versions, trainer and engine source hashes bind the study; changing them requires a new version. SQLite is for one local worker; a file lock blocks concurrent workers using the same study. Killed running trials become FAIL on resume, not successful results. The TPE sampler state is saved locally along with every terminal trial.

Defaults: LightGBM 12 trials / 900 seconds, LightGCN 8 / 1,200 seconds, TFT 8 / 1,500 seconds. All current runs use CPU and two training threads per process. Fixed budgets are a first measured search, not exhaustive optimization. The queued original-like and engineering candidate configurations are counted in the budget; remaining trials use TPE. Median pruning begins only after three startup trials and ten reported steps. Seed 42 controls the search; graph replay additionally uses seeds 43/44. Seeds are not a confidence interval.

## Time boundaries and objectives

- LambdaRank: train on June/July queries, validate on August next baskets; use **full-target** NDCG including targets not retrieved. Candidate pool, feature definitions, catalog and hash-selected users stay fixed. After selection, refit June/July/August labels with the selected tree count, then replay September-November snapshots.
- LightGCN: graph contains only interactions before August 1. August next baskets select hyperparameters and best epoch; every five epochs evaluate NDCG. Each September-November graph is refit from its own past with the frozen epoch count; never early-stop on replay outcomes. No new graph recall channel or attribute features are claimed.
- TFT: same 24 train-selected items; train before August, validate on all fixed seven-day sequences wholly in August. Optuna and early stopping use median **MAE**, with a constant validation target denominator, rather than the previous aggregate quantile loss. Fixed quantile loss still trains P10/P50/P90. Tunable normalization, encoder length, width, dropout, batch size, LR and past-only lag features are searched together. Lag >= 7 remains known across a seven-day forecast. Replayed outputs are nonnegative and monotonically rearranged; coverage and width are reported separately. Changing all unknown future target placeholders must not change predictions.

September-November UCI outcomes have already been seen in earlier work. These are **development replays, not independent tests**, even though this search does not use their scores to choose trials. AutoML cannot solve missing covariates, candidate recall limits, sparse series or validation overfitting by itself. A new unseen dataset/time interval is required for confirmation.

## Artifacts and presentation

`artifacts/advanced-studies/<model>-<name>/` contains protocol, SQLite, sampler, trials, checkpoints/traces, frozen selection and saved replay pointer. Locally retained source snapshots match protocol hashes. `artifacts/advanced-runs/hpo-*/` contains immutable replay report, selected model, samples, per-row predictions and checksums. No original pointer or prior model is overwritten. Generated data, databases and weights are ignored by Git. `#automl` displays a checksum-bound static export, complete/pruned/failed attempts, validation-only progress, exact same-cohort before/after metrics and real examples.

The initial LightGCN worker terminated at native-library initialization (exit 139) before a trial completed; that study directory remains preserved. Initializing Torch before the LightGBM OpenMP library resolved the conflict; the replacement is a separately named study, not a hidden successful trial.

Phase 2 now implements a bounded cross-model/feature-group comparison and accuracy/cost selection on common validation cohorts; see `../automl/README.md`. Broader joint feature/pipeline/hyperparameter search, external task queues and AutoDL GPU execution remain unimplemented. Automatic training is currently offline; visiting the website cannot start a job.
