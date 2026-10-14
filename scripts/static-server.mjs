import {createServer} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.gz':'application/gzip'};
export function createStaticServer({root,basePath='/'}={}){
 if(!root||!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath))throw new Error('Invalid static root or base path');
 const boundary=resolve(root);
 return createServer(async(req,res)=>{
  const fail=(code,text)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(text);};
  if(!['GET','HEAD'].includes(req.method))return fail(405,'Static files only');
  try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!pathname.startsWith(basePath))return fail(404,'Not found');const local=pathname.slice(basePath.length);if(local.startsWith('api/'))return fail(404,'No API on this server');
   const file=await realpath(resolve(boundary,local||'index.html')),actualRoot=await realpath(boundary);if(!file.startsWith(actualRoot+sep)||!(await stat(file)).isFile())return fail(404,'Not found');
   const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
  }catch{fail(404,'Not found');}
 });
}
export function startStatic({dist=false}={}){
 const root=fileURLToPath(new URL(dist?'../dist/':'../apps/web/',import.meta.url)),port=Number(process.env.MODEL_LAB_PORT||(dist?5330:5328)),basePath=process.env.MODEL_LAB_BASE_PATH||'/';
 const server=createStaticServer({root,basePath});server.on('error',e=>{console.error(e.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log(`Static model lab: http://127.0.0.1:${port}${basePath} (no API)`));return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startStatic({dist:process.argv.includes('--dist')});
