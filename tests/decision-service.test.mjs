import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {serviceRows,serviceSummary,verifyService} from '../apps/web/decision-service-metrics.js';
import {serviceHtml,loadService} from '../apps/web/decision-service.js';
import {verifyServiceBuild} from '../scripts/verify-decision-service.mjs';
const read=p=>JSON.parse(fs.readFileSync(p)),spec=read('apps/web/decision-results/manifest.json'),parent=read('apps/web/decision-results/'+spec.path),m=read('apps/web/decision-service-results/manifest.json'),p=read('apps/web/decision-service-results/'+m.path);
const state={model:'lightgbm',origin:'2011-09-01',budget:1,capacity:1.25,shortage:1.5,service:.8};
test('all 432 service results and 144 ceilings bind parent inputs and reproduce metrics',async()=>{
 assert.equal(verifyService(p,parent,spec),p);assert.equal((await verifyServiceBuild(process.cwd())).records.length,144);
 const statuses=t=>p.records.flatMap(r=>r.services.filter(s=>s.target===t));
 assert.deepEqual([.7,.8,.9].map(t=>statuses(t).filter(r=>r.status===0).length),[61,31,0]);
 assert.deepEqual([.7,.8,.9].map(t=>statuses(t).filter(r=>r.status===2).length),[83,113,144]);
});
test('summary keeps infeasible denominator and same-service qualified baseline separate',()=>{
 const rows=serviceRows(p,parent,state),s=serviceSummary(rows,.8);
 assert.equal(rows.length,12);assert.equal(s.valid,9);assert.equal(s.infeasible,3);assert.equal(s.eligible,0);assert.equal(s.eligible_actual_delta,null);assert.equal(s.actual_meet,5);assert.equal(s.wins,3);assert.equal(s.losses,6);
 assert.ok(Math.abs(s.actual_delta/100-1605.709)<.00001);
 const seventy=serviceSummary(serviceRows(p,parent,{...state,service:.7}),.7);assert.equal(seventy.eligible,12);assert.equal(seventy.wins,5);assert.equal(seventy.losses,7);
 const none=serviceSummary(serviceRows(p,parent,{...state,service:.9}),.9);assert.equal(none.valid,0);assert.equal(none.infeasible,12);assert.equal(none.actual_delta,null);assert.equal(none.fill,null);
 const synthetic=rows.slice(0,2).map((r,i)=>({...r,result:{...r.result,status:0,expected:{total_cost:0},observed:{total_cost:0,demand_units:i?90:10,shortage_units:i?0:10,fill_rate:i?1:0}}}));
 assert.equal(serviceSummary(synthetic,.8).fill,.9); // volume-weighted, not mean 50%
});
test('invalid scope, metrics, constraints, and impossible solver claims fail closed',()=>{
 for(const change of [x=>x.records.pop(),x=>x.records[1]=x.records[0],x=>x.parent_sha256='wrong',x=>x.records[0].services[0].status=9,x=>x.records.find(r=>r.services[0].status===0).services[0].packs[0]+=.5,x=>x.records.find(r=>r.services[0].status===0).services[0].observed.total_cost++,x=>x.records[0].services[2].packs=Array(12).fill(0),x=>x.records[0].ceiling.dual_bound=-1000000]){
  const q=structuredClone(p);change(q);assert.throws(()=>verifyService(q,parent,spec),/校验失败/);
 }
});
test('business language distinguishes unmet rules, infeasibility, changed costs and no service guarantees',()=>{
 const report=serviceHtml(p,parent,state,true);
 for(const text of ['9/12','3 个不可行','0/9','同服务水平','不是每种商品','便士','英镑','开发模拟'])assert.ok(report.includes(text),text);
 const infeasible=serviceHtml(p,parent,{...state,service:.9});assert.ok(infeasible.includes('已证明不可行'));assert.ok(infeasible.includes('不生成替代订单或零成本'));
 const mismatch=serviceHtml(p,parent,{...state,shortage:3});assert.ok(mismatch.includes('没有对应实验'));assert.ok(!mismatch.includes('£'));
 assert.ok(serviceHtml(null,parent,state,false,'缺失').includes('原补货案例仍可查看'));
});
test('changed outcomes do not enter pre-origin ceiling or orders',()=>{
 const r=p.records.find(r=>r.model==='lightgbm'&&r.budget===1&&r.capacity===1.25);
 const copied=structuredClone(parent);copied.windows.find(w=>w.origin===r.origin).items.forEach(i=>i.actual=999999);
 const before=serviceRows(p,parent,state)[0],after=serviceRows(p,copied,state)[0];
 assert.deepEqual(after.r.ceiling,before.r.ceiling);assert.deepEqual(after.result.packs,before.result.packs);
});
test('static loader rejects missing and corrupt output then retries verified artifacts',async()=>{
 const old=global.fetch;let mode='missing';try{
  global.fetch=async url=>{assert.ok(String(url).startsWith('./decision-service-results/'));if(mode==='missing')return new Response('',{status:404});if(mode==='corrupt'&&url.endsWith('case.json'))return new Response('{}');return new Response(fs.readFileSync('apps/web/'+url.slice(2)));};
  await assert.rejects(loadService(parent,spec),/未导出/);mode='corrupt';await assert.rejects(loadService(parent,spec),/校验失败/);mode='valid';assert.equal((await loadService(parent,spec)).p.records.length,144);
 }finally{global.fetch=old;}
});
