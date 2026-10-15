import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CASE_READINGS} from '../../apps/web/case-reading.js';
import {SCENARIO_EXPANSIONS} from '../../apps/web/scenario-expansion.js';
import {decisionInput,decisionMetrics,findPlan,verifyDecision,POLICIES} from '../../apps/web/decision-metrics.js';
const root=fileURLToPath(new URL('../../apps/web/decision-results/',import.meta.url));
export const PUBLIC_CASES=Object.entries(CASE_READINGS).filter(([,c])=>!c.research);
const obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},num={type:'number'};
const selection=obj({origin:str,model:{type:'string',enum:['lightgbm','four_week_mean']},budget:num,capacity:num,shortage:num},['origin','model','budget','capacity','shortage']);
const tool=(name,description,parameters)=>({type:'function',function:{name,description,parameters}});
export const TOOL_DEFINITIONS=[
 tool('list_cases','列出已公开案例，供匹配业务问题。',obj()),
 tool('read_case','读取一个案例的已完成结论、范围与限制。不是逐样本数据。',obj({key:{type:'string',enum:PUBLIC_CASES.map(([k])=>k)}},['key'])),
 tool('read_expansion','读取业务场景扩展规划，所有内容尚未在对应扩展场景实证。',obj({business:{type:'string',enum:Object.keys(SCENARIO_EXPANSIONS)}},['business'])),
 tool('retail_options','读取零售补货回放支持的精确日期与倍率，不能猜测未提供的参数。',obj()),
 tool('retail_compare','读取指定历史场景的保存订单，复算三策略预算/库容/预期成本。仅起点前信息，不含未来销量；不是在线求解。',selection),
 tool('retail_review','复算相同历史场景的事后模拟结果。只用于评估已冻结订单，不得拿它选当时最优策略或承诺收益。',selection),
];
export function validateArgs(name,args){
 const schema=TOOL_DEFINITIONS.find(t=>t.function.name===name)?.function.parameters;
 if(!schema)throw new Error('未知工具');
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k)))throw new Error('工具参数无效');
 for(const key of schema.required)if(!Object.hasOwn(args,key))throw new Error('缺少参数：'+key);
 for(const [k,v] of Object.entries(args)){const s=schema.properties[k];if(typeof v!==s.type||s.enum&&!s.enum.includes(v)||s.type==='number'&&!Number.isFinite(v)||s.type==='string'&&v.length>120)throw new Error('工具参数无效：'+k);}
 return args;
}
export async function loadRetail(){
 const m=JSON.parse(await readFile(root+'manifest.json','utf8'));
 if(!/^[a-f0-9]{16}\/case\.json$/.test(m.path)||m.run_id!=='decision-20261014T024032437273Z')throw new Error('补货版本无效');
 const bytes=await readFile(root+m.path);
 if(createHash('sha256').update(bytes).digest('hex')!==m.sha256)throw new Error('补货数据校验失败');
 const p=JSON.parse(bytes);verifyDecision(p);return p;
}
export function retailOptions(p){return {origins:p.windows.map(w=>w.origin),models:p.protocol.forecast_models,budget:p.protocol.budget_ratios,capacity:p.protocol.capacity_ratios,shortage:p.protocol.shortage_price_ratios,default:{origin:p.windows[0].origin,...p.protocol.default}};}
export function compareRetail(p,args,review=false){
 validateArgs(review?'retail_review':'retail_compare',args);
 const w=p.windows.find(w=>w.origin===args.origin),plan=w&&findPlan(w,args);
 if(!plan)throw new Error('该组合没有保存结果，请使用支持的日期与倍率；未自动取最近值。');
 const x=decisionInput(w.items,plan,p.protocol),sources=[{id:`retail:${args.origin}:${args.model}:${args.budget}:${args.capacity}:${args.shortage}:${review?'review':'compare'}`,title:'UCI 保存补货结果与复算',href:'#decision?'+new URLSearchParams({case:'retail',view:review?'report':'experience',...args})}];
 const policies=Object.fromEntries(Object.entries(POLICIES).map(([key,label])=>[key,{label,packs:plan.policies[key].packs,metrics:decisionMetrics(x,plan.policies[key].packs,review?w.items.map(r=>r.actual):null)}]));
 return {sources,kind:review?'事后模拟复算':'保存订单与历史需求场景复算',run:p.run_id,sourceForecast:p.protocol.source_run,selection:args,end:w.end,unit:'金额单位：英镑便士；数量：件',budget:x.budget,capacity:x.capacity,packSize:x.pack,
  items:w.items.map((r,i)=>({id:r.id,name:r.name,initial:r.initial,forecast:r.predictions[args.model],weeks:r.weeks,cost:r.cost,penalty:x.penalty[i],...(review?{recordedSales:r.actual}:{})})),policies,
  limits:['历史开发回放，非独立新测试。','库存、采购成本、容量、整包与到货时间是假设；记录销量不是完整潜在需求。','预期成本用过去八周构造的场景；没有未来区间覆盖保证。','求解最优不保证事后成本更低，更不证明真实经营收益。'],
  notice:p.notice};
}
export async function executeTool(name,args,{load=loadRetail}={}){
 validateArgs(name,args);
 if(name==='list_cases')return {sources:[{id:'catalog',title:'公开业务案例',href:'#delivery?section=cases'}],cases:PUBLIC_CASES.map(([key,c])=>({key,name:c.name,input:c.input,output:c.output}))};
 if(name==='read_case'){const c=PUBLIC_CASES.find(([k])=>k===args.key)?.[1];if(!c)throw new Error('案例未公开');const [business,caseId]=args.key.split(':');return {sources:[{id:args.key,title:c.name,href:`#${business}?case=${caseId}&view=report`}],status:'已有案例说明；精确逐样本数值需在案例页查看',case:c};}
 if(name==='read_expansion')return {sources:[{id:'expand:'+args.business,title:'场景扩展规划',href:`#expand?business=${args.business}`}],status:'尚未在这些扩展场景实证',...SCENARIO_EXPANSIONS[args.business]};
 const p=await load();
 if(name==='retail_options')return {sources:[{id:'retail-options',title:'UCI 补货参数范围',href:'#decision?case=retail'}],...retailOptions(p)};
 return compareRetail(p,args,name==='retail_review');
}
export async function runWorkflow(selection,options={}){
 const start=performance.now(),trace=[];
 // Freeze the caller's explicit selection. The review never influences order choice.
 for(const name of ['retail_compare','retail_review']){const t=performance.now();try{const result=await executeTool(name,selection,options);trace.push({name,args:selection,result,ok:true,ms:Math.round(performance.now()-t)});}catch(e){trace.push({name,args:selection,result:{error:e.message},ok:false,ms:Math.round(performance.now()-t)});throw Object.assign(new Error(e.message),{trace});}}
 return {mode:'workflow',summary:'固定流程已完成：读取保存订单，分别复算起点前需求场景与事后模拟；下方保留三策略和全部商品。此流程不调用语言模型，也不产生新订单。',trace,ms:Math.round(performance.now()-start),sources:trace[0].result.sources,usage:null};
}
