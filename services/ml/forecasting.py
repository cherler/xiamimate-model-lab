"""Train a direct 28-day Ridge forecast; future target sales never enter features."""
from __future__ import annotations

import json
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

HORIZON = 28
ALPHAS = [1.0, 100.0]
VALIDATION_ORIGIN = "2011-09-01"
TEST_ORIGINS = ["2011-10-01", "2011-10-29"]


def features(values, dates, origin, horizon, item_index, item_count):
    assert origin >= 56 and horizon >= 1
    past = values[:origin]  # The future is deliberately inaccessible below.
    target_date = dates[origin] + pd.Timedelta(days=horizon - 1)
    numeric = [np.log1p(past[-1]), np.log1p(past[-7]), np.log1p(past[-14]), np.log1p(past[-28]), np.log1p(past[-7:].mean()), np.log1p(past[-28:].mean()), np.log1p(past[-56:].mean()), np.log1p(past[-28:].std()), horizon / 28, np.sin(2 * np.pi * target_date.dayofweek / 7), np.cos(2 * np.pi * target_date.dayofweek / 7), np.sin(2 * np.pi * target_date.month / 12), np.cos(2 * np.pi * target_date.month / 12)]
    return numeric + [float(i == item_index) for i in range(item_count)]


def training_origins(cutoff_index, horizon=HORIZON):
    """Each origin has a complete target horizon strictly before cutoff."""
    return range(56, cutoff_index - horizon + 1, 7)


def forecast_metrics(actual, prediction):
    actual, prediction = np.asarray(actual), np.asarray(prediction)
    denominator = float(actual.sum())
    return {"mae": float(np.abs(actual - prediction).mean()), "wape": float(np.abs(actual - prediction).sum() / denominator) if denominator > 0 else None, "bias": float((prediction - actual).sum() / denominator) if denominator > 0 else None}


def train_forecasts(data, run, seed):
    uk = data[data.country == "United Kingdom"].copy()
    uk["day"] = uk.date.dt.normalize()
    before_val = uk[uk.day < VALIDATION_ORIGIN]
    # Fixed, train-only selection; no top performers chosen after seeing test errors.
    ranked = before_val.groupby("item").agg(active_days=("day", "nunique"), units=("quantity", "sum"))
    selected = ranked[ranked.active_days >= 100].sort_values(["units"], ascending=False, kind="stable").head(12).index.tolist()
    dates = pd.date_range(uk.day.min(), uk.day.max() - pd.Timedelta(days=1), freq="D")
    daily = uk[uk.item.isin(selected)].groupby(["day", "item"]).quantity.sum().unstack(fill_value=0).reindex(index=dates, columns=selected, fill_value=0).fillna(0)
    values = daily.to_numpy(dtype=float).T
    origin_idx = lambda date: int(dates.get_loc(pd.Timestamp(date)))

    def training(cutoff):
        stop = origin_idx(cutoff)
        x, y = [], []
        for item_index, series in enumerate(values):
            # All targets of each sample occur strictly before the cutoff.
            for origin in training_origins(stop):
                for horizon in range(1, HORIZON + 1):
                    x.append(features(series, dates, origin, horizon, item_index, len(selected)))
                    y.append(np.log1p(series[origin + horizon - 1]))
        return np.array(x), np.array(y)

    def predict(model, date):
        start = origin_idx(date)
        assert start + HORIZON <= len(dates)
        x = [features(series, dates, start, h, i, len(selected)) for i, series in enumerate(values) for h in range(1, HORIZON + 1)]
        prediction = np.maximum(0, np.expm1(model.predict(x))).reshape(len(selected), HORIZON)
        baseline = np.array([np.tile(series[start - 7:start], 4) for series in values])
        return values[:, start:start + HORIZON], prediction, baseline

    print("Training real sales forecast on 12 UK product series...", flush=True)
    x, y = training(VALIDATION_ORIGIN)
    selection = []
    for alpha in ALPHAS:
        model = make_pipeline(StandardScaler(), Ridge(alpha=alpha))
        model.fit(x, y)
        actual, pred, baseline = predict(model, VALIDATION_ORIGIN)
        selection.append({"alpha": alpha, "metrics": forecast_metrics(actual, pred)})
    best = min(selection, key=lambda result: result["metrics"]["wape"])
    series_output, rows, windows = [], [], []
    all_actual, all_pred, all_baseline = [], [], []
    for date in TEST_ORIGINS:
        x, y = training(date)
        model = make_pipeline(StandardScaler(), Ridge(alpha=best["alpha"]))
        model.fit(x, y)
        actual, pred, baseline = predict(model, date)
        windows.append({"origin": date, "end": str((pd.Timestamp(date) + pd.Timedelta(days=27)).date()), "training_examples": len(x), "baseline": forecast_metrics(actual, baseline), "ridge": forecast_metrics(actual, pred)})
        all_actual.extend(actual.ravel()); all_pred.extend(pred.ravel()); all_baseline.extend(baseline.ravel())
        start = origin_idx(date)
        descriptions = uk[uk.day < date].sort_values("date").drop_duplicates("item", keep="last").set_index("item")["name"].to_dict()
        for i, item in enumerate(selected):
            series_output.append({"item": item, "name": descriptions.get(item, item), "origin": date, "history_dates": [str(d.date()) for d in dates[start - 56:start]], "history": values[i, start - 56:start].tolist(), "dates": [str(d.date()) for d in dates[start:start + 28]], "actual": actual[i].tolist(), "baseline": baseline[i].tolist(), "prediction": np.round(pred[i], 6).tolist(), "baseline_metrics": forecast_metrics(actual[i], baseline[i]), "model_metrics": forecast_metrics(actual[i], pred[i])})
            for h in range(HORIZON):
                rows.append({"item": item, "origin": date, "date": str(dates[start + h].date()), "actual": actual[i, h], "baseline": baseline[i, h], "ridge": pred[i, h]})
        scaler, ridge = model.steps[0][1], model.steps[1][1]
        np.savez(run / f"forecast-ridge-{date}.npz", mean=scaler.mean_, scale=scaler.scale_, coef=ridge.coef_, intercept=ridge.intercept_)
    pd.DataFrame(rows).to_csv(run / "forecast-predictions.csv.gz", index=False)
    (run / "forecast-series.json").write_text(json.dumps(series_output, ensure_ascii=False, allow_nan=False))
    summary = {"dataset": "UCI Online Retail II", "scope": "United Kingdom, positive merchandise sale quantities, 12 training-selected active high-volume SKUs", "model": "StandardScaler + Ridge on log1p daily sales, direct 28-day horizon", "baseline_name": "Repeat the last observed week four times", "validation_origin": VALIDATION_ORIGIN, "selection": selection, "selected_alpha": best["alpha"], "windows": windows, "items": selected, "rows_evaluated": len(rows), "baseline": forecast_metrics(all_actual, all_baseline), "ridge": forecast_metrics(all_actual, all_pred), "evidence_level": "offline", "data_origin": "public", "limitations": ["Not M5; no stock, lead-time or promotion data. Gross recorded sale quantities are not unconstrained demand.", "Missing transaction days filled with zero; cannot distinguish no orders from closure or missing collection.", "12 active high-volume products selected before validation; not representative of the full catalog.", "Two non-overlapping 28-day rolling test windows; model refits on history available before each window, alpha stays fixed from validation.", "No calibrated prediction intervals; no financial savings claims.", "Ridge uses log targets; back-transform may underpredict spikes. A candidate can perform worse than the seasonal baseline."]}
    print(f"Forecast WAPE: baseline={summary['baseline']['wape']:.5f}, Ridge={summary['ridge']['wape']:.5f}", flush=True)
    return summary
