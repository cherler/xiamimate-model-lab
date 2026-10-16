import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyCrossIndex,verifyCrossSeries,sameCross} from '../apps/web/anomaly-cross-metrics.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function verifyCrossBuild(root){
 const read=p=>readFile(resolve(root,p)),json=async p=>JSON.parse(await read(p));
 const m=await json('apps/web/anomaly-cross-results/manifest.json'),record=await json('docs/evaluation/anomaly-cross-export-v1.json');
 if(!/^[a-f0-9]{64}\.json$/.test(m.path)||m.path!==m.sha256+'.json'||m.sha256!==record.index_sha256||m.run_id!==record.run_id)throw Error('跨序列版本不一致');
 const bytes=await read('apps/web/anomaly-cross-results/'+m.path);if(hash(bytes)!==m.sha256)throw Error('跨序列哈希不一致');const p=verifyCrossIndex(JSON.parse(bytes));if(p.run_id!==m.run_id)throw Error('运行版本不一致');
 const protocol=await read('services/anomaly_study/protocol.json'),audit=await read('docs/evaluation/anomaly-cross-audit-v1.json');if(hash(protocol)!==p.protocol_sha256||hash(audit)!==p.protocol.audit_sha256||hash(audit)!==p.audit_sha256)throw Error('跨序列协议变更');sameCross(JSON.parse(protocol),p.protocol);sameCross(JSON.parse(audit),p.audit);sameCross(record.summary,p.summary);
 for(const [name,digest] of Object.entries(p.source_code))if(hash(await read('services/anomaly_study/'+name))!==digest)throw Error('实验源码变更');
 if(hash(await read('services/monitoring/anomaly.py'))!==p.protocol.feature_source_sha256)throw Error('特征源码变更');
 for(const s of p.series){const bytes=await read('apps/web/anomaly-cross-results/'+s.asset.path);if(hash(bytes)!==s.asset.sha256)throw Error('序列哈希不一致');verifyCrossSeries(JSON.parse(bytes),s,p.protocol);}return p;
}
if(process.argv[1]?.endsWith('/verify-anomaly-cross.mjs'))console.log('E7 verified:',(await verifyCrossBuild(process.cwd())).run_id);
