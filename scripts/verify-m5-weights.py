"""Compare reconstructed revenue weights with archived organizer weights, no test labels."""
import json
import sys
import zipfile
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.competitions.m5_data import RAW, ROOT, digest, write

origin = 1913
days = [f'd_{d}' for d in range(origin - 27, origin + 1)]
sales = pd.read_csv(RAW / 'sales_train_evaluation.csv', usecols=['item_id', 'store_id'] + days)
calendar = pd.read_csv(RAW / 'calendar.csv').iloc[origin - 28:origin]
prices = pd.read_csv(RAW / 'sell_prices.csv').set_index(['store_id', 'item_id', 'wm_yr_wk']).sell_price
revenue = np.zeros(len(sales))
training_precision_revenue = np.zeros(len(sales))
for j, week in enumerate(calendar.wm_yr_wk):
    keys = pd.MultiIndex.from_arrays([sales.store_id, sales.item_id, np.full(len(sales), week)])
    price = prices.reindex(keys).to_numpy()
    units = sales[days[j]].to_numpy()
    if ((units > 0) & ~np.isfinite(price)).any():
        raise ValueError('missing price for sales')
    revenue += np.nan_to_num(units * price)
    training_precision_revenue += np.nan_to_num(units.astype('float32') * price.astype('float32'))
with zipfile.ZipFile(RAW / 'm5.zip') as archive:
    weights = pd.read_csv(archive.open('weights_validation.csv'))
reference = weights[weights.Level_id.eq('Level12')].set_index(['Agg_Level_1', 'Agg_Level_2'])
reference = reference.reindex(pd.MultiIndex.from_frame(sales[['item_id', 'store_id']]))
error = float(np.max(np.abs(revenue / revenue.sum() - reference.weight.to_numpy())))
training_error = float(np.max(np.abs(training_precision_revenue / training_precision_revenue.sum() - reference.weight.to_numpy())))
if not np.isfinite(error) or error >= 1e-12:
    raise ValueError(f'weight mismatch: {error}')
if not np.isfinite(training_error) or training_error >= 1e-8:
    raise ValueError(f'training precision weight mismatch: {training_error}')
report = {'origin': origin, 'series': len(sales),
          'comparison': 'past-28-day sales-dollar weights vs archived weights_validation Level12',
          'max_absolute_weight_error': error, 'float32_training_path_max_absolute_weight_error': training_error,
          'archive_sha256': digest(RAW / 'm5.zip'),
          'read_any_test_targets': False}
write(ROOT / 'artifacts/competition-m5-weight-audit.json', report)
print(json.dumps(report, indent=2))
