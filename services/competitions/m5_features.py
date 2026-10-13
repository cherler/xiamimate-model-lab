"""28-day nonrecursive features: every sales feature ends at least 28 days ago."""
import numpy as np
import pandas as pd


def make_features(metadata, history, calendar, prices, origin, training_window):
    if history.shape[1] != origin:
        raise ValueError('pass only observations at or before origin')
    first = max(180 + 28, origin - training_window)
    indexes = np.arange(first, origin + 28)  # zero-based target dates
    n, length = len(metadata), len(indexes)
    frame = {}
    categorical = []
    for col in ['item_id', 'dept_id', 'cat_id']:
        codes = pd.Categorical(metadata[col]).codes.astype('int16')
        frame[col] = np.repeat(codes, length)
        categorical.append(col)
    cal = calendar.iloc[indexes]
    dates = pd.to_datetime(cal.date)
    time_fields = {'wday': cal.wday, 'month': cal.month, 'year': cal.year,
                   'day_of_month': dates.dt.day, 'week_of_year': dates.dt.isocalendar().week,
                   'weekend': dates.dt.dayofweek.ge(5),
                   'snap': cal['snap_' + str(metadata.state_id.iloc[0])]}
    for col, values in time_fields.items():
        frame[col] = np.tile(np.asarray(values, dtype='int16'), n)
    for col in ['event_name_1', 'event_name_2', 'event_type_1', 'event_type_2']:
        codes = pd.Categorical(calendar[col].fillna('none')).codes
        frame[col] = np.tile(codes[indexes].astype('int16'), n)
        categorical.append(col)
    for lag in range(28, 43):
        frame[f'lag_{lag}'] = history[:, indexes - lag].reshape(-1)
    sales = pd.DataFrame(history.T)
    # At target index t, rolling window ends at t-28 inclusive.
    for window in [7, 14, 30, 60, 180]:
        roll = sales.rolling(window, min_periods=window)
        frame[f'rolling_mean_{window}'] = roll.mean().to_numpy(dtype='float32')[indexes - 28].T.reshape(-1)
        frame[f'rolling_std_{window}'] = roll.std().to_numpy(dtype='float32')[indexes - 28].T.reshape(-1)
    frame['sell_price'] = prices[:, indexes].reshape(-1)
    old_price = prices[:, indexes - 28]
    frame['price_ratio_28'] = np.divide(prices[:, indexes], old_price,
                                      out=np.full((n, length), np.nan, dtype='float32'), where=old_price > 0).reshape(-1)
    past_price = pd.DataFrame(prices[:, :origin].T).expanding().mean().to_numpy(dtype='float32')
    frame['price_history_mean'] = past_price[indexes - 28].T.reshape(-1)
    x = pd.DataFrame(frame)
    train_mask = np.tile(indexes < origin, n) & np.isfinite(frame['sell_price'])
    target = np.full((n, length), np.nan, dtype='float32')
    target[:, indexes < origin] = history[:, indexes[indexes < origin]]
    test_mask = np.tile(indexes >= origin, n)
    return x, target.reshape(-1), train_mask, test_mask, categorical


def baselines(history):
    if history.shape[1] < 56:
        raise ValueError('at least eight weeks required')
    weeks = history[:, -56:].reshape(len(history), 8, 7)
    return {'seasonal_naive': np.tile(history[:, -7:], (1, 4)),
            'weekday_median_8w': np.tile(np.median(weeks, axis=1), (1, 4)),
            'weekday_mean_8w': np.tile(weeks.mean(axis=1), (1, 4))}
