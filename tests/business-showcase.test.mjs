import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {businessDisplayPaths} from '../scripts/business-showcase.mjs';
import {publishableWebPath} from '../scripts/publish-policy.mjs';

test('business publication rejects paths outside the result bundle and corrupt files',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'business-showcase-'));
 try{
  const name='uplift-results',path='1234567890abcdef/case.json';
  await mkdir(resolve(root,name,'1234567890abcdef'),{recursive:true});
  const manifest={schema:1,run_id:'hillstrom-multiarm-v1',path:'../../private.json',sha256:'0'.repeat(64)};
  await writeFile(resolve(root,name,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(()=>businessDisplayPaths(root),/Invalid business manifest/);
  manifest.path=path;
  await writeFile(resolve(root,name,'manifest.json'),JSON.stringify(manifest));
  await writeFile(resolve(root,name,path),'{}');
  await assert.rejects(()=>businessDisplayPaths(root),/checksum mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});

const web=resolve('apps/web'),bundles=['uplift-results','anticheat-results'];
test('explicit business showcase includes verified current evidence but no old exports or model files',{
 skip:!bundles.every(name=>existsSync(resolve(web,name,'manifest.json')))
},async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'business-showcase-current-'));
 try{
  for(const name of bundles){
   const manifest=JSON.parse(await readFile(resolve(web,name,'manifest.json'),'utf8'));
   await mkdir(resolve(root,name,manifest.path.split('/')[0]),{recursive:true});
   await writeFile(resolve(root,name,'manifest.json'),JSON.stringify(manifest));
   await writeFile(resolve(root,name,manifest.path),await readFile(resolve(web,name,manifest.path)));
  }
  const allowed=await businessDisplayPaths(root);
  for(const name of bundles){
   const manifest=JSON.parse(await readFile(resolve(root,name,'manifest.json'),'utf8'));
   for(const path of [name,`${name}/manifest.json`,`${name}/${manifest.path.split('/')[0]}`,`${name}/${manifest.path}`]){
    assert.equal(publishableWebPath(root,resolve(root,path)),false);
    assert.equal(publishableWebPath(root,resolve(root,path),new Set(),allowed),true);
   }
   for(const path of [`${name}/old/case.json`,`${name}/raw.csv`,`${name}/${manifest.path.split('/')[0]}/model.pkl`])assert.equal(publishableWebPath(root,resolve(root,path),new Set(),allowed),false);
  }
  assert.equal(publishableWebPath(root,resolve(root,'../private'),new Set(),allowed),false);
  const file=resolve(root,'anticheat-results/manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));
  await writeFile(file,JSON.stringify({...manifest,run_id:'wrong-run'}));
  await assert.rejects(()=>businessDisplayPaths(root),/version mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});
