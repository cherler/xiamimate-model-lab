"""Purchase-event baselines, with every input strictly preceding the frozen origin."""
import numpy as np
import pandas as pd
from scipy import sparse

EXTRA_STRATEGIES = ['personal_frequency', 'personal_recent', 'personal_decay', 'hybrid']
LABELS = {'personal_frequency': '个人高频复购', 'personal_recent': '个人最近购买', 'personal_decay': '近期加权复购', 'hybrid': 'ALS＋复购融合'}


def build_personalized(train, users, items, origin, decay_days=90):
    if len(train) and train.date.max() >= pd.Timestamp(origin):
        raise ValueError('Future transaction passed to personal history builder')
    ui, ii = {v:i for i,v in enumerate(users)}, {v:i for i,v in enumerate(items)}
    events = train[train.customer.isin(users) & train.item.isin(items)].sort_values('date').drop_duplicates(['customer','item','invoice'], keep='last').copy()
    events['age'] = (pd.Timestamp(origin) - events.date).dt.total_seconds() / 86400
    events['decay'] = np.exp(-events.age / decay_days)
    grouped = events.groupby(['customer','item']).agg(frequency=('invoice','size'), age=('age','min'), decay=('decay','sum')).reset_index()
    grouped['recency'] = 1 / (1 + grouped.age)
    coordinates = grouped.customer.map(ui).to_numpy(), grouped.item.map(ii).to_numpy()
    return {key: sparse.csr_matrix((grouped[column].to_numpy(), coordinates), shape=(len(users),len(items))) for key,column in [('frequency_matrix','frequency'),('recency_matrix','recency'),('decay_matrix','decay')]}


def personal_scores(model, user, strategy):
    row = model.get('_user_index', {}).get(user)
    if row is None:
        row = model['users'].index(user)
    if strategy == 'hybrid':
        als = np.maximum(0, model['item_factors'] @ model['user_factors'][row]).astype(float)
        decay = model['decay_matrix'].getrow(row).toarray().ravel()
        weight = model['hybrid_als_weight']
        return weight * als / max(als.max(), 1e-12) + (1-weight) * decay / max(decay.max(), 1e-12)
    key = {'personal_frequency':'frequency_matrix','personal_recent':'recency_matrix','personal_decay':'decay_matrix'}[strategy]
    return model[key].getrow(row).toarray().ravel()
