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
