import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyAdoption,adoptionPair,adoptionGroup,adoptionConclusion,ADOPTION_GROUPS} from '../apps/web/uci-adoption-metrics.js';
import {adoptionHtml,loadAdoption} from '../apps/web/uci-adoption.js';
import {verifyAdoptionBuild} from '../scripts/verify-uci-adoption.mjs';
const read=f=>JSON.parse(fs.readFileSync(f));
const m=read('apps/web/uci-results/manifest.json'),a=read('apps/web/uci-adoption-results/manifest.json'),p=read('apps/web/uci-adoption-results/'+a.path),report=read(`apps/web/uci-results/${m.version}/report.json`);
test('paired export binds source hashes, all original windows and complete cohorts',async()=>{
 assert.equal(verifyAdoption(p,m,report),p);assert.equal(p.records.length,4280);
 const summary=await verifyAdoptionBuild(process.cwd());
 assert.equal(summary.hybrid.cold.ties,600);assert.equal(summary.hybrid['1–5'].wins,12);assert.equal(summary.hybrid['1–5'].losses,5);
 assert.ok(summary.hybrid['6–20'].recall_delta<0);assert.ok(summary.hybrid['6–20'].ndcg_delta>0);
 for(const g of ['1–5','6–20','21+'])assert.ok(summary.als[g].ndcg_delta<0);
});
test('same-customer pairing has exact gain accounting, includes both-zero ties and separates ceilings',()=>{
 for(const model of p.protocol.models){
  const x=adoptionPair(p.records,model,'personal_decay'),grouped=ADOPTION_GROUPS.map(g=>adoptionPair(p.records,model,'personal_decay',g));
  assert.equal(x.wins+x.ties+x.losses,4280);
  for(const key of ['n','targets','oov','capacity_loss','wins','ties','losses','repeat_targets','novel_targets'])assert.equal(grouped.reduce((s,r)=>s+r[key],0),x[key]);
  assert.ok(Math.abs(grouped.reduce((s,r)=>s+r.ndcg_delta*r.n,0)/4280-x.ndcg_delta)<1e-12);
  assert.ok(x.current.recall<=x.ideal_recall);
 }
 const same=adoptionPair(p.records,'als','als');assert.equal(same.wins,0);assert.equal(same.losses,0);assert.equal(same.ties,4280);
 const r={origin:'one',customer:'1',activity:'1–5',targets:15,oov:2,repeat:0,novel:15,methods:{als:{hits:0,ndcg:0,fallback:false,repeat_hits:0,novel_hits:0}}};
 const x=adoptionPair([r],'als','als');assert.equal(x.capacity_loss,3);assert.equal(x.ideal_recall,10/15);assert.equal(x.current.repeat_recall,null);assert.equal(x.ties,1);
});
test('adoption language never turns historical winners into a deployed router',()=>{
 const x=adoptionPair(p.records,'hybrid','personal_decay','6–20'),ws=p.protocol.origins.map(o=>adoptionPair(p.records,'hybrid','personal_decay','6–20',o));
 assert.match(adoptionConclusion(x,ws),/1 个窗口退步/);
 assert.match(adoptionConclusion(x,ws,{matched:false}),/当前经营规则未评估/);
 assert.match(adoptionConclusion(x,ws,{cold:true}),/尚无个性化增益/);
 assert.match(adoptionConclusion({...x,n:0},[]),/依据不足/);
 const html=adoptionHtml(p,{report,model:'als',baseline:'personal_decay',group:'21+'});
 assert.ok(html.includes('当前 ALS，对照 近期加权复购'));
 const controls=adoptionHtml(p,{report,controls:true});
 for(const [id,label] of Object.entries({popular:'热门商品',itemcf:'ItemCF',basket:'最近一单搭配',als:'ALS',ease:'EASE'}))assert.ok(controls.includes(`<option value="${id}">${label}</option>`));
 for(const phrase of ['保留对照方案','不执行新的人群路由','4,280','2,845','目录外商品','24 位','不同','不是','候选','条目'])assert.ok(html.includes(phrase),phrase);
 const newRules=adoptionHtml(p,{report,model:'hybrid',baseline:'personal_decay',group:'6–20',matched:false});assert.ok(newRules.includes('当前经营规则未评估'));assert.ok(newRules.includes('找回的目标商品比例反而下降'));
});
test('pre-origin cohort does not use next basket, outcome, or selected model',()=>{
 assert.deepEqual([0,1,5,6,20,21].map(adoptionGroup),['cold','1–5','1–5','6–20','6–20','21+']);
 const output={customer_id:'12849',history_items:5};
 const before=adoptionHtml(p,{report,output,group:'1–5'}),after=adoptionHtml(p,{report,output:{...output,actual:999,target:['fake'],future_purchase_count:99},group:'1–5'});
 assert.equal(before,after);assert.ok(before.includes('83 个顾客窗口'));assert.ok(before.includes('不是该顾客的购买概率'));
});
test('scope, derived counts, original metrics and fallback corruptions fail closed',()=>{
 for(const change of [x=>x.records.pop(),x=>x.records[1]=x.records[0],x=>x.records[0].methods.als.hits++,x=>x.records[0].oov=99999,x=>x.protocol.sources['report.json']='bad',x=>x.records.find(r=>r.activity==='cold').methods.hybrid.fallback=false,x=>x.records[0].methods.als.ndcg=.999]){
  const q=structuredClone(p);change(q);assert.throws(()=>verifyAdoption(q,m,report),/校验失败/);
 }
});
test('relative static loader rejects missing or corrupt evidence, retries and validates parent',async()=>{
 const original=global.fetch;let mode='missing';try{
  global.fetch=async url=>{assert.ok(String(url).startsWith('./uci-'));if(mode==='missing'&&url==='./uci-adoption-results/manifest.json')return new Response('',{status:404});if(mode==='corrupt'&&url==='./uci-adoption-results/'+a.path)return new Response('{}');return new Response(fs.readFileSync('apps/web/'+String(url).slice(2)));};
  await assert.rejects(loadAdoption(),/尚未导出/);mode='corrupt';await assert.rejects(loadAdoption(),/校验失败/);mode='valid';assert.equal((await loadAdoption()).records.length,4280);
 }finally{global.fetch=original;}
});
