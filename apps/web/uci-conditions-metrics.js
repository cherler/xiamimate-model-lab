// E4 diagnostic conventions, frozen before cross-tabulation. No threshold fitting.
export const CONDITIONS = Object.freeze({history_days:56,recent_days:14,trend_up:2,trend_down:.5,minimum_weekly_change:10,zero_fraction:.5,weekly_cv:1,large_error_scale:1,wide_interval_scale:2});
export const CONDITION_MODELS = ['zero','last_week','four_week_mean','four_week_median','autoets','lightgbm'];
export const SIGNAL_NAMES = Object.freeze({trend:'近期销量变化',sparse:'零销量日较多',volatile:'历史周量波动',extrapolation:'预测超出历史范围',combined:'任一核查标记'});
const sum = a => a.reduce((x,y)=>x+y,0);
const fail = why => { throw new Error(`UCI 使用条件校验失败：${why}`); };
const day = (origin,offset) => new Date(Date.parse(origin+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);

// Deliberately never reads actual / actual_days / intervals.
export function preOriginSignals(row,model) {
 const h=row.history,prediction=row.predictions?.[model];
 if(!Array.isArray(h)||h.length!==CONDITIONS.history_days||!Array.isArray(row.history_dates)||row.history_dates.length!==56||!/^\d{4}-\d{2}-\d{2}$/.test(row.origin)||!Number.isFinite(Date.parse(row.origin+'T00:00:00Z')))fail('历史日期或长度');
 if(row.history_dates.some((d,i)=>d!==day(row.origin,i-56))||h.some(x=>!Number.isFinite(x)||x<0)||!Number.isFinite(prediction)||prediction<0)fail('预测前输入');
 const weeks=Array.from({length:8},(_,i)=>sum(h.slice(i*7,i*7+7)));
 const mean=sum(weeks)/8,scale=Math.max(1,mean),recent=sum(h.slice(-14))/2,previous=sum(h.slice(0,42))/6;
 const ratio=previous>0?recent/previous:null,change=recent-previous;
 const direction=change>=CONDITIONS.minimum_weekly_change&&(previous===0||ratio>=CONDITIONS.trend_up)?'up':change<=-CONDITIONS.minimum_weekly_change&&ratio<=CONDITIONS.trend_down?'down':null;
 const zeroDays=h.filter(x=>x===0).length,cv=mean>0?Math.sqrt(sum(weeks.map(x=>(x-mean)**2))/8)/mean:null;
 const min=Math.min(...weeks),max=Math.max(...weeks);
 const flags={trend:direction!==null,sparse:zeroDays/56>=CONDITIONS.zero_fraction,volatile:cv!==null&&cv>=CONDITIONS.weekly_cv,extrapolation:prediction<min||prediction>max};
 flags.combined=Object.values(flags).some(Boolean);
 return {history_start:row.history_dates[0],history_end:row.history_dates.at(-1),weeks,mean,scale,recent,previous,ratio,change,direction,zero_days:zeroDays,zero_fraction:zeroDays/56,cv,min,max,prediction,flags};
}
export function conditionAdvice(signals,interval) {
 const labels=Object.keys(SIGNAL_NAMES).filter(k=>k!=='combined'&&signals.flags[k]).map(k=>SIGNAL_NAMES[k]);
 const broad=interval?interval.width_scale>=CONDITIONS.wide_interval_scale:null;
 return {title:labels.length?'先核查历史变化与预测依据':'未触发约定检查，仍需核查业务变化',
  text:labels.length?`本次有${labels.length}类核查标记：${labels.join('、')}。先核实标记对应的输入或预测依据，再把预测作为人工判断的参考。`:'本次没有命中四类历史检查；这不能证明可靠，也无法排除历史中未出现的需求变化。',
  interval:!interval?'本窗口尚未积累足够残差，无法提供范围参考。':broad?'区间跨度至少为历史周均尺度的两倍；若业务容不下这种误差，应先补充信息，不能直接按上界备货。':'区间跨度小于历史周均尺度的两倍，这只是本例诊断尺度；仍须与实际可接受误差比较，不能据此自动执行。'};
}
function summarize(rows) {
 const n=rows.length,total=sum(rows.map(r=>r.actual)),eligible=rows.filter(r=>r.interval);
 return {n,windows:new Set(rows.map(r=>r.origin)).size,items:new Set(rows.map(r=>r.item)).size,
  large:rows.filter(r=>r.large).length,spikes:rows.filter(r=>r.spike).length,
  wape:total?sum(rows.map(r=>r.error))/total:null,bias:total?sum(rows.map(r=>r.prediction-r.actual))/total:null,
  interval_n:eligible.length,misses:eligible.filter(r=>r.interval.miss).length,broad:eligible.filter(r=>r.interval.broad).length,
  mean_width_scale:eligible.length?sum(eligible.map(r=>r.interval.width_scale))/eligible.length:null};
}
export function diagnoseConditions(rows,reliability) {
 if(!Array.isArray(rows)||rows.length!==144||new Set(rows.map(r=>r.origin+':'+r.item)).size!==144||new Set(rows.map(r=>r.origin)).size!==12||new Set(rows.map(r=>r.item)).size!==12)fail('144 商品周范围');
 const intervals=new Map((reliability?.records||[]).map(r=>[r.origin+':'+r.item,r]));
 if(reliability&&intervals.size!==144)fail('区间范围');
 const records=[];
 for(const row of rows) {
  if(!Number.isFinite(row.actual)||row.actual<0)fail('事后实际销量');
  const existing=intervals.get(row.origin+':'+row.item);
  if(reliability&&(!existing||existing.actual!==row.actual||existing.end!==row.end))fail('区间父记录');
  const models={};
  for(const model of CONDITION_MODELS) {
   const signals=preOriginSignals(row,model),prediction=signals.prediction,error=Math.abs(row.actual-prediction);
   if(existing&&(existing.predictions[model]!==prediction||existing.scale!==signals.scale))fail('区间模型或尺度');
   const bounds=existing?.intervals?.[model];
   if(existing?.intervals&&!bounds)fail('区间方法缺失');
   if(bounds&&(!Number.isFinite(bounds.lower)||!Number.isFinite(bounds.upper)||bounds.lower<0||bounds.upper<bounds.lower))fail('区间边界');
   const width=bounds?bounds.upper-bounds.lower:null,widthScale=bounds?width/signals.scale:null;
   models[model]={origin:row.origin,item:row.item,actual:row.actual,prediction,error,signals,
    large:error>CONDITIONS.large_error_scale*signals.scale,spike:row.actual>signals.max,
    interval:bounds?{...bounds,width,width_scale:widthScale,broad:widthScale>=CONDITIONS.wide_interval_scale,miss:row.actual<bounds.lower||row.actual>bounds.upper}:null};
  }
  records.push({origin:row.origin,end:row.end,item:row.item,models});
 }
 const summary=Object.fromEntries(CONDITION_MODELS.map(model=>{
  const all=records.map(r=>r.models[model]);
  return [model,{all:summarize(all),groups:Object.fromEntries(Object.keys(SIGNAL_NAMES).map(key=>[key,{flagged:summarize(all.filter(r=>r.signals.flags[key])),unflagged:summarize(all.filter(r=>!r.signals.flags[key]))}])),
   windows:[...new Set(all.map(r=>r.origin))].sort().map(origin=>({origin,...summarize(all.filter(r=>r.origin===origin)),flagged:all.filter(r=>r.origin===origin&&r.signals.flags.combined).length}))}];
 }));
 return {schema:'uci-conditions-v1',constants:CONDITIONS,records,summary};
}
