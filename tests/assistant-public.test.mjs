import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {createAssistantHandler} from '../services/assistant/http.mjs';

test('public assistant requires exact host and POST origin, enforces quota and never discloses key',async()=>{
 let calls=0;
 const handler=createAssistantHandler({publicOrigin:'https://xiamimate.com',maxRequests:1,config:{model:'test',key:'private-key'},complete:async()=>{calls++;return {message:{content:JSON.stringify({summary:'请补充业务目标。',citations:[],brief:['业务问题','预期输出','已有数据','约束','验收目标','合作范围'].map(k=>k+'：待沟通').join('\n')})}};}});
 const server=createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const send=(path,method='GET',headers={},body)=>new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{Host:'xiamimate.com',...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(body);
 });
 const payload=JSON.stringify({mode:'brief',question:'我想改善补货'}),json={'Content-Type':'application/json'};
 try{
  const s=await send('/api/assistant/status');assert.equal(s.status,200);assert.doesNotMatch(s.text,/private-key/);assert.match(s.text,/在线案例演示/);
  assert.equal((await send('/api/assistant/status','GET',{Host:'evil.test'})).status,403);
  for(const Origin of [undefined,'https://evil.test','null'])assert.equal((await send('/api/assistant/run','POST',{...json,...(Origin?{Origin}:{})},payload)).status,403);
  assert.equal(calls,0);
  const answer=await send('/api/assistant/run','POST',{...json,Origin:'https://xiamimate.com'},payload);assert.equal(answer.status,200,answer.text);
  assert.equal((await send('/api/assistant/run','POST',{...json,Origin:'https://xiamimate.com'},payload)).status,429);assert.equal(calls,1);
  assert.equal((await send('/.env')).status,404);
 }finally{server.close();await once(server,'close');}
});
test('public deployment configuration fails closed',()=>{
 for(const publicOrigin of ['http://xiamimate.com','https://xiamimate.com/path','https://user:secret@xiamimate.com'])assert.throws(()=>createAssistantHandler({config:null,publicOrigin}));
 for(const maxRequests of [0,201,NaN])assert.throws(()=>createAssistantHandler({config:null,maxRequests}));
});
