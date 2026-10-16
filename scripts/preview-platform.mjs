import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createStaticServer} from './static-server.mjs';
const lab=createStaticServer({root:fileURLToPath(new URL('../dist/',import.meta.url)),basePath:'/model-lab/'});
const host=createStaticServer({root:fileURLToPath(new URL('../../xiamimate-tools-frontend/out/',import.meta.url))});
createServer((req,res)=>{
  if(req.url==='/model-lab'){res.writeHead(308,{Location:'/model-lab/'});res.end();return;}
  (req.url.startsWith('/model-lab/')?lab:host).emit('request',req,res);
}).listen(5336,'127.0.0.1',()=>console.log('Host preview: http://127.0.0.1:5336/model-lab/ (static, no AI or account API)'));
