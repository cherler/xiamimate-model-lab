import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyPreference} from '../apps/web/preference-segments.js';
import {buildChoiceStudy,verifyChoice,equalChoice} from '../apps/web/segment-choice-metrics.js';
import {resolve} from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex'),source='apps/web/preference-results/',out='apps/web/segment-choice-results/';
const recordSummary=p=>JSON.parse(JSON.stringify(p.result.windows.map(w=>({origin:w.origin,comparisons:w.comparisons,fallback:w.fallback})),(k,v)=>k==='ids'?undefined:v));
const files=['apps/web/segment-choice-metrics.js','scripts/audit-segment-choice.mjs','scripts/export-segment-choice.mjs'];
export async function verifyChoiceBuild(root){
 const read=p=>readFile(resolve(root,p)),json=async p=>JSON.parse(await read(p));
 const m=await json(source+'manifest.json'),base=await read(source+m.path);if(hash(base)!==m.sha256)throw Error('偏好来源不一致');const parent=verifyPreference(JSON.parse(base));
 const ref=await json(out+'manifest.json'),record=await json('docs/evaluation/segment-choice-export-v1.json');if(!/^[a-f0-9]{64}\.json$/.test(ref.path)||ref.path!==ref.sha256+'.json'||ref.sha256!==record.sha256)throw Error('方案选择导出版本不一致');
 const raw=await read(out+ref.path);if(hash(raw)!==ref.sha256)throw Error('方案选择哈希不一致');const p=verifyChoice(JSON.parse(raw),parent,m);
 const protocol=await read('services/segment_choice/protocol.json'),audit=await read('docs/evaluation/segment-choice-audit-v1.json');if(hash(protocol)!==p.protocol_sha256||hash(audit)!==p.protocol.audit_sha256)throw Error('方案选择协议变更');equalChoice(p.protocol,JSON.parse(protocol));equalChoice(p.audit,JSON.parse(audit));
 equalChoice(Object.keys(p.code_sha256).sort(),[...files].sort());for(const file of files)if(hash(await read(file))!==p.code_sha256[file])throw Error('方案选择源码变更');equalChoice(record.summary,recordSummary(p));return p;
}
async function run(){
 const json=async p=>JSON.parse(await readFile(p)),m=await json(source+'manifest.json'),raw=await readFile(source+m.path),parent=verifyPreference(JSON.parse(raw)),cfg=await json('services/segment_choice/protocol.json'),audit=await json('docs/evaluation/segment-choice-audit-v1.json');if(hash(raw)!==m.sha256||cfg.parent_sha256!==m.sha256||hash(await readFile('docs/evaluation/segment-choice-audit-v1.json'))!==cfg.audit_sha256)throw Error('冻结输入不一致');
 const p={schema:'segment-choice-v1',parent_run:parent.run_id,parent_sha256:m.sha256,protocol:cfg,protocol_sha256:hash(await readFile('services/segment_choice/protocol.json')),audit,code_sha256:Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(f))]))),result:buildChoiceStudy(parent,cfg),notice:parent.notice};
 const bytes=JSON.stringify(p),digest=hash(bytes);await mkdir(out,{recursive:true});await writeFile(out+digest+'.json',bytes);await writeFile(out+'manifest.json',JSON.stringify({path:digest+'.json',sha256:digest,parent_run:parent.run_id}));await writeFile('docs/evaluation/segment-choice-export-v1.json',JSON.stringify({sha256:digest,parent_run:parent.run_id,summary:recordSummary(p)})+'\n');await verifyChoiceBuild(process.cwd());console.log(JSON.stringify(p.result.windows.map(w=>({origin:w.origin,comparisons:Object.fromEntries(Object.entries(w.comparisons).map(([k,{ids,...v}])=>[k,v])),fallback:Object.fromEntries(Object.entries(w.fallback).map(([k,v])=>[k,typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='ids')):v])),conditions:w.cohorts})),null,2));
}
if(process.argv[1]?.endsWith('/export-segment-choice.mjs')){if(process.argv.includes('--verify'))console.log('Verified', (await verifyChoiceBuild(process.cwd())).parent_run);else await run();}
