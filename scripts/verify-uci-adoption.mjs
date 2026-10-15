import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {verifyAdoption,adoptionPair,ADOPTION_GROUPS} from '../apps/web/uci-adoption-metrics.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function verifyAdoptionBuild(root){
 const read=p=>readFile(resolve(root,p)),json=async p=>JSON.parse(await read(p));
 const m=await json('apps/web/uci-adoption-results/manifest.json'),record=await json('docs/evaluation/uci-adoption-export-v1.json');
 if(!/^[a-f0-9]{16}\/case\.json$/.test(m.path)||record.sha256!==m.sha256||record.path!==m.path)throw new Error('推荐采用导出审计不一致');
 const raw=await read('apps/web/uci-adoption-results/'+m.path),parent=await json('apps/web/uci-results/manifest.json');
 if(sha(raw)!==m.sha256||raw.length!==record.bytes)throw new Error('推荐采用内容哈希不一致');
 const report=await json(`apps/web/uci-results/${parent.version}/report.json`),p=verifyAdoption(JSON.parse(raw),parent,report);
 const protocol=await read('services/adoption/uci-protocol.json');
 if(sha(protocol)!==p.protocol_sha256||m.protocol_sha256!==p.protocol_sha256||m.parent_run!==p.parent_run||m.parent_version!==p.parent_version||JSON.stringify(JSON.parse(protocol))!==JSON.stringify(p.protocol)||JSON.stringify(await json('docs/evaluation/uci-adoption-audit-v1.json'))!==JSON.stringify(p.audit))throw new Error('推荐采用协议或审计已改变');
 for(const [name,digest] of Object.entries(p.source_code_sha256))if(!['services/adoption/uci.py','services/adoption/export.py'].includes(name)||sha(await read(name))!==digest||record.source_code_sha256[name]!==digest)throw new Error('推荐采用导出源码不一致');
 for(const [name,digest] of Object.entries(p.protocol.sources))if(sha(await read(`apps/web/uci-results/${parent.version}/${name}`))!==digest)throw new Error('推荐配对原文件已改变');
 return Object.fromEntries(['hybrid','als'].map(model=>[model,Object.fromEntries(ADOPTION_GROUPS.map(g=>[g,adoptionPair(p.records,model,'personal_decay',g)]))]));
}
