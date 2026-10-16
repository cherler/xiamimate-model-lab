import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyService} from '../apps/web/decision-service-metrics.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function verifyServiceBuild(root){
 const read=p=>readFile(resolve(root,p)),json=async p=>JSON.parse(await read(p));
 const spec=await json('apps/web/decision-results/manifest.json'),m=await json('apps/web/decision-service-results/manifest.json'),record=await json('docs/evaluation/decision-service-export-v1.json');
 if(m.schema!=='decision-service-v1'||!/^[a-f0-9]{16}\/case\.json$/.test(m.path)||m.path!==record.path||m.sha256!==record.sha256||m.parent_sha256!==spec.sha256||m.run_id!==record.run_id)throw new Error('服务约束导出不一致');
 const bytes=await read('apps/web/decision-service-results/'+m.path);if(hash(bytes)!==m.sha256||bytes.length!==record.bytes)throw new Error('服务约束内容不一致');
 const parent=await json('apps/web/decision-results/'+spec.path),p=verifyService(JSON.parse(bytes),parent,spec),protocol=await read('services/decision_study/protocol.json'),audit=await read('docs/evaluation/decision-service-audit-v1.json');
 if(hash(protocol)!==p.protocol_sha256||p.protocol_sha256!==m.protocol_sha256||p.run_id!==m.run_id||JSON.stringify(JSON.parse(protocol))!==JSON.stringify(p.protocol)||hash(audit)!==p.protocol.audit_sha256||JSON.stringify(JSON.parse(audit))!==JSON.stringify(p.audit)||record.orders_sha256!==p.orders_sha256||record.inputs_sha256!==p.inputs_sha256)throw new Error('服务约束协议或审计不一致');
 const code=['services/decision_study/audit.py','services/decision_study/solver.py','services/decision_study/run.py','services/decision/core.py'];
 if(JSON.stringify(Object.keys(p.code_sha256).sort())!==JSON.stringify(code.sort()))throw new Error('服务实验源码范围不一致');
 for(const name of code)if(hash(await read(name))!==p.code_sha256[name]||record.code_sha256[name]!==p.code_sha256[name])throw new Error('服务实验源码不一致');
 const counts=Object.fromEntries(p.protocol.targets.map(t=>[String(t),Object.fromEntries([0,1,2,3,4].map(s=>[String(s),p.records.reduce((n,r)=>n+r.services.filter(z=>z.target===t&&z.status===s).length,0)]))]));
 if(JSON.stringify(counts)!==JSON.stringify(record.counts))throw new Error('服务实验状态计数不一致');
 return p;
}
