import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, customers, forecastSeries } from '../apps/web/demo-engine.js';

test('exclude-purchased rule removes every purchased item for every returning customer', () => {
  for (const [customer, profile] of Object.entries(customers)) {
    const { items } = recommend({ customer, count: 6, exclude: true });
    assert.ok(items.every(p => !profile.history.includes(p.id)));
    assert.equal(new Set(items.map(p => p.id)).size, items.length);
  }
});
test('new customer falls back to the same popularity ordering regardless of chosen model or exploration', () => {
  const baseline = recommend({ customer: 'new', strategy: 'popular', explore: 0 });
  for (const strategy of ['personal', 'basket']) {
    const result = recommend({ customer: 'new', strategy, explore: 100 });
    assert.equal(result.fallback, true);
    assert.deepEqual(result.items.map(p => p.id), baseline.items.map(p => p.id));
  }
});
test('count limit never invents extra candidates and disabling exclusion allows repurchases', () => {
  assert.equal(recommend({ customer: 'home', count: 6, exclude: true }).items.length, 5);
  assert.equal(recommend({ customer: 'home', count: 6, exclude: false }).items.length, 6);
  assert.ok(recommend({ customer: 'home', count: 6, exclude: false }).items.some(p => customers.home.history.includes(p.id)));
});
test('synthetic forecast has 42 past and 28 future values; weekly baseline uses only last historical week', () => {
  const { history, baseline, candidate } = forecastSeries();
  assert.equal(history.length, 42); assert.equal(candidate.length, 28); assert.equal(baseline.length, 28);
  baseline.forEach((value, i) => assert.equal(value, history[35 + i % 7]));
  assert.ok(candidate.every(v => Number.isFinite(v) && v >= 0));
});
