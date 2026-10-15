// Presentation facts are derived from verified tool results, not model arithmetic.
export const moneyGBP=pence=>'£'+(pence/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
export const weekday=date=>'星期'+'日一二三四五六'[new Date(date+'T00:00:00Z').getUTCDay()];
const n=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const moneyFields=['purchase','holding','shortage_cost','total_cost','budget_slack'];
export function retailDisplay(r){
 const reference=r.policies.point.metrics;
 const policies=Object.fromEntries(Object.entries(r.policies).map(([key,p])=>[key,{
  label:p.label,...Object.fromEntries(moneyFields.map(k=>[k,moneyGBP(p.metrics[k])])),
  total_cost_change_from_point:moneyGBP(p.metrics.total_cost-reference.total_cost),
  shortage_change_from_point:n(p.metrics.shortage_units-reference.shortage_units)+' 件',
  statement:`${p.label}：总成本 ${moneyGBP(p.metrics.total_cost)}，采购 ${moneyGBP(p.metrics.purchase)}，持有 ${moneyGBP(p.metrics.holding)}，缺货成本 ${moneyGBP(p.metrics.shortage_cost)}；缺货 ${n(p.metrics.shortage_units)} 件，需求满足率 ${n(p.metrics.fill_rate*100)}%。预算余量 ${moneyGBP(p.metrics.budget_slack)}，库容余量 ${n(p.metrics.capacity_slack)} 件。`,
 }]));
 return {currency:'GBP',moneyRule:'原始金额为便士；此处已除以 100 换成英镑。回答引用这里的 £ 金额，勿再次换算、改币种或省略单位。',
  window:{origin:r.selection.origin,originWeekday:weekday(r.selection.origin),end:r.end,endWeekday:weekday(r.end)},
  budget:moneyGBP(r.budget),policies,items:r.items.map(i=>({id:i.id,name:i.name,cost:moneyGBP(i.cost),penalty:moneyGBP(i.penalty)})),
  comparison:`${r.kind}，仅当前窗口和所选参数：场景成本优化相对按点预测补货，总成本${r.policies.milp.metrics.total_cost<reference.total_cost?'减少':'增加'} ${moneyGBP(Math.abs(r.policies.milp.metrics.total_cost-reference.total_cost))}，缺货量${r.policies.milp.metrics.shortage_units<reference.shortage_units?'减少':'增加'} ${n(Math.abs(r.policies.milp.metrics.shortage_units-reference.shortage_units))} 件。`,
  interpretation:'预期成本平均了起点前构造的八个需求场景，事后成本使用记录销量；总需求均值的变化不能单独证明成本变化的原因，商品结构和需求波动也影响缺货及持有成本。库存占用=初始库存+到货量；包数与件数按 packSize 区分。'};
}
export function normalizeCalendar(answer,trace){
 const corrections=[];if(!trace.some(t=>t.ok&&(t.result.windows||t.result.display)))return {answer,corrections};
 const fixed={...answer};for(const field of ['summary','brief'])if(fixed[field])fixed[field]=fixed[field].replace(/(\d{4}-\d{2}-\d{2})([\s（(，,]*)(星期|周)([日天一二三四五六])/g,(all,date,gap,prefix,day)=>{
  const d=new Date(date+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)return all;
  const expected=weekday(date).slice(-1);if(day.replace('天','日')===expected)return all;
  corrections.push({kind:'calendar',corrected:true,ok:true,message:`日期校正：${date} ${prefix}${day} → ${prefix}${expected}（服务端日历计算）`});return date+gap+prefix+expected;
 });return {answer:fixed,corrections};
}
function evidenceError(code,message){return Object.assign(new Error(message),{code,kind:'evidence'});}
// Focused guards catch known monetary/date failures. They do not prove all prose is true.
export function validateEvidence(answer,trace){
 const results=trace.filter(t=>t.ok).map(t=>t.result),retail=results.filter(r=>r.display),text=answer.summary+'\n'+(answer.brief||'');
 if(retail.length){
  if(answer.summary.length>900)throw evidenceError('overlong_report','回答重复了完整数据表。请压缩到 900 字内的 3–5 句，直接引用 display.comparison 说明主要取舍，补充两种需求来源和限制，不抄写表格或自行解释商品层面的原因。');
  const money=[...JSON.stringify(retail.map(r=>r.display)).matchAll(/£(-?[\d,]+\.\d{2})/g)].map(m=>Number(m[1].replaceAll(',','')));
  for(const m of text.matchAll(/£\s*(-?[\d,]+(?:\.\d+)?)/g)){
   const value=Number(m[1].replaceAll(',',''));if(!money.some(v=>Math.abs(v-value)<.011))throw evidenceError('unsupported_money','回答金额未匹配已复算的英镑证据。请直接引用 display 中的 £ 金额；新差值没有工具证据时不报数。');
  }
  for(const m of text.matchAll(/(-?[\d,]+(?:\.\d+)?)\s*(英镑便士|便士|GBp|英镑|GBP)/g)){
   const value=Number(m[1].replaceAll(',',''))/(['英镑便士','便士','GBp'].includes(m[2])?100:1);
   if(!money.some(v=>Math.abs(v-value)<.011))throw evidenceError('money_unit','回答金额与单位不匹配。请核对便士与英镑的 100 倍关系，优先引用 display 中的 £ 金额。');
  }
  for(const m of text.matchAll(/(?:总成本|采购金额|持有成本|缺货成本|预算余量|预算总额|成本减少|成本增加)\s*[：:=为]?\s*(-?\d[\d,.]*)/g)){
   if(!/^\s*(英镑便士|便士|GBp|英镑|GBP)/.test(text.slice(m.index+m[0].length)))throw evidenceError('money_unit','回答具体金额缺少单位。请按 display 使用 £ 前缀，不能省略单位。');
  }
 }
 if(results.some(r=>r.case))for(const clause of text.split(/[，,。！？\n]/)){
  const at=clause.search(/统计|显著性/);
  if(at>=0&&!/(?:不能|不等于|并不意味着|未提供|没有提供|未经)/.test(clause.slice(0,at)))throw evidenceError('unsupported_significance','当前案例资料未提供统计显著性检验，不能把预设增益筛选说成统计显著性门槛。请只复述未通过预设增益筛选，不引申统计结论。');
 }
 if(results.some(r=>r.timeScope)&&/本案例[^。\n]{0,20}(?:单日预算|每日独立预算)/.test(text))throw evidenceError('wrong_time_scope','本站补货案例是七日窗口起点一次补货，不是单日预算系统。请将用户希望每日补货的需求与主案例的时间粒度分开说明。');
 if(retail.length)for(const sentence of text.split(/[。！？\n]/)){
  const cause=sentence.match(/(?:需求|销量)[^。]{0,60}(?:均值|平均)[^。]{0,40}(?:因此|所以|导致|主因)/);
  if(cause&&!/(?:不能|不等于|未验证|不能单独)/.test(sentence.slice(0,cause.index)))throw evidenceError('unsupported_cause','不能仅用总需求均值变化断言成本变化的原因。只说明历史场景与记录销量两种计算口径、已复算差值及无法从总量判定成因。');
 }
 if(retail.some(r=>r.kind==='事后模拟复算')&&retail.some(r=>r.kind==='保存订单与历史需求场景复算')&&/(?:排序|排名|位次)[^。\n]{0,50}(?:一致|相同)/.test(text))throw evidenceError('mixed_rank_scope','两种口径的总成本排序与缺货排序不能合并概括。请直接分别引用两份 display.comparison，不概括跨口径排名。');
 if(retail.length&&/单位缺货(?:代价|成本)[^。\n]{0,20}(?:高于|低于|更高|更低)/.test(text))throw evidenceError('penalty_scope','同一组参数下各策略使用相同的逐商品缺货惩罚系数。请只比较已复算的缺货总成本和缺货件数，不把它说成策略的单位惩罚改变。');
 const hasCalendar=results.some(r=>r.windows||r.display);
 if(hasCalendar){
  for(const m of text.matchAll(/(\d{4}-\d{2}-\d{2})[\s（(，,]*(?:星期|周)([日天一二三四五六])/g))if(weekday(m[1])!=='星期'+m[2].replace('天','日'))throw evidenceError('wrong_weekday','回答日期与星期不一致。请引用工具中的精确日期，或按 window/windows 的星期字段说明。');
  for(const m of text.matchAll(/(?:若干|均为|都是|全部为|每个)[\s的]*(?:星期|周)[一二三四五六日天]/g))if(!/(?:不是|并非|并不|不能|不可)/.test(text.slice(Math.max(0,m.index-8),m.index)))throw evidenceError('calendar_generalization','支持日期是离散保存窗口，不能概括为固定星期。请直接引用精确日期，不推断连续范围或每周规律。');
 }
}

export function selectionChanges(before,after){
 if(!before?.policies||!after?.policies||before.run!==after.run||before.selection.origin!==after.selection.origin||before.selection.model!==after.selection.model||before.packSize!==after.packSize||JSON.stringify(before.items.map(i=>i.id))!==JSON.stringify(after.items.map(i=>i.id)))return null;
 const changed=['budget','capacity','shortage'].filter(k=>before.selection[k]!==after.selection[k]);if(!changed.length)return null;
 const policies=Object.fromEntries(Object.entries(after.policies).map(([key,p])=>{
  const items=after.items.map((item,i)=>({id:item.id,name:item.name,fromPacks:before.policies[key].packs[i],toPacks:p.packs[i],deltaPacks:p.packs[i]-before.policies[key].packs[i],deltaUnits:(p.packs[i]-before.policies[key].packs[i])*after.packSize}));
  const increased=items.filter(i=>i.deltaPacks>0),decreased=items.filter(i=>i.deltaPacks<0),unchanged=items.filter(i=>i.deltaPacks===0);
  return [key,{label:p.label,increased,decreased,unchanged,
   statement:`${p.label}：补货增加 ${increased.length} 件商品，减少 ${decreased.length} 件商品，不变 ${unchanged.length} 件商品；当前预算与库容约束${p.metrics.feasible?'满足':'不满足'}。`,
   capacityRule:'库容按初始库存＋订货到货量计算，不能只用采购到货量相减。'}];
 }));
 return {sourceIds:[before.sources[0].id,after.sources[0].id],from:before.selection,to:after.selection,changed,packSize:after.packSize,policies,scope:'服务端逐商品逐策略计算的前后差值；增加/减少方向为 from → to。其他条件仅在未列入 changed 时相同，不推断收益或可行域大小。'};
}
