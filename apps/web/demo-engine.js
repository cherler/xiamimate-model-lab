// Synthetic examples only. No real customer records or trained model scores.
export const products = [
  { id: 'cup', name: '陶瓷早餐杯', category: '餐厨用品', kind: 'cup', color: '#d8d4c6', tags: ['kitchen', 'ceramic'], popularity: 94 },
  { id: 'basket', name: '棉麻收纳篮', category: '收纳整理', kind: 'basket', color: '#cebd9f', tags: ['storage', 'natural'], popularity: 79 },
  { id: 'vase', name: '玻璃花瓶', category: '家居装饰', kind: 'vase', color: '#b9d6d5', tags: ['decor', 'garden'], popularity: 76 },
  { id: 'tray', name: '桌面托盘', category: '收纳整理', kind: 'tray', color: '#bea17c', tags: ['storage', 'kitchen'], popularity: 70 },
  { id: 'pot', name: '园艺浇水壶', category: '园艺生活', kind: 'pot', color: '#86a798', tags: ['garden', 'natural'], popularity: 49 },
  { id: 'tote', name: '棉麻手提袋', category: '日常出行', kind: 'tote', color: '#dfd4bb', tags: ['natural', 'storage'], popularity: 83 },
  { id: 'bowl', name: '浅口陶瓷碗', category: '餐厨用品', kind: 'bowl', color: '#b6c7cf', tags: ['kitchen', 'ceramic'], popularity: 62 },
  { id: 'planter', name: '阳台小花盆', category: '园艺生活', kind: 'planter', color: '#b7aa95', tags: ['garden', 'ceramic'], popularity: 37 },
];
export const customers = {
  home: { name: '顾客 A · 家居爱好者', history: ['cup', 'tote', 'pot'] },
  garden: { name: '顾客 B · 园艺爱好者', history: ['pot', 'planter', 'vase'] },
  kitchen: { name: '顾客 C · 餐厨爱好者', history: ['cup', 'bowl', 'tray'] },
  new: { name: '新顾客 · 无购买记录', history: [] },
};
export function recommend({ customer = 'home', strategy = 'personal', exclude = true, count = 4, explore = 30 } = {}) {
  const history = customers[customer]?.history || [];
  const effective = history.length ? strategy : 'popular';
  const tags = history.flatMap(id => products.find(p => p.id === id).tags);
  const last = products.find(p => p.id === history.at(-1));
  const items = products.filter(p => !exclude || !history.includes(p.id)).map(p => {
    const overlap = p.tags.reduce((total, tag) => total + tags.filter(t => t === tag).length, 0);
    const basketOverlap = p.tags.filter(t => last?.tags.includes(t)).length;
    let score = effective === 'popular' ? p.popularity : effective === 'basket' ? basketOverlap * 30 + p.popularity * .35 : overlap * 18 + p.popularity * .4;
    if (effective !== 'popular') score += Number(explore) / 100 * (100 - p.popularity);
    const reason = effective === 'popular' ? '按示例热度排序' : effective === 'basket' ? (basketOverlap ? '与最近购买商品有共同标签' : '补充一个热门候选') : (overlap ? '与历史购买有共同标签' : '探索一个不同类型的商品');
    return { ...p, score, reason };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, Number(count));
  return { items, fallback: !history.length, effective };
}
export function forecastSeries() {
  // Analytic illustration, not M5 data, not a fitted forecast or prediction interval.
  const history = Array.from({ length: 42 }, (_, i) => Math.round(22 + i * .12 + Math.sin(i * Math.PI / 3.5) * 7 + Math.cos(i * 1.8) * 2));
  const baseline = Array.from({ length: 28 }, (_, i) => history[35 + i % 7]);
  const candidate = Array.from({ length: 28 }, (_, i) => Math.round(27 + i * .1 + Math.sin((i + 42) * Math.PI / 3.5) * 6));
  return { history, baseline, candidate };
}
