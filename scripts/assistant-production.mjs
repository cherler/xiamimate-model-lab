import {createServer} from 'node:http';
import {createAssistantHandler} from '../services/assistant/http.mjs';

// Credentials stay outside the public site; no static file handler in this process.
if(!process.env.MODEL_LAB_ENV_FILE)throw new Error('MODEL_LAB_ENV_FILE is required');
process.loadEnvFile(process.env.MODEL_LAB_ENV_FILE);
const publicOrigin=process.env.MODEL_LAB_PUBLIC_ORIGIN;
if(!publicOrigin)throw new Error('MODEL_LAB_PUBLIC_ORIGIN is required');
const handler=createAssistantHandler({publicOrigin,maxRequests:Number(process.env.MODEL_LAB_HOURLY_LIMIT||20)});
const server=createServer(async(req,res)=>{
 try{if(await handler(req,res))return;}catch{/* Do not log request bodies or provider errors. */}
 res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"接口不存在"}');
});
server.requestTimeout=100000;
server.headersTimeout=15000;
server.listen(Number(process.env.MODEL_LAB_PORT||8340),'127.0.0.1',()=>console.log('Model lab assistant ready on loopback'));
process.on('SIGTERM',()=>{server.close();setTimeout(()=>process.exit(0),5000).unref();});
