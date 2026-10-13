"""Local artifact-backed inference and static UI; training never runs in requests."""
from __future__ import annotations
import os
for variable in ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"]:
    os.environ[variable] = "2"
import argparse
import hashlib
import json
import mimetypes
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import numpy as np
from scipy import sparse
from ml.recommenders import rank_items, STRATEGIES
from ml.personalized import EXTRA_STRATEGIES

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'apps/web'


class Artifacts:
    def __init__(self, root=ROOT):
        self.root, self.run_id, self.model = root, None, None

    def load(self):
        pointer = json.loads((self.root / 'artifacts/latest.json').read_text())
        run_id = pointer['run_id']
        if not re.fullmatch(r'retail-\d{8}T\d{6}Z', run_id):
            raise ValueError('Invalid run identifier')
        if run_id == self.run_id:
            return self
        run = self.root / 'artifacts/runs' / run_id
        integrity = json.loads((run / 'checksums.json').read_text())
        required = ['model.json', 'report.json', 'profiles.json', 'forecast-series.json', 'itemcf.npz', 'popularity.npy']
        for name in required:
            if hashlib.sha256((run / name).read_bytes()).hexdigest() != integrity[name]:
                raise ValueError(f'Artifact integrity check failed: {name}')
        model = json.loads((run / 'model.json').read_text())
        model['matrix'] = sparse.load_npz(run / 'itemcf.npz')
        model['popularity'] = np.load(run / 'popularity.npy', allow_pickle=False)
        report = json.loads((run / 'report.json').read_text())
        if report.get('schema_version', 1) >= 2:
            for name in ['als.npz', 'ease.npy']:
                if hashlib.sha256((run / name).read_bytes()).hexdigest() != integrity[name]:
                    raise ValueError(f'Artifact integrity check failed: {name}')
            with np.load(run / 'als.npz', allow_pickle=False) as factors:
                model['user_factors'] = factors['user_factors']
                model['item_factors'] = factors['item_factors']
            model['ease_weights'] = np.load(run / 'ease.npy', allow_pickle=False)
            size = len(model['items'])
            if model['ease_weights'].shape != (size, size) or model['item_factors'].shape[0] != size or model['user_factors'].shape[0] != len(model['users']):
                raise ValueError('Model/catalog shape mismatch')
            model['_user_index'] = {user: i for i, user in enumerate(model['users'])}
            model['_item_index'] = {item: i for i, item in enumerate(model['items'])}
        weekly, diagnostics = None, None
        if report.get('schema_version') == 3:
            for name in ['frequency_matrix.npz','recency_matrix.npz','decay_matrix.npz','weekly-series.json','diagnostics.json']:
                if hashlib.sha256((run / name).read_bytes()).hexdigest() != integrity[name]:
                    raise ValueError(f'Artifact integrity check failed: {name}')
            for key in ['frequency_matrix','recency_matrix','decay_matrix']:
                model[key] = sparse.load_npz(run / f'{key}.npz')
                if model[key].shape != (len(model['users']),len(model['items'])):
                    raise ValueError('Personal history/catalog shape mismatch')
            weekly = json.loads((run / 'weekly-series.json').read_text())
            diagnostics = json.loads((run / 'diagnostics.json').read_text())
        profiles = json.loads((run / 'profiles.json').read_text())
        forecast = json.loads((run / 'forecast-series.json').read_text())
        self.model, self.report, self.profiles, self.forecast = model, report, profiles, forecast
        self.weekly, self.diagnostics = weekly, diagnostics
        self.run_id, self.run = run_id, run
        return self

    def recommend(self, payload):
        if not isinstance(payload, dict):
            raise ValueError('Request must be a JSON object')
        user = payload.get('customer_id', 'new')
        strategy = payload.get('strategy', 'itemcf')
        k = payload.get('limit', 10)
        exclude = payload.get('exclude_purchased', False)
        exploration = payload.get('exploration', 0)
        if not isinstance(user, str) or not re.fullmatch(r'(new|\d{1,10})', user):
            raise ValueError('customer_id must be new or a numeric ID')
        available = STRATEGIES + EXTRA_STRATEGIES if self.model.get('schema_version') == 3 else STRATEGIES if self.model.get('schema_version') == 2 else STRATEGIES[:3]
        if strategy not in available:
            raise ValueError('Unknown strategy')
        if type(k) is not int or not 1 <= k <= 20:
            raise ValueError('limit must be an integer from 1 to 20')
        if type(exclude) is not bool:
            raise ValueError('exclude_purchased must be boolean')
        if type(exploration) is not int or not 0 <= exploration <= 100:
            raise ValueError('exploration must be an integer from 0 to 100')
        started = time.perf_counter()
        model = self.model
        indices, scores, fallback = rank_items(model, user, strategy, k, exclude, exploration)
        index = {item: i for i, item in enumerate(model['items'])}
        seeds = model['recent'].get(user, []) if strategy == 'basket' else model['histories'].get(user, [])
        seeds = [item for item in seeds if item in index]
        items = []
        for position in indices:
            item = model['items'][position]
            reason = {'type': 'historical_popularity', 'buyers': int(model['popularity'][position])}
            if strategy in EXTRA_STRATEGIES and not fallback:
                row = model['_user_index'][user]
                recency = float(model['recency_matrix'][row,position])
                reason = {'type':'personal_history','purchase_events':int(model['frequency_matrix'][row,position]),'days_since_purchase':1/recency-1 if recency else None,'decayed_events':float(model['decay_matrix'][row,position]),'hybrid_als_weight':model['hybrid_als_weight'] if strategy=='hybrid' else None,'exploration':exploration}
            elif strategy == 'als' and not fallback:
                reason = {'type': 'latent_factors', 'factors': int(model['item_factors'].shape[1]), 'exploration': exploration}
            elif strategy == 'ease' and not fallback and seeds:
                contributions = model['ease_weights'][[index[s] for s in seeds], position]
                best = int(np.argmax(contributions))
                seed = seeds[best]
                reason = {'type': 'linear_contributions', 'seed_id': seed, 'seed_name': model['names'][seed], 'weight': float(contributions[best]), 'positive_sum': float(contributions[contributions > 0].sum()), 'negative_sum': float(contributions[contributions < 0].sum()), 'exploration': exploration}
            elif strategy != 'popular' and not fallback and seeds:
                contributions = model['matrix'][[index[s] for s in seeds], position].toarray().ravel()
                best = int(np.argmax(contributions))
                if contributions[best] > 0:
                    seed = seeds[best]
                    reason = {'type': 'learned_similarity', 'seed_id': seed, 'seed_name': model['names'][seed], 'similarity': float(contributions[best]), 'exploration': exploration}
                else:
                    reason = {'type': 'exploration_or_tiebreak', 'buyers': int(model['popularity'][position])}
            items.append({'id': item, 'name': model['names'].get(item, item), 'score': float(scores[position]), 'purchased_before': item in model['histories'].get(user, []), 'reason': reason})
        return {'run_id': self.run_id, 'as_of': model['as_of'], 'data_origin': 'public', 'customer_id': user, 'strategy': strategy, 'fallback': fallback, 'fallback_reason': 'No usable history or similarity signal' if fallback else None, 'evaluation_policy_matches': not exclude and exploration == 0 and k == 10, 'history': self.profiles.get(user, []), 'history_items': len(model['histories'].get(user, [])), 'items': items, 'elapsed_ms': round((time.perf_counter() - started) * 1000, 2)}


ARTIFACTS = Artifacts()


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, data, mime='application/json; charset=utf-8', filename=None):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path.startswith('/api/'):
            try:
                # Single handler lock keeps hot reload atomic for simultaneous requests.
                with self.server.artifact_lock:
                    store = ARTIFACTS.load()
                    if path == '/api/v1/health':
                        result = {'status': 'ready', 'run_id': store.run_id, 'data_origin': 'public'}
                    elif path == '/api/v1/experiments/latest':
                        result = store.report
                    elif path == '/api/v1/customers':
                        result = {'customers': store.model['demo_users'], 'profiles': store.profiles, 'as_of': store.model['as_of'], 'run_id': store.run_id}
                    elif path == '/api/v1/forecasts':
                        result = {'summary': store.report['forecast'], 'series': store.forecast, 'run_id': store.run_id}
                    elif path == '/api/v1/weekly-forecasts' and store.weekly is not None:
                        result = {'summary':store.report['weekly'],'series':store.weekly,'run_id':store.run_id}
                    elif path == '/api/v1/diagnostics' and store.diagnostics is not None:
                        result = {'diagnostics':store.diagnostics,'run_id':store.run_id}
                    elif path in ['/api/v1/weekly-predictions.csv.gz','/api/v1/recommendation-diagnostics.csv.gz','/api/v1/diagnostics.json','/api/v1/report.json', '/api/v1/forecast-predictions.csv.gz', '/api/v1/test-predictions-itemcf.csv.gz', '/api/v1/checksums.json', *[f'/api/v1/validation-predictions-{name}.csv.gz' for name in STRATEGIES + EXTRA_STRATEGIES]]:
                        name = path.rsplit('/', 1)[1]
                        return self.respond(200, (store.run / name).read_bytes(), 'application/json' if name.endswith('.json') else 'application/gzip', name)
                    else:
                        return self.respond(404, {'error': 'Unknown endpoint'})
                return self.respond(200, result)
            except (FileNotFoundError, ValueError, KeyError) as error:
                return self.respond(503, {'error': 'Model artifacts unavailable or invalid. Run npm run train.', 'detail': str(error)})
        target = (WEB / (path.lstrip('/') or 'index.html')).resolve()
        if not target.is_relative_to(WEB.resolve()) or not target.is_file():
            return self.respond(404, {'error': 'Not found'})
        return self.respond(200, target.read_bytes(), mimetypes.guess_type(target)[0] or 'application/octet-stream')

    def do_POST(self):
        if urlsplit(self.path).path != '/api/v1/recommendations':
            return self.respond(404, {'error': 'Unknown endpoint'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                return self.respond(413, {'error': 'Body must be between 1 and 16384 bytes'})
            payload = json.loads(self.rfile.read(length))
            with self.server.artifact_lock:
                store = ARTIFACTS.load()
                result = store.recommend(payload)
            return self.respond(200, result)
        except (ValueError, TypeError) as error:
            return self.respond(400, {'error': str(error)})
        except (FileNotFoundError, KeyError) as error:
            return self.respond(503, {'error': 'Model artifacts unavailable. Run npm run train.', 'detail': str(error)})


if __name__ == '__main__':
    import threading
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5328)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.artifact_lock = threading.RLock()
    print(f'Local model lab: http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
