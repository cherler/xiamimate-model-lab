import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyCost,equalCost} from '../apps/web/retrieval-cost-metrics.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function verifyCostBuild(root,parent=null){
 const read=f=>readFile(resolve(root,f)),json=async f=>JSON.parse(await read(f));
 const pm=await json('apps/web/retrieval-results/manifest.json'),pb=await read('apps/web/retrieval-results/'+pm.path);if(hash(pb)!==pm.sha256)throw Error('检索父版本哈希不一致');parent=parent||JSON.parse(pb);
 const m=await json('apps/web/retrieval-cost-results/manifest.json'),record=await json('docs/evaluation/retrieval-cost-export-v1.json');
 if(!/^[a-f0-9]{64}\.json$/.test(m.path)||m.path!==m.sha256+'.json'||m.sha256!==record.sha256)throw Error('检索成本导出清单无效');
 const bytes=await read('apps/web/retrieval-cost-results/'+m.path);if(hash(bytes)!==m.sha256)throw Error('检索成本资源哈希不一致');const p=verifyCost(JSON.parse(bytes),parent);
 equalCost([m.run_id,m.parent_run],[p.run_id,p.protocol.parent_run]);
 const cm=await json('apps/web/colbert-results/manifest.json'),cb=await read('apps/web/colbert-results/'+cm.path);equalCost(hash(cb),cm.sha256);equalCost(p.colbert_sha256,cm.sha256);equalCost(p.parent_sha256,JSON.parse(cb).parent_sha256);
 const protocol=await read('services/retrieval/cost-protocol.json'),audit=await read('docs/evaluation/retrieval-cost-audit-v1.json');
 equalCost(p.protocol_sha256,hash(protocol));equalCost(p.protocol,JSON.parse(protocol));equalCost(p.audit_sha256,hash(audit));equalCost(p.audit_summary,JSON.parse(audit).summary);equalCost(p.parent_sha256,JSON.parse(audit).parent_sha256);
 const expected=['services/retrieval/cost_study.py','services/retrieval/cost_audit.py','services/retrieval/core.py','services/retrieval/colbert_encoder.py','services/retrieval/uv.lock'];equalCost(Object.keys(p.code_sha256).sort(),expected.sort());
 for(const [file,digest] of Object.entries(p.code_sha256))equalCost(hash(await read(file)),digest);
 equalCost(record.summary,p.summary);equalCost(record.costs,p.costs);return p;
}
if(process.argv[1]?.endsWith('/verify-retrieval-cost.mjs'))console.log('Verified',(await verifyCostBuild(process.cwd())).run_id);
