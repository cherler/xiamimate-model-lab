import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {competitionDisplayPaths} from '../scripts/competition-showcase.mjs';
import {publishableWebPath} from '../scripts/publish-policy.mjs';
test('explicit competition publication accepts only verified current resources',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'competition-showcase-'));
 try{
  const path='1234567890abcdef/report.json',bytes='{"value":1}',sha256=createHash('sha256').update(bytes).digest('hex');
  for(const name of ['m5-results','dressipi-results']){
   await mkdir(resolve(root,name,'1234567890abcdef'),{recursive:true});
   await writeFile(resolve(root,name,path),bytes);
   await writeFile(resolve(root,name,'manifest.json'),JSON.stringify({schema:1,run_id:name,public_export_allowed:false,resources:{report:{path,sha256}}}));
  }
  const paths=await competitionDisplayPaths(root);
  assert.equal(publishableWebPath(root,resolve(root,'m5-results',path)),false);
  assert.equal(publishableWebPath(root,resolve(root,'m5-results',path),paths),true);
  assert.equal(publishableWebPath(root,resolve(root,'m5-results/old/report.json'),paths),false);
  assert.equal(publishableWebPath(root,resolve(root,'../secret'),paths),false);
  await writeFile(resolve(root,'m5-results',path),'{}');
  await assert.rejects(()=>competitionDisplayPaths(root),/checksum mismatch/);
  await writeFile(resolve(root,'m5-results/manifest.json'),JSON.stringify({schema:1,run_id:'m5',resources:{report:{path:'../../secret',sha256}}}));
  await assert.rejects(()=>competitionDisplayPaths(root),/Invalid competition resource/);
 }finally{await rm(root,{recursive:true,force:true});}
});
