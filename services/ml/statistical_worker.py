"""Isolated, time-bounded statistical fits. JSON in/out, no unsafe model pickle."""
import json
import sys
import warnings
import numpy as np
from statsforecast.models import AutoETS, AutoARIMA


def fit_statistical(name, history, horizon):
    model = AutoETS(season_length=7, model='ZZZ') if name == 'autoets' else AutoARIMA(season_length=7, max_p=2, max_q=2, max_P=1, max_Q=1, max_order=5, nmodels=20, stepwise=True, approximation=True)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        prediction = np.maximum(0, model.forecast(np.asarray(history, dtype=float), h=horizon)['mean'])
    if not np.all(np.isfinite(prediction)):
        raise ValueError('Non-finite statistical forecast')
    return prediction.tolist()


if __name__ == '__main__':
    request = json.load(sys.stdin)
    output = []
    for history in request['histories']:
        try:
            output.append({'prediction': fit_statistical(request['model'], history, request['horizon']), 'failure': None})
        except Exception as error:
            output.append({'prediction': None, 'failure': f'{type(error).__name__}: {error}'})
    json.dump(output, sys.stdout, allow_nan=False)
