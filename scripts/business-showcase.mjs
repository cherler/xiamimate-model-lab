import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyUplift} from '../apps/web/uplift.js';
import {verifyAntiCheat} from '../apps/web/anticheat.js';

// Publishing is explicit and does not change the frozen experiments or their rights metadata.
// Include only each current display manifest and its verified case, never old exports or models.
export async function businessDisplayPaths(webRoot) {
 const paths=new Set();
 for(const [name,verify] of [['uplift-results',verifyUplift],['anticheat-results',verifyAntiCheat]]){
  const manifest=JSON.parse(await readFile(resolve(webRoot,name,'manifest.json'),'utf8'));
  if(manifest.schema!==1||!manifest.run_id||!/^[a-f0-9]{16}\/case\.json$/.test(manifest.path)||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw new Error(`Invalid business manifest: ${name}`);
  const bytes=await readFile(resolve(webRoot,name,manifest.path));
  if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw new Error(`Business checksum mismatch: ${name}`);
  const payload=verify(JSON.parse(bytes));
  if(payload.run_id!==manifest.run_id||!payload.source)throw new Error(`Business source or version mismatch: ${name}`);
  paths.add(name);paths.add(`${name}/manifest.json`);
  paths.add(`${name}/${manifest.path.split('/')[0]}`);paths.add(`${name}/${manifest.path}`);
 }
 return paths;
}
