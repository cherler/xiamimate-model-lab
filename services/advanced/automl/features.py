"""Explicit, bounded feature-group search; every time series input precedes origin."""
import numpy as np

REC_GROUPS = {
    'behavior': list(range(7)),
    'price': list(range(9)),
    'text': list(range(7)) + list(range(9,22)),
    'attributes': list(range(22)),
    'cross': list(range(26)),
}
REC_NAMES = {'behavior':'行为统计','price':'行为＋历史价格','text':'行为＋商品名称','attributes':'行为＋全部商品属性','cross':'行为＋属性＋用户匹配'}
STAT_NAMES = ['last','lag7','lag14','lag28','mean7','mean28','mean56','std28','max28','weekday_median','weekday_mean','horizon','zero_share28']
CAL_NAMES = ['weekday_sin','weekday_cos','month_sin','month_cos']


def forecast_features(history, horizon, date, price, item_index, item_count):
    history = np.asarray(history)
    if len(history) < 56 or not 1 <= horizon <= 7:
        raise ValueError('Need 56 observed days and a seven-day horizon')
    weekday = history[-56:][(np.arange(-56,0)-(horizon-1))%7 == 0]
    stats = [history[-1], history[-7], history[-14], history[-28], history[-7:].mean(),
             history[-28:].mean(), history[-56:].mean(), history[-28:].std(), history[-28:].max(), np.median(weekday), weekday.mean()]
    return [*np.log1p(stats), horizon/7, float((history[-28:]==0).mean()),
            np.sin(2*np.pi*date.dayofweek/7), np.cos(2*np.pi*date.dayofweek/7),
            np.sin(2*np.pi*date.month/12), np.cos(2*np.pi*date.month/12), price,
            *[float(i == item_index) for i in range(item_count)]]


def forecast_columns(group, items):
    identity = list(range(18,18+items))
    if group == 'history': return list(range(13)) + identity
    if group == 'calendar': return list(range(17)) + identity
    if group == 'full': return list(range(18)) + identity
    raise ValueError('Unknown forecast feature group')
