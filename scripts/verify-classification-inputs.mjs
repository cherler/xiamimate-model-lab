import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {verifyInputs,equalInputs} from '../apps/web/classification-input-metrics.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function verifyInputBuild(root,parent=null){
 const read=f=>readFile(resolve(root,f)),json=async f=>JSON.parse(await read(f)),dir='apps/web/classification-input-results/';
 const m=await json(dir+'manifest.json'),record=await json('docs/evaluation/classification-input-export-v1.json');
 if(!/^[a-f0-9]{64}\.json$/.test(m.path)||m.path!==m.sha256+'.json'||m.sha256!==record.sha256)throw Error('输入价值资源路径或登记哈希不一致');
 const bytes=await read(dir+m.path);if(hash(bytes)!==m.sha256)throw Error('输入价值资源哈希不一致');
 const p=verifyInputs(JSON.parse(bytes),parent);
 equalInputs([m.run_id,m.parent_run,record.run_id,record.parent_run],[p.run_id,p.parent_run,p.run_id,p.parent_run]);
 for(const [file,key] of [['services/classification/input_protocol.json','protocol'],['docs/evaluation/classification-input-audit-v1.json','audit']]){
  const b=await read(file);if(hash(b)!==p[key+'_sha256'])throw Error('输入价值协议或审计变更');equalInputs(JSON.parse(b),p[key]);
 }
 equalInputs(Object.keys(p.code_sha256).sort(),['services/classification/input_audit.py','services/classification/input_study.py','services/classification/run.py']);
 for(const [f,h] of Object.entries(p.code_sha256))if(hash(await read(f))!==h)throw Error('输入价值训练源码变更');
 equalInputs(record.protocol_sha256,p.protocol_sha256);
 equalInputs(record.summary,{rows:p.rows.length,models:Object.fromEntries(Object.entries(p.result.models).map(([k,v])=>[k,{ap:v.calibrated.ap,brier:v.calibrated.brier,capacity:v.capacity,policy:v.policy}])),pairs:p.result.pairs});
 return p;
}
if(process.argv[1]?.endsWith('/verify-classification-inputs.mjs'))console.log('Verified', (await verifyInputBuild(process.cwd())).run_id);
