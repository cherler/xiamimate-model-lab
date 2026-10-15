import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyUciReliability} from '../apps/web/uci-reliability.js';
import {CONDITIONS,diagnoseConditions} from '../apps/web/uci-conditions-metrics.js';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=p=>readFile(new URL(p,root)),json=async p=>JSON.parse(await bytes(p));
export async function conditionsReport(){
 const protocolBytes=await bytes('services/reliability/uci-conditions-protocol.json'),protocol=JSON.parse(protocolBytes),audit=await json('docs/evaluation/uci-conditions-audit-v1.json');
 if(JSON.stringify(CONDITIONS)!==JSON.stringify(protocol.constants)||audit.protocol_sha256!==sha(protocolBytes))throw new Error('E4 诊断协议与审计不一致');
 const manifest=await json('apps/web/uci-results/manifest.json'),weekly=await bytes(`apps/web/uci-results/${manifest.version}/weekly-series.json`);
 if(manifest.run_id!==protocol.parent_run||manifest.version!==protocol.parent_version||sha(weekly)!==protocol.weekly_sha256||manifest.files['weekly-series.json'].sha256!==protocol.weekly_sha256)throw new Error('E4 父版本不一致');
 const m=await json('apps/web/uci-reliability-results/manifest.json');
 if(!/^[a-f0-9]{16}\/case\.json$/.test(m.path))throw new Error('E3 路径无效');
 const raw=await bytes('apps/web/uci-reliability-results/'+m.path);if(sha(raw)!==m.sha256)throw new Error('E3 哈希无效');
 const rows=JSON.parse(weekly),p=verifyUciReliability(JSON.parse(raw),{series:rows},manifest);
 const result=diagnoseConditions(rows,p);
 return {schema:result.schema,parent_run:manifest.run_id,parent_version:manifest.version,weekly_sha256:sha(weekly),reliability_sha256:m.sha256,protocol_sha256:sha(protocolBytes),metrics_sha256:sha(await bytes('apps/web/uci-conditions-metrics.js')),constants:CONDITIONS,summary:result.summary};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await conditionsReport();await writeFile(new URL('docs/evaluation/uci-conditions-v1.json',root),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(Object.fromEntries(['lightgbm','four_week_median'].map(m=>[m,report.summary[m].groups.combined])),null,2));
}
