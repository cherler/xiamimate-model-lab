import {verifyUciStatic} from './verify-uci-static.mjs';
import {verifyDecision} from '../apps/web/decision-metrics.js';
import {verifyMonitoring} from '../apps/web/monitoring-metrics.js';
import {verifyRetrieval} from '../apps/web/retrieval-metrics.js';
import {verifyClassification} from '../apps/web/classification-metrics.js';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { publishableWebPath } from './publish-policy.mjs';
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
const tuningAssets=resolve(root,'apps/web/tuning-results');
let tuning;
try { tuning=JSON.parse(await readFile(`${tuningAssets}/manifest.json`,'utf8')); }
catch { throw new Error('请先运行 npm run export:tuning，生成完整 AutoML 实验数据。'); }
for(const kind of ['lightgbm','lightgcn','tft'])for(const key of [kind,`${kind}-samples`]) {
  const spec=tuning.resources?.[key];
  if(!spec || !/^[a-f0-9]{16}\/[a-z-]+\.json$/.test(spec.path))throw new Error(`AutoML 资源无效：${key}`);
  const bytes=await readFile(resolve(tuningAssets,spec.path));
  if(createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error(`AutoML 校验失败：${key}`);
  if(key===kind&&JSON.parse(bytes).run_id!==tuning.runs[kind])throw new Error(`AutoML 版本不一致：${key}`);
}
const selectionAssets=resolve(root,'apps/web/selection-results');
let selection;
try { selection=JSON.parse(await readFile(`${selectionAssets}/manifest.json`,'utf8')); }
catch { throw new Error('请先运行 npm run export:automl，生成完整模型选择报告。'); }
if(!/^[a-f0-9]{16}\/report\.json$/.test(selection.path))throw new Error('模型选择资源无效');
const selectionBytes=await readFile(resolve(selectionAssets,selection.path));
if(createHash('sha256').update(selectionBytes).digest('hex')!==selection.sha256 || JSON.parse(selectionBytes).run_id!==selection.run_id)throw new Error('模型选择报告校验失败');
const classificationRoot=resolve(root,'apps/web/classification-results');
const classification=JSON.parse(await readFile(resolve(classificationRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(classification.path))throw new Error('分类结果路径无效');
const classificationBytes=await readFile(resolve(classificationRoot,classification.path));
if(createHash('sha256').update(classificationBytes).digest('hex')!==classification.sha256)throw new Error('分类结果哈希不一致');
const classificationPayload=verifyClassification(JSON.parse(classificationBytes));
if(classificationPayload.run_id!==classification.run_id)throw new Error('分类结果版本不一致');
const retrievalRoot=resolve(root,'apps/web/retrieval-results');
const retrieval=JSON.parse(await readFile(resolve(retrievalRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(retrieval.path)||retrieval.notice!==retrieval.path.replace('case.json','NOTICE.txt'))throw new Error('检索资源路径无效');
const retrievalBytes=await readFile(resolve(retrievalRoot,retrieval.path));
if(createHash('sha256').update(retrievalBytes).digest('hex')!==retrieval.sha256)throw new Error('检索结果哈希不一致');
const retrievalPayload=verifyRetrieval(JSON.parse(retrievalBytes));
if(retrievalPayload.run_id!==retrieval.run_id)throw new Error('检索结果版本不一致');
const retrievalNotice=await readFile(resolve(retrievalRoot,retrieval.notice));
if(createHash('sha256').update(retrievalNotice).digest('hex')!==retrieval.notice_sha256||retrievalNotice.toString()!==retrievalPayload.notice)throw new Error('检索署名说明不一致');
const monitoringRoot=resolve(root,'apps/web/monitoring-results');
const monitoring=JSON.parse(await readFile(resolve(monitoringRoot,'manifest.json'),'utf8'));
for(const kind of ['anomaly','segments']){
 const spec=monitoring.resources?.[kind];if(!spec||!new RegExp(`^[a-f0-9]{16}/${kind}\\.json$`).test(spec.path))throw new Error('监测资源路径无效');
 const bytes=await readFile(resolve(monitoringRoot,spec.path));if(createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error('监测结果哈希不一致');
 const payload=verifyMonitoring(JSON.parse(bytes),{deep:true});if(payload.kind!==kind||payload.run_id!==spec.run_id)throw new Error('监测结果版本不一致');
}
const decisionRoot=resolve(root,'apps/web/decision-results');
const decision=JSON.parse(await readFile(resolve(decisionRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(decision.path))throw new Error('决策结果路径无效');
const decisionBytes=await readFile(resolve(decisionRoot,decision.path));
if(createHash('sha256').update(decisionBytes).digest('hex')!==decision.sha256)throw new Error('决策结果哈希不一致');
if(verifyDecision(JSON.parse(decisionBytes)).run_id!==decision.run_id)throw new Error('决策结果版本不一致');
await verifyUciStatic(resolve(root,'apps/web/uci-results'),manifest);
// Build output is disposable; validate all sources before replacing it.
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
await cp(`${root}apps/web`, `${root}dist`, { recursive: true, filter: source => publishableWebPath(resolve(root,'apps/web'),source) });
console.log('M5 and Dressipi local research data excluded from public build; usage clearance is pending.');
console.log(`Built showcase ${manifest.version}. Ta Feng and UCI use verified static results; no model API is required.`);
