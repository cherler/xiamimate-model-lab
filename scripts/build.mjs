import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = resolve(root, 'apps/web/showcase');
let manifest;
try { manifest = JSON.parse(await readFile(`${assets}/manifest.json`, 'utf8')); }
catch { throw new Error('请先运行 npm run export:showcase，生成已核验的案例展示数据。'); }
if (!manifest.cases?.length || !Object.keys(manifest.files || {}).length) throw new Error('展示清单不完整。');
for (const [name, expected] of Object.entries(manifest.files)) {
  const path=resolve(assets,name);
  if (!path.startsWith(assets+sep)) throw new Error('展示资源路径越界。');
  const actual=createHash('sha256').update(await readFile(path)).digest('hex');
  if (actual!==expected) throw new Error(`展示文件校验失败：${name}`);
}
const advancedAssets=resolve(root,'apps/web/advanced-results');
let advanced;
try { advanced=JSON.parse(await readFile(`${advancedAssets}/manifest.json`,'utf8')); }
catch { throw new Error('请先运行 npm run export:advanced，生成完整进阶实验数据。'); }
for(const key of ['ranking','graph','tft','recommendation-samples','forecast-samples']) {
  const spec=advanced.resources?.[key];
  if(!spec || !/^[a-f0-9]{16}\/[a-z-]+\.json$/.test(spec.path))throw new Error(`进阶实验资源无效：${key}`);
  const bytes=await readFile(resolve(advancedAssets,spec.path));
  if(createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error(`进阶实验校验失败：${key}`);
  if(['ranking','graph','tft'].includes(key)&&JSON.parse(bytes).run_id!==advanced.runs[key])throw new Error(`进阶实验版本不一致：${key}`);
}
// Build output is disposable; validate all sources before replacing it.
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
await cp(`${root}apps/web`, `${root}dist`, { recursive: true });
console.log(`Built showcase ${manifest.version}. Ta Feng uses saved results; UCI still requires the local API.`);
