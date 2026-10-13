from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import sparse


def clean_transactions(frame: pd.DataFrame):
    """Exclusive, sequential removal audit; returns only valid positive sale lines."""
    df = frame.rename(columns={"Invoice": "invoice", "StockCode": "item", "Description": "name", "Quantity": "quantity", "InvoiceDate": "date", "Price": "price", "Customer ID": "customer", "Country": "country"}).copy()
    audit = {"raw_rows": len(df), "removed": []}

    def remove(name, mask):
        nonlocal df
        audit["removed"].append({"reason": name, "rows": int(mask.sum())})
        df = df.loc[~mask].copy()

    remove("duplicate_rows", df.duplicated())
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    for column in ["quantity", "price", "customer"]:
        df[column] = pd.to_numeric(df[column], errors="coerce")
    remove("invalid_date_or_numeric", df["date"].isna() | ~np.isfinite(df["quantity"]) | ~np.isfinite(df["price"]))
    df["invoice"] = df["invoice"].astype(str).str.strip()
    df["item"] = df["item"].astype(str).str.strip().str.upper()
    remove("cancelled_invoice", df["invoice"].str.upper().str.startswith("C"))
    remove("non_positive_quantity", df["quantity"] <= 0)
    remove("non_positive_price", df["price"] <= 0)
    remove("non_merchandise_code", ~df["item"].str.fullmatch(r"\d{5}[A-Z]{0,2}"))
    df["name"] = df["name"].fillna(df["item"]).astype(str).str.strip()
    df["customer"] = df["customer"].astype("Int64").astype("string")
    audit.update({"clean_rows": len(df), "missing_customer_rows": int(df["customer"].isna().sum()), "customers": int(df["customer"].nunique()), "items": int(df["item"].nunique()), "date_min": str(df["date"].min()), "date_max": str(df["date"].max()), "quantity_over_1000_rows_retained": int((df["quantity"] > 1000).sum())})
    return df, audit


def next_baskets(df, start, end):
    """At a fixed origin, predict each user's first future basket; tied timestamps merge."""
    window = df[(df.date >= pd.Timestamp(start)) & (df.date < pd.Timestamp(end)) & df.customer.notna()]
    first_time = window.groupby("customer").date.transform("min")
    first = window[window.date == first_time]
    return {str(user): set(rows.item) for user, rows in first.groupby("customer", sort=True)}


def build_itemcf(train, neighbors=64, shrinkage=10):
    train = train[train.customer.notna()]
    support = train.groupby("item").customer.nunique()
    items = sorted(support[support >= 2].index.tolist())
    users = sorted(train.customer.unique().tolist())
    item_index, user_index = {x: i for i, x in enumerate(items)}, {x: i for i, x in enumerate(users)}
    pairs = train[["customer", "item"]].drop_duplicates()
    pairs = pairs[pairs.item.isin(items)]
    x = sparse.csr_matrix((np.ones(len(pairs), dtype=np.float64), (pairs.customer.map(user_index), pairs.item.map(item_index))), shape=(len(users), len(items)))
    popularity = np.asarray(x.sum(axis=0)).ravel()
    co = (x.T @ x).tocoo()
    denom = np.sqrt(popularity[co.row] * popularity[co.col])
    values = co.data / np.maximum(denom, 1) * co.data / (co.data + shrinkage)
    matrix = sparse.csr_matrix((values, (co.row, co.col)), shape=(len(items), len(items)))
    matrix.setdiag(0); matrix.eliminate_zeros()
    ri, ci, vals = [], [], []
    for i in range(len(items)):
        begin, end = matrix.indptr[i:i + 2]
        idx, data = matrix.indices[begin:end], matrix.data[begin:end]
        selected = np.lexsort((idx, -data))[:neighbors]
        ri.extend([i] * len(selected)); ci.extend(idx[selected]); vals.extend(data[selected])
    matrix = sparse.csr_matrix((vals, (ri, ci)), shape=matrix.shape)
    # Histories and human-readable descriptions are built from training rows only.
    histories = {str(user): sorted(set(rows.item) & set(item_index)) for user, rows in train.groupby("customer")}
    names = train.sort_values("date").drop_duplicates("item", keep="last").set_index("item")["name"].to_dict()
    recent = {}
    for user, rows in train.sort_values("date").groupby("customer"):
        last = rows[rows.date == rows.date.max()]
        recent[str(user)] = list(dict.fromkeys(last.item.tolist()))
    return {"items": items, "histories": histories, "recent": recent, "names": names, "popularity": popularity, "matrix": matrix, "params": {"neighbors": neighbors, "shrinkage": shrinkage, "min_item_users": 2}}


def scores_for(model, user, strategy="itemcf", exclude=False, exploration=0):
    items = model["items"]
    index = {item: i for i, item in enumerate(items)}
    history = model["histories"].get(user, [])
    seeds = model["recent"].get(user, []) if strategy == "basket" else history
    indices = [index[x] for x in seeds if x in index]
    popularity = np.asarray(model["popularity"], dtype=float)
    fallback = not indices and strategy != "popular"
    if strategy == "popular" or fallback:
        score = popularity.copy()
    else:
        score = np.asarray(model["matrix"][indices].sum(axis=0)).ravel()
        if score.max(initial=0) <= 0:
            score = popularity.copy(); fallback = True
        else:
            # Popularity only breaks otherwise equal scores, not a tuned blend.
            score += popularity / max(popularity.max(), 1) * 1e-9
    if exploration and strategy != "popular" and not fallback:
        score = score / max(score.max(), 1e-12) + exploration / 100 * .2 * (1 - popularity / max(popularity.max(), 1))
    if exclude:
        score[[index[x] for x in history if x in index]] = -np.inf
    return score, fallback


def rank_items(model, user, strategy="itemcf", k=10, exclude=False, exploration=0):
    scores, fallback = scores_for(model, user, strategy, exclude, exploration)
    ranked = np.argsort(-scores, kind="stable")
    ranked = [int(i) for i in ranked if np.isfinite(scores[i])][:k]
    return ranked, scores, fallback


def ranking_metrics(ranked: list[str], target: set[str], k=10):
    hit = np.array([item in target for item in ranked[:k]], dtype=float)
    recall = float(hit.sum() / len(target)) if target else 0.0
    ideal = sum(1 / np.log2(i + 2) for i in range(min(k, len(target))))
    dcg = sum(value / np.log2(i + 2) for i, value in enumerate(hit))
    return {"recall": recall, "ndcg": float(dcg / ideal) if ideal else 0.0, "hit_rate": float(hit.sum() > 0)}


def evaluate_recommendations(model, targets, strategy, k=10):
    records, covered = [], set()
    vocabulary = set(model["items"])
    for user, target in targets.items():
        indices, _, fallback = rank_items(model, user, strategy, k=k)
        ranked = [model["items"][i] for i in indices]
        covered.update(ranked)
        records.append({"customer": user, "cohort": "warm" if model["histories"].get(user) else "cold", "target": sorted(target), "ranked": ranked, "oov_targets": len(target - vocabulary), "fallback": fallback, **ranking_metrics(ranked, target, k)})
    summary = {key: float(np.mean([row[key] for row in records])) for key in ["recall", "ndcg", "hit_rate"]}
    summary.update({"users": len(records), "catalog_coverage": len(covered) / len(vocabulary), "target_catalog_coverage": 1 - sum(r["oov_targets"] for r in records) / sum(len(r["target"]) for r in records), "fallback_users": sum(r["fallback"] for r in records)})
    summary["cohorts"] = {}
    for cohort in ["warm", "cold"]:
        subset = [r for r in records if r["cohort"] == cohort]
        summary["cohorts"][cohort] = {"users": len(subset), **{key: float(np.mean([r[key] for r in subset])) if subset else None for key in ["recall", "ndcg", "hit_rate"]}}
    return summary, records


def paired_bootstrap(base, candidate, key, seed=42, n=1000):
    assert [r["customer"] for r in base] == [r["customer"] for r in candidate]
    differences = np.array([c[key] - b[key] for b, c in zip(base, candidate)])
    rng = np.random.default_rng(seed)
    means = [differences[rng.integers(0, len(differences), len(differences))].mean() for _ in range(n)]
    low, high = np.quantile(means, [.025, .975])
    return {"difference": float(differences.mean()), "low": float(low), "high": float(high), "level": .95, "method": "paired bootstrap by customer", "resamples": n}
