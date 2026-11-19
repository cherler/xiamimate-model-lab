import {verifyCostBuild} from './verify-retrieval-cost.mjs';
import {verifyInputBuild} from './verify-classification-inputs.mjs';
import {verifyChoiceBuild} from './export-segment-choice.mjs';
import {verifyCrossBuild} from './verify-anomaly-cross.mjs';
import {verifyServiceBuild} from './verify-decision-service.mjs';
import {verifyAdoptionBuild} from './verify-uci-adoption.mjs';
import {conditionsReport} from './report-uci-conditions.mjs';
import {verifyUciReliability} from '../apps/web/uci-reliability.js';
import {verifyClassificationExplanations} from '../apps/web/classification-explanations.js';
import {verifyColbert} from '../apps/web/colbert-metrics.js';
import {readinessModule} from './export-model-readiness.mjs';
import {verifyPreference} from '../apps/web/preference-segments.js';
import {validateExplanations} from '../apps/web/advanced-explanations.js';
import {verifyUciStatic} from './verify-uci-static.mjs';
import {verifyDecision} from '../apps/web/decision-metrics.js';
import {verifyMonitoring} from '../apps/web/monitoring-metrics.js';
import {verifyRetrieval} from '../apps/web/retrieval-metrics.js';
import {verifyClassification} from '../apps/web/classification-metrics.js';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { publishableWebPath } from './publish-policy.mjs';
import {competitionDisplayPaths} from './competition-showcase.mjs';
import {businessDisplayPaths} from './business-showcase.mjs';
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
const advancedPayloads={};
for(const key of ['ranking','graph','tft','recommendation-samples','forecast-samples','explanation-trees','explanation-graph','explanation-tft']) {
  const spec=advanced.resources?.[key];
  if(!spec || !/^[a-f0-9]{16}\/[a-z-]+\.json$/.test(spec.path))throw new Error(`进阶实验资源无效：${key}`);
  const bytes=await readFile(resolve(advancedAssets,spec.path));
  advancedPayloads[key]=JSON.parse(bytes);
  if(createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error(`进阶实验校验失败：${key}`);
  if(['ranking','graph','tft'].includes(key)&&JSON.parse(bytes).run_id!==advanced.runs[key])throw new Error(`进阶实验版本不一致：${key}`);
}
validateExplanations(advancedPayloads,advanced);
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
const explanationRoot=resolve(root,'apps/web/classification-explanations');
const explanation=JSON.parse(await readFile(resolve(explanationRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(explanation.path)||explanation.parent_sha256!==classification.sha256||explanation.run_id!==classification.run_id)throw new Error('分类解释清单无效');
const explanationBytes=await readFile(resolve(explanationRoot,explanation.path));
if(createHash('sha256').update(explanationBytes).digest('hex')!==explanation.sha256)throw new Error('分类解释哈希不一致');
const explanationPayload=verifyClassificationExplanations(JSON.parse(explanationBytes),classificationPayload,classification.sha256);
const explanationAudit=JSON.parse(await readFile(resolve(root,'docs/evaluation/classification-explanations-v1.json'),'utf8'));
if(explanationAudit.sha256!==explanation.sha256||explanationAudit.exporter_sha256!==explanationPayload.exporter_sha256||explanationPayload.exporter_sha256!==createHash('sha256').update(await readFile(resolve(root,'services/classification/explain.py'))).digest('hex'))throw new Error('分类解释审计版本不一致');
const reliabilityRoot=resolve(root,'apps/web/uci-reliability-results');
const reliabilityManifest=JSON.parse(await readFile(resolve(reliabilityRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(reliabilityManifest.path))throw new Error('UCI 可靠性路径无效');
const reliabilityBytes=await readFile(resolve(reliabilityRoot,reliabilityManifest.path));
if(createHash('sha256').update(reliabilityBytes).digest('hex')!==reliabilityManifest.sha256)throw new Error('UCI 可靠性文件校验失败');
const reliabilityParent=JSON.parse(await readFile(resolve(root,'apps/web/uci-results/manifest.json'),'utf8'));
const reliabilitySeriesBytes=await readFile(resolve(root,'apps/web/uci-results',reliabilityParent.version,'weekly-series.json'));
if(createHash('sha256').update(reliabilitySeriesBytes).digest('hex')!==reliabilityParent.files['weekly-series.json'].sha256)throw new Error('UCI 可靠性父数据不一致');
const reliabilityPayload=verifyUciReliability(JSON.parse(reliabilityBytes),{series:JSON.parse(reliabilitySeriesBytes)},reliabilityParent);
const reliabilityAudit=JSON.parse(await readFile(resolve(root,'docs/evaluation/uci-reliability-v1.json'),'utf8'));
const reliabilityProtocol=await readFile(resolve(root,'services/reliability/uci-protocol.json'));
if(reliabilityAudit.sha256!==reliabilityManifest.sha256||reliabilityPayload.protocol_sha256!==createHash('sha256').update(reliabilityProtocol).digest('hex')||JSON.stringify(reliabilityPayload.protocol)!==JSON.stringify(JSON.parse(reliabilityProtocol))||reliabilityPayload.exporter_sha256!==createHash('sha256').update(await readFile(resolve(root,'services/reliability/uci.py'))).digest('hex')||reliabilityManifest.parent_run!==reliabilityPayload.parent_run||reliabilityManifest.protocol_sha256!==reliabilityPayload.protocol_sha256)throw new Error('UCI 可靠性协议审计不一致');
const conditionsAudit=JSON.parse(await readFile(resolve(root,'docs/evaluation/uci-conditions-v1.json'),'utf8'));
if(JSON.stringify(conditionsAudit)!==JSON.stringify(await conditionsReport()))throw new Error('UCI 使用条件审计或诊断结果不一致');
const retrievalRoot=resolve(root,'apps/web/retrieval-results');
const retrieval=JSON.parse(await readFile(resolve(retrievalRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(retrieval.path)||retrieval.notice!==retrieval.path.replace('case.json','NOTICE.txt'))throw new Error('检索资源路径无效');
const retrievalBytes=await readFile(resolve(retrievalRoot,retrieval.path));
if(createHash('sha256').update(retrievalBytes).digest('hex')!==retrieval.sha256)throw new Error('检索结果哈希不一致');
const retrievalPayload=verifyRetrieval(JSON.parse(retrievalBytes));
if(retrievalPayload.run_id!==retrieval.run_id)throw new Error('检索结果版本不一致');
const retrievalNotice=await readFile(resolve(retrievalRoot,retrieval.notice));
if(createHash('sha256').update(retrievalNotice).digest('hex')!==retrieval.notice_sha256||retrievalNotice.toString()!==retrievalPayload.notice)throw new Error('检索署名说明不一致');
const colbertRoot=resolve(root,'apps/web/colbert-results');
const colbert=JSON.parse(await readFile(resolve(colbertRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(colbert.path))throw new Error('ColBERT 资源路径无效');
const colbertBytes=await readFile(resolve(colbertRoot,colbert.path));
if(createHash('sha256').update(colbertBytes).digest('hex')!==colbert.sha256)throw new Error('ColBERT 文件校验失败');
const colbertPayload=verifyColbert(JSON.parse(colbertBytes),retrievalPayload);
const colbertAudit=JSON.parse(await readFile(resolve(root,'docs/evaluation/colbert-development-v1.json'),'utf8'));
if(colbertPayload.run_id!==colbert.run_id||colbertAudit.case_sha256!==colbert.sha256)throw new Error('ColBERT 实验版本不一致');
const monitoringRoot=resolve(root,'apps/web/monitoring-results');
const monitoring=JSON.parse(await readFile(resolve(monitoringRoot,'manifest.json'),'utf8'));
for(const kind of ['anomaly','segments']){
 const spec=monitoring.resources?.[kind];if(!spec||!new RegExp(`^[a-f0-9]{16}/${kind}\\.json$`).test(spec.path))throw new Error('监测资源路径无效');
 const bytes=await readFile(resolve(monitoringRoot,spec.path));if(createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error('监测结果哈希不一致');
 const payload=verifyMonitoring(JSON.parse(bytes),{deep:true});if(payload.kind!==kind||payload.run_id!==spec.run_id)throw new Error('监测结果版本不一致');
}
const preferenceRoot=resolve(root,'apps/web/preference-results');
const preference=JSON.parse(await readFile(resolve(preferenceRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(preference.path))throw new Error('偏好结果路径无效');
const preferenceBytes=await readFile(resolve(preferenceRoot,preference.path));
if(createHash('sha256').update(preferenceBytes).digest('hex')!==preference.sha256)throw new Error('偏好结果哈希不一致');
const preferencePayload=verifyPreference(JSON.parse(preferenceBytes));
if(preferencePayload.run_id!==preference.run_id||preferencePayload.parent_run!==monitoring.resources.segments.run_id||preferencePayload.parent_sha256!==monitoring.resources.segments.sha256)throw new Error('偏好实验来源版本不一致');
const decisionRoot=resolve(root,'apps/web/decision-results');
const decision=JSON.parse(await readFile(resolve(decisionRoot,'manifest.json'),'utf8'));
if(!/^[a-f0-9]{16}\/case\.json$/.test(decision.path))throw new Error('决策结果路径无效');
const decisionBytes=await readFile(resolve(decisionRoot,decision.path));
if(createHash('sha256').update(decisionBytes).digest('hex')!==decision.sha256)throw new Error('决策结果哈希不一致');
if(verifyDecision(JSON.parse(decisionBytes)).run_id!==decision.run_id)throw new Error('决策结果版本不一致');
await verifyUciStatic(resolve(root,'apps/web/uci-results'),manifest);
await verifyAdoptionBuild(root);
await verifyServiceBuild(root);
await verifyCrossBuild(root);
await verifyChoiceBuild(root);
await verifyInputBuild(root,classificationPayload);
await verifyCostBuild(root,retrievalPayload);
if(await readFile(resolve(root,'apps/web/model-readiness.js'),'utf8')!==await readinessModule())throw new Error('模型适配审查展示与来源报告不一致');
const includeCompetitions=process.argv.includes('--competition-showcase');
const githubPages=process.argv.includes('--github-pages');
if(githubPages&&process.argv.includes('--online-ai'))throw new Error('GitHub Pages cannot run the assistant backend');
const competitionPaths=includeCompetitions?await competitionDisplayPaths(resolve(root,'apps/web')):new Set();
const includeBusinesses=process.argv.includes('--business-showcase');
const businessPaths=includeBusinesses?await businessDisplayPaths(resolve(root,'apps/web')):new Set();
// Build output is disposable; validate all sources before replacing it.
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
await cp(`${root}apps/web`, `${root}dist`, { recursive: true, filter: source => publishableWebPath(resolve(root,'apps/web'),source,competitionPaths,businessPaths) });
await writeFile(resolve(root,'dist/preview-mode.js'),`export const LOCAL_RESEARCH = ${includeCompetitions};\n`);
await writeFile(resolve(root,'dist/anticheat-mode.js'),`export const ANTICHEAT_RESEARCH = ${includeBusinesses};\n`);
await writeFile(resolve(root,'dist/uplift-mode.js'),`export const UPLIFT_RESEARCH = ${includeBusinesses};\n`);
await writeFile(resolve(root,'dist/public-build.js'),`export const PUBLIC_STATIC = ${!process.argv.includes('--online-ai')};\n`);
await writeFile(resolve(root,'dist/hosting-mode.js'),`export const GITHUB_PAGES = ${githubPages};\n`);
if(githubPages){
 const url='https://cherler.github.io/xiamimate-model-lab/';
 const html=await readFile(resolve(root,'dist/index.html'),'utf8');
 await writeFile(resolve(root,'dist/index.html'),html.replace(/https:\/\/xiamimate\.com\/model-lab\//g,url));
 await writeFile(resolve(root,'dist/.nojekyll'),'');
}
console.log(includeCompetitions?'M5 and Dressipi: verified display bundles included by explicit publishing choice; original rights metadata retained.':'M5 and Dressipi excluded from standard public build.');
console.log(includeBusinesses?'Uplift and anti-cheat: verified current display bundles included.':'Uplift and anti-cheat excluded from standard public build.');
console.log(`Built showcase ${manifest.version}. Ta Feng and UCI use verified static results; no model API is required.`);
