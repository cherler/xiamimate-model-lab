from __future__ import annotations

import hashlib
import json
import platform
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd
import scipy
import sklearn
from scipy import sparse

from prepare_data import prepare, ROOT
from ml.core import build_itemcf, next_baskets, evaluate_recommendations, paired_bootstrap

CONFIG = {
    "seed": 42, "k": 10,
    "validation_start": "2011-09-01", "validation_end": "2011-10-01",
    "test_start": "2011-10-01", "test_end": "2011-11-01",
    "candidate_grid": [{"neighbors": 64, "shrinkage": 10}, {"neighbors": 64, "shrinkage": 50}],
    "selection_metric": "validation NDCG@10", "exclude_purchased": False,
    "exploration": 0, "candidate_catalog": "all training items with >=2 distinct buyers; no sampled negatives",
    "task": "At fixed origin, predict each customer's first basket in the next month; repeat purchases allowed. No within-test history updates.",
}


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")


def main():
    start = time.perf_counter()
    data, audit = prepare()
    rec = data[data.customer.notna()].copy()
    run_id = datetime.now(timezone.utc).strftime("retail-%Y%m%dT%H%M%SZ")
    run = ROOT / "artifacts/runs" / run_id
    run.mkdir(parents=True, exist_ok=False)
    write_json(run / "config.json", CONFIG)
    write_json(run / "data-audit.json", audit)
    train = rec[rec.date < pd.Timestamp(CONFIG["validation_start"])]
    val_targets = next_baskets(rec, CONFIG["validation_start"], CONFIG["validation_end"])
    assert len(train) and val_targets, "Training / validation data is empty"
    validation = []
    for params in CONFIG["candidate_grid"]:
        print(f"Validation fit: {params}", flush=True)
        model = build_itemcf(train, **params)
        metrics, _ = evaluate_recommendations(model, val_targets, "itemcf", CONFIG["k"])
        validation.append({"params": params, "metrics": metrics})
        print(f"Validation NDCG@10 = {metrics['ndcg']:.5f}", flush=True)
    best = max(validation, key=lambda result: result["metrics"]["ndcg"])
    val_pop, _ = evaluate_recommendations(model, val_targets, "popular", CONFIG["k"])
    print(f"Selected on validation only: {best['params']}. Fitting final model...", flush=True)
    final_train = rec[rec.date < pd.Timestamp(CONFIG["test_start"])]
    final_model = build_itemcf(final_train, **best["params"])
    targets = next_baskets(rec, CONFIG["test_start"], CONFIG["test_end"])
    assert targets and final_train.date.max() < pd.Timestamp(CONFIG["test_start"])
    test_metrics, record_sets = {}, {}
    for name in ["popular", "itemcf", "basket"]:
        summary, records = evaluate_recommendations(final_model, targets, name, CONFIG["k"])
        test_metrics[name] = summary; record_sets[name] = records
        rows = [{**r, "target": json.dumps(r["target"]), "ranked": json.dumps(r["ranked"])} for r in records]
        pd.DataFrame(rows).to_csv(run / f"test-predictions-{name}.csv.gz", index=False)
        print(f"Test {name}: recall={summary['recall']:.5f}, NDCG={summary['ndcg']:.5f}, users={summary['users']}", flush=True)
    intervals = {key: paired_bootstrap(record_sets["popular"], record_sets["itemcf"], key, CONFIG["seed"]) for key in ["recall", "ndcg"]}
    sparse.save_npz(run / "itemcf.npz", final_model["matrix"])
    np.save(run / "popularity.npy", final_model["popularity"], allow_pickle=False)
    # Public demo sample selected from training histories, not test outcomes.
    eligible = sorted(user for user, hist in final_model["histories"].items() if len(hist) >= 3)
    rng = np.random.default_rng(CONFIG["seed"])
    demo_users = sorted(rng.choice(eligible, min(24, len(eligible)), replace=False).tolist())
    model_info = {key: value for key, value in final_model.items() if key not in ["matrix", "popularity"]}
    model_info.update({"demo_users": demo_users, "run_id": run_id, "as_of": CONFIG["test_start"]})
    write_json(run / "model.json", model_info)
    training_rows = final_train.sort_values("date")
    profiles = {}
    for user in demo_users:
        rows = training_rows[training_rows.customer == user].drop_duplicates("item", keep="last").tail(6)
        profiles[user] = [{"id": row["item"], "name": row["name"], "date": str(row["date"]), "quantity": float(row["quantity"])} for _, row in rows.iterrows()]
    write_json(run / "profiles.json", profiles)
    report = {
        "run_id": run_id, "data_origin": "public", "evidence_level": "offline", "dataset": "UCI Online Retail II",
        "generated_at": datetime.now(timezone.utc).isoformat(), "source": audit, "config": CONFIG,
        "selection": {"candidates": validation, "baseline": val_pop, "selected_params": best["params"], "selected_before_test": True},
        "training": {"initial_rows": len(train), "final_rows": len(final_train), "final_users": len(final_model["histories"]), "catalog_items": len(final_model["items"]), "last_event": str(final_train.date.max())},
        "test": test_metrics, "paired_difference_ci95": intervals,
        "definitions": {"recall": "Mean per-customer fraction of full next-basket items retrieved in top 10 (out-of-vocabulary targets remain misses).", "ndcg": "Binary relevance NDCG@10, ideal DCG uses min(10, full basket size).", "catalog_coverage": "Distinct items in all top-10 recommendations / frozen training catalog size.", "bootstrap": "Paired differences resampled by customer, 1000 resamples, seed 42; no guarantee for future periods.", "baseline": "Distinct historical buyers per item, training-only; ties ordered by item code.", "basket": "Same learned ItemCF similarities, seeds restricted to most recent training basket; evaluated as an additional fixed policy, not tuned on test."},
        "limitations": ["Historical offline evaluation, not a randomized business experiment or revenue proof.", "Observed purchases reflect historical exposure; no exposure probabilities are available.", "Repeat purchases are allowed in this evaluation; changing exclusion or exploration changes the policy and is not covered by these scores.", "Customers without usable training history receive popular fallback; unseen future items remain in metric denominators.", "Positive sale lines exclude cancellations and non-positive rows; this does not reconstruct net profit or true demand.", "Single held-out calendar month; effects may change in other seasons and businesses."],
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "scipy": scipy.__version__, "sklearn": sklearn.__version__},
    }
    from ml.forecasting import train_forecasts
    report["forecast"] = train_forecasts(data, run, CONFIG["seed"])
    source_files = [ROOT / "services/train.py", ROOT / "services/prepare_data.py", *sorted((ROOT / "services/ml").glob("*.py")), ROOT / "uv.lock"]
    snapshots = run / "source"; snapshots.mkdir()
    report["code_sha256"] = {}
    for path in source_files:
        destination = snapshots / path.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        report["code_sha256"][str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    report["duration_seconds"] = round(time.perf_counter() - start, 2)
    write_json(run / "report.json", report)
    integrity = {str(p.relative_to(run)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(run.rglob("*")) if p.is_file()}
    write_json(run / "checksums.json", integrity)
    # Publish only a complete run; a failed rerun cannot replace a working artifact.
    temp = ROOT / "artifacts/latest.json.tmp"
    write_json(temp, {"run_id": run_id})
    temp.replace(ROOT / "artifacts/latest.json")
    print(f"Complete: {run}\nElapsed: {report['duration_seconds']}s", flush=True)


if __name__ == "__main__":
    main()
