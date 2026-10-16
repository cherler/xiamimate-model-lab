import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// An explicit publishing choice, separate from the frozen experiments' rights metadata.
// Only existing, checksum-verified display resources are included; no raw data or models.
export async function competitionDisplayPaths(webRoot) {
 const paths=new Set();
 for(const name of ['m5-results','dressipi-results']){
  const manifest=JSON.parse(await readFile(resolve(webRoot,name,'manifest.json'),'utf8'));
  if(manifest.schema!==1||!manifest.run_id||!Object.keys(manifest.resources||{}).length)throw new Error(`Invalid competition manifest: ${name}`);
  paths.add(name);paths.add(`${name}/manifest.json`);
  for(const spec of Object.values(manifest.resources)){
   if(!/^[a-f0-9]{16}\/[a-z0-9-]+\.json$/.test(spec.path)||!/^[a-f0-9]{64}$/.test(spec.sha256))throw new Error(`Invalid competition resource: ${name}`);
   const bytes=await readFile(resolve(webRoot,name,spec.path));
   if(createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error(`Competition checksum mismatch: ${name}/${spec.path}`);
   JSON.parse(bytes);
   paths.add(`${name}/${spec.path.split('/')[0]}`);paths.add(`${name}/${spec.path}`);
  }
 }
 return paths;
}
