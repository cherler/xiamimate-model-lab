export const CROSS_METHODS={static:'固定 robust z',rolling:'滚动中位数 / MAD',isolation:'Isolation Forest'};
export const CROSS_FAMILIES={realAWSCloudwatch:'云服务监控',realAdExchange:'广告流量',realKnownCause:'已知原因信号',realTraffic:'道路流量',realTweets:'推文计数'};
export const MISS_REASONS={unscorable:'窗口内无可评分观测',no_signal:'未超过阈值',cooldown:'超阈值点均被冷却抑制',capacity:'超阈值点均被额度抑制',mixed:'冷却与额度共同抑制'};
const DAY=86400000;
export function isCrossContext(params){return params.get('scope')==='cross'||(params.get('scope')!=='legacy'&&!['series','multiplier','cooldown'].some(k=>params.has(k)));}
export function replayCross(rows,model,threshold,budget=null){
 if(!Number.isFinite(threshold)||threshold<0||(budget!==null&&(!Number.isInteger(budget)||budget<1)))throw Error('告警策略无效');
 let last=-Infinity,recent=[],alerts=[],states=[];
 for(let i=0;i<rows.length;i++){
  const r=rows[i],score=r.scores?.[model];if(!Number.isFinite(r.t)||(i&&r.t<=rows[i-1].t))throw Error('观测时间无效');recent=recent.filter(t=>t>r.t-DAY);let state;
  if(score==null)state='unscorable';else if(!Number.isFinite(score))throw Error('分数无效');else if(score<=threshold)state='quiet';else if(r.t-last<3600000)state='cooldown';else if(budget!==null&&recent.length>=budget)state='capacity';else{state='alert';last=r.t;recent.push(r.t);alerts.push(i);}states.push(state);
 }
 return {alerts,states};
}
export function evaluateCross(rows,windows,model,threshold,days,budget=null){
 const {alerts,states}=replayCross(rows,model,threshold,budget);
 const outside=alerts.filter(i=>!windows.some(w=>w.start<=rows[i].t&&rows[i].t<=w.end)).length;
 const events=windows.map(w=>{const indexes=rows.flatMap((r,i)=>w.start<=r.t&&r.t<=w.end?[i]:[]),hits=indexes.filter(i=>states[i]==='alert'),valid=indexes.filter(i=>states[i]!=='unscorable'),blocked={cooldown:indexes.filter(i=>states[i]==='cooldown').length,capacity:indexes.filter(i=>states[i]==='capacity').length};
 const reason=hits.length?null:!valid.length?'unscorable':!(blocked.cooldown+blocked.capacity)?'no_signal':blocked.cooldown&&blocked.capacity?'mixed':blocked.cooldown?'cooldown':'capacity';
 return {detected:!!hits.length,alerts:hits.length,first_alert:hits.length?rows[hits[0]].t:null,delay_minutes:hits.length?(rows[hits[0]].t-w.start)/60000:null,miss_reason:reason,blocked,scoreable_rows:valid.length};});
 const detected=events.filter(e=>e.detected).length;
 return {alerts,events,alert_count:alerts.length,outside_alerts:outside,outside_per_day:outside/days,alerts_per_day:alerts.length/days,days,event_count:events.length,detected,missed:events.length-detected,recall:events.length?detected/events.length:null,duplicates:alerts.length-outside-detected,suppressed_capacity:states.filter(s=>s==='capacity').length,suppressed_cooldown:states.filter(s=>s==='cooldown').length,unscorable_rows:states.filter(s=>s==='unscorable').length};
}
export function aggregateCross(series,budget,model,mode='capped'){
 const keys=['alert_count','outside_alerts','days','event_count','detected','missed','duplicates','suppressed_capacity','suppressed_cooldown','unscorable_rows'];const total=Object.fromEntries(keys.map(k=>[k,series.reduce((n,s)=>n+s.results[budget][model][mode][k],0)]));
 return {...total,recall:total.event_count?total.detected/total.event_count:null,outside_per_day:total.outside_alerts/total.days,alerts_per_day:total.alert_count/total.days};
}
export function pairedCross(series,budget,model,reference='static'){
 let gained=0,lost=0,both=0,neither=0;
 for(const s of series){const a=s.results[budget][model].capped.events,b=s.results[budget][reference].capped.events;a.forEach((e,i)=>{if(e.detected&&b[i].detected)both++;else if(e.detected)gained++;else if(b[i].detected)lost++;else neither++;});}return {gained,lost,both,neither};
}
export function sameCross(a,b,path='结果'){
 if(typeof a==='number'&&typeof b==='number'){if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1e-9*Math.max(1,Math.abs(a)))throw Error(path+'数值不一致');return;}
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){if(a!==b)throw Error(path+'不一致');return;}
 if(JSON.stringify(Object.keys(a).sort())!==JSON.stringify(Object.keys(b).sort()))throw Error(path+'字段不一致');for(const k of Object.keys(a))sameCross(a[k],b[k],path+'.'+k);
}
export function verifyCrossIndex(p){
 if(p.schema!=='anomaly-cross-v1'||p.series?.length!==43||p.access?.status!=='completed'||p.access.frozen_sha256!==p.frozen_sha256||!p.notice?.includes('Permission is hereby granted'))throw Error('跨序列证据不完整');
 sameCross(p.series.map(s=>s.id),p.protocol.series);sameCross(p.series.map(s=>s.meta),p.audit.series.filter(s=>s.included));
 for(const s of p.series){if(!/^[a-f0-9]{64}\.json$/.test(s.asset?.path)||s.asset.path!==s.asset.sha256+'.json')throw Error('序列路径无效');if(s.results['3'].static.capped.event_count!==s.windows.length)throw Error('事件总数不一致');}
 for(const B of [1,3,6])for(const m of Object.keys(CROSS_METHODS))for(const mode of ['capped','uncapped'])sameCross(aggregateCross(p.series,B,m,mode),p.summary[B][m][mode]);
 return p;
}
export function verifyCrossSeries(s,summary,protocol){
 sameCross(s.meta,summary.meta);sameCross(s.windows,summary.windows);if(s.id!==summary.id||s.rows.length!==s.meta.rows)throw Error('序列内容不一致');
 const a=s.meta.train_end,b=s.meta.cal_end,cal=s.rows.slice(a,b),ev=s.rows.slice(b),days=s.meta.split_hours[2]/24;
 for(const B of protocol.budgets)for(const m of Object.keys(CROSS_METHODS)){
  const c=s.calibration[B][m],values=cal.filter(r=>r.scores).map(r=>r.scores[m]).sort((x,y)=>x-y),duration=s.meta.split_hours[1]/24;
  const candidates=protocol.quantiles.map(q=>{const threshold=values[Math.ceil(q*(values.length-1))],alerts=replayCross(cal,m,threshold).alerts.length;return {q,threshold,alerts,per_day:alerts/duration};});
  const winner=candidates.filter(x=>x.per_day<=B).sort((x,y)=>x.threshold-y.threshold||x.q-y.q)[0];
  sameCross(c,{...winner,days:duration,valid_rows:values.length,candidates});const {candidates:_,...compact}=c;sameCross(compact,summary.thresholds[B][m]);
  for(const mode of ['capped','uncapped']){const actual=evaluateCross(ev,s.windows,m,c.threshold,days,mode==='capped'?B:null);sameCross(actual,s.results[B][m][mode]);const {alerts,...brief}=actual;sameCross(brief,summary.results[B][m][mode]);}
 }
 return s;
}
