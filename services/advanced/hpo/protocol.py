"""Reject time-boundary changes that would let replay labels drive selection."""
from datetime import date

def month_end(value):
    d=date.fromisoformat(value)
    return date(d.year+(d.month==12),d.month%12+1,1)

def validate_boundaries(config,base):
    rec=config['recommendation'];validation=date.fromisoformat(rec['validation_origin']);end=date.fromisoformat(rec['label_end'])
    if month_end(rec['validation_origin'])!=end:raise ValueError('Validation label end must match its next-basket month')
    if any(month_end(o)>validation for o in rec['training_origins']):raise ValueError('Training labels overlap validation')
    if end>min(map(date.fromisoformat,base['recommendation']['evaluation_origins'])):raise ValueError('Recommendation validation overlaps replay')
    f=config['forecast'];original=base['forecast']
    if f['train_end']!=original['train_end'] or f['validation_end']!=original['validation_end']:raise ValueError('Fixed forecast cohort preprocessing boundaries changed')
    if not date.fromisoformat(f['train_end'])<date.fromisoformat(f['validation_end'])<=min(map(date.fromisoformat,original['evaluation_origins'])):raise ValueError('Forecast validation overlaps replay')
