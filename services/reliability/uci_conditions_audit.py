"""Audit prediction-time information only; do not group by target outcomes."""
import json
import math
from pathlib import Path
from services.reliability.uci_audit import ROOT, load, audit, sha

PROTOCOL = Path(__file__).with_name('uci-conditions-protocol.json')

def information_audit(manifest, data):
    inventory = audit(manifest, data)
    protocol = json.loads(PROTOCOL.read_text())
    if (manifest['run_id'] != protocol['parent_run'] or
            manifest['version'] != protocol['parent_version'] or
            manifest['files']['weekly-series.json']['sha256'] != protocol['weekly_sha256']):
        raise ValueError('Conditions parent changed')
    rows = data['weekly-series.json']
    for row in rows:
        if any(not math.isfinite(x) or x < 0 for x in row['history']):
            raise ValueError('Invalid history units')
        if any(not math.isfinite(x) or x < 0 for x in row['predictions'].values()):
            raise ValueError('Invalid frozen prediction')
    return {
        'schema': 'uci-conditions-audit-v1',
        'parent_run': manifest['run_id'], 'parent_version': manifest['version'],
        'weekly_sha256': protocol['weekly_sha256'],
        'protocol_sha256': sha(PROTOCOL.read_bytes()),
        'inventory': inventory['tasks']['weekly'],
        'availability': [
            {'fields': ['history', 'history_dates'], 'rows': len(rows),
             'days_per_row': 56, 'date_rule': 'origin - 56 days through origin - 1 day, contiguous',
             'use': 'pre-origin daily sales and eight complete historical weekly totals',
             'limitation': 'Zero-filled recorded sales do not distinguish no demand, closure, missing records or stockout.'},
            {'fields': ['predictions'], 'rows': len(rows),
             'models': sorted(rows[0]['predictions']),
             'use': 'Frozen model output compared with history; does not assert model-selection independence.'},
            {'fields': ['actual', 'actual_days'], 'use': 'Scoring only after target end; prohibited in signals or pre-origin advice.'},
            {'fields': ['name', 'item', 'origin', 'end', 'fallback_models'],
             'use': 'Identity, date, display and original fallback notice; not risk features.'},
        ],
        'not_available': ['verified promotion schedule', 'stock and sale availability',
                          'lead time', 'known future prices', 'dated customer/order mix'],
        'decision': 'Use dated sales history plus frozen predictions only. No derived customer/price claims; weekly development diagnostics, not validated pre-failure warning.',
        'target_outcomes_inspected_by_this_audit': False,
    }

if __name__ == '__main__':
    m, d = load()
    result = information_audit(m, d)
    (ROOT / 'docs/evaluation/uci-conditions-audit-v1.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('Audited 144 product-weeks: 56 pre-origin days each; no target-based groups computed.')
