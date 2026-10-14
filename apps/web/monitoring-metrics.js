export const ANOMALY_MODELS={static:'固定 robust z',rolling:'滚动中位数 / MAD',isolation:'Isolation Forest'};
const near=(a,b)=>{if(a===null&&b===null)return;if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1e-7*Math.max(1,Math.abs(a)))throw new Error('监测指标复算失败');};
export const median=values=>{const a=[...values].sort((x,y)=>x-y),n=a.length;return n?(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2:null;};
function ap(labels,scores){
 const total=labels.filter(Boolean).length;if(!total)return null;
 const order=scores.map((s,i)=>i).sort((a,b)=>scores[b]-scores[a]);let tp=0,n=0,result=0;
 for(let i=0;i<order.length;){let j=i,positive=0;while(j<order.length&&scores[order[j]]===scores[order[i]])positive+=Number(labels[order[j++]]);tp+=positive;n+=j-i;result+=positive/total*tp/n;i=j;}return result;
}
export function alertMetrics(rows,windows,model,threshold,cooldown=60){
 if(!Object.hasOwn(ANOMALY_MODELS,model)||!Number.isFinite(threshold)||threshold<0||!Number.isFinite(cooldown)||cooldown<0||rows.length<2)throw new Error('告警参数无效');
 const times=rows.map(r=>r.t),scores=rows.map(r=>r.scores[model]),labels=times.map(t=>windows.some(w=>w.start<=t&&t<=w.end));
 let tp=0,fp=0,fn=0,tn=0,last=-Infinity;const alerts=[];
 rows.forEach((r,i)=>{const flag=scores[i]>threshold;if(flag){if(labels[i])tp++;else fp++;if(r.t-last>=cooldown*60000){const event=windows.findIndex(w=>w.start<=r.t&&r.t<=w.end);alerts.push({i,t:r.t,event:event<0?null:event});last=r.t;}}else{if(labels[i])fn++;else tn++;}});
 const events=windows.map((w,j)=>{const hits=alerts.filter(a=>a.event===j);return {detected:!!hits.length,first_alert:hits[0]?.t??null,delay_minutes:hits.length?(hits[0].t-w.start)/60000:null,alerts:hits.length};});
 const falseCount=alerts.filter(a=>a.event===null).length,detected=events.filter(e=>e.detected).length,days=(times.at(-1)-times[0]+median(times.slice(1).map((t,i)=>t-times[i])))/86400000;
 return {tp,fp,fn,tn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,fpr:fp+tn?fp/(fp+tn):null,ap:ap(labels,scores),alert_count:alerts.length,false_alerts:falseCount,false_alerts_per_day:falseCount/days,observed_span_days:days,detected_events:detected,event_count:windows.length,event_recall:windows.length?detected/windows.length:null,alert_precision:alerts.length?(alerts.length-falseCount)/alerts.length:null,duplicate_event_alerts:alerts.length-falseCount-detected,median_delay_minutes:median(events.filter(e=>e.detected).map(e=>e.delay_minutes)),events,alerts};
}
export function segmentProfiles(rows,method){
 const total=rows.reduce((s,r)=>s+r.rfm[2],0);
 return Array.from({length:4},(_,group)=>{const a=rows.filter(r=>r[method]===group),gross=a.reduce((s,r)=>s+r.rfm[2],0);return {group,n:a.length,share:a.length/rows.length,median_rfm:a.length?[0,1,2].map(i=>median(a.map(r=>r.rfm[i]))):null,gross,sales_share:total?gross/total:null,future_return_rate:a.length?a.filter(r=>r.future_orders>0).length/a.length:null,future_gross:a.reduce((s,r)=>s+r.future_gross,0)};});
}
export function ruleFor([r,f]){return r>90?0:f===1?1:r<=30&&f>=3?2:3;}
export function adjustedRand(a,b){
 if(a.length!==b.length||a.length<1)throw new Error('ARI 样本不一致');
 const cells=new Map(),left=new Map(),right=new Map();const inc=(m,k)=>m.set(k,(m.get(k)||0)+1),pairs=n=>n*(n-1)/2;
 a.forEach((v,i)=>{inc(cells,`${v}:${b[i]}`);inc(left,v);inc(right,b[i]);});
 const n=pairs(a.length);if(!n)return 1;const s=m=>[...m.values()].reduce((x,v)=>x+pairs(v),0),index=s(cells),l=s(left),r=s(right),expected=l*r/n,maximum=(l+r)/2;
 return maximum===expected?1:(index-expected)/(maximum-expected);
}
export function segmentTransitions(a,b,method){
 const left=new Map(a.map(r=>[r.id,r[method]])),right=new Map(b.map(r=>[r.id,r[method]])),ids=[...left.keys()].filter(k=>right.has(k));
 const matrix=Array.from({length:4},()=>[0,0,0,0]);ids.forEach(k=>matrix[left.get(k)][right.get(k)]++);
 return {common:ids.length,entered:right.size-ids.length,exited:left.size-ids.length,matrix,same_share:ids.filter(k=>left.get(k)===right.get(k)).length/ids.length,ari:adjustedRand(ids.map(k=>left.get(k)),ids.map(k=>right.get(k)))};
}
function alignedRetention(a,b){
 const counts=Array.from({length:4},()=>[0,0,0,0]);a.forEach((v,i)=>counts[v][b[i]]++);let best=null,score=-1;
 const visit=(p,left)=>{if(!left.length){const n=p.reduce((s,v,i)=>s+counts[i][v],0);if(n>score){score=n;best=p;}return;}for(const v of left)visit([...p,v],left.filter(x=>x!==v));};visit([],[0,1,2,3]);
 return best.map((v,i)=>counts[i][v]/counts[i].reduce((s,x)=>s+x,0));
}
function silhouette(z,labels){
 const n=z.length,result=[];const counts=[0,0,0,0];labels.forEach(v=>counts[v]++);
 for(let i=0;i<n;i++){if(counts[labels[i]]===1){result.push(0);continue;}const sums=[0,0,0,0];for(let j=0;j<n;j++)if(i!==j)sums[labels[j]]+=Math.hypot(...z[i].map((v,k)=>v-z[j][k]));
  const a=sums[labels[i]]/(counts[labels[i]]-1),b=Math.min(...sums.map((v,g)=>g===labels[i]||!counts[g]?Infinity:v/counts[g]));result.push(Math.max(a,b)?(b-a)/Math.max(a,b):0);
 }return result.reduce((s,v)=>s+v,0)/n;
}
export function verifyMonitoring(p,{deep=false}={}){
 if(!['anomaly','segments'].includes(p.kind)||!p.run_id?.startsWith(p.kind+'-')||p.protocol?.version!=='r5-v1'||!p.notice||!/^[a-f0-9]{64}$/.test(p.frozen_sha256))throw new Error('监测案例版本不一致');
 if(p.kind==='anomaly'){
  if(p.series?.length!==3||p.access?.status!=='completed'||p.access.frozen_sha256!==p.frozen_sha256)throw new Error('异常评估范围无效');
  for(const s of p.series){
   if(!p.protocol.anomaly.series.includes(s.id)||s.rows.length!==s.raw_rows-s.duplicate_timestamps_removed)throw new Error('异常序列数量不一致');
   s.rows.forEach((r,i)=>{if(!Number.isFinite(r.t)||!Number.isFinite(r.v)||(i&&r.t<=s.rows[i-1].t)||r.split!==(i<s.train_end?'train':i<s.cal_end?'calibration':'evaluation'))throw new Error('异常时间边界不一致');if(r.scores&&Object.keys(ANOMALY_MODELS).some(m=>!Number.isFinite(r.scores[m])||r.scores[m]<0))throw new Error('异常分数无效');});
   const rows=s.rows.filter(r=>r.split==='evaluation'&&r.scores);if(rows.length!==s.evaluation_rows)throw new Error('异常评估点数量不一致');
   for(const m of Object.keys(ANOMALY_MODELS)){
    const cal=s.rows.filter(r=>r.split==='calibration'&&r.scores).map(r=>r.scores[m]).sort((a,b)=>a-b);near(cal[Math.ceil((cal.length-1)*.99)],s.thresholds[m]);
    const v=alertMetrics(rows,s.windows,m,s.thresholds[m]);for(const key of Object.keys(v))if(!['events','alerts'].includes(key))near(v[key],s.metrics[m][key]);
    if(JSON.stringify(v.events)!==JSON.stringify(s.metrics[m].events)||JSON.stringify(v.alerts)!==JSON.stringify(s.metrics[m].alerts))throw new Error('事件告警记录不一致');
   }
  }
 }else{
  if(p.snapshots?.length!==2||p.stability?.length!==10)throw new Error('分群范围无效');
  for(const [i,s] of p.snapshots.entries()){
   if(s.origin!==p.protocol.segmentation.origins[i]||new Set(s.rows.map(r=>r.id)).size!==s.rows.length)throw new Error('分群样本或时点不一致');
   for(const r of s.rows){
    if(r.rfm.length!==3||r.rfm.some(v=>!Number.isFinite(v)||v<0)||r.rfm[0]>=180||r.rfm[1]<1||r.rfm[2]<=0||!Number.isInteger(r.future_orders)||r.future_orders<0||!Number.isFinite(r.future_gross)||r.future_gross<0)throw new Error('RFM 字段无效');
    const z=r.rfm.map((v,k)=>(Math.log1p(v)-p.model.scaler_center[k])/p.model.scaler_scale[k]),dist=p.model.centers.map(c=>c.reduce((sum,v,k)=>sum+(v-z[k])**2,0));
    if(dist.indexOf(Math.min(...dist))!==r.cluster||ruleFor(r.rfm)!==r.rule)throw new Error('分群不能由冻结模型重现');
    r.xy.forEach((v,j)=>near(v,p.model.pca_components[j].reduce((sum,c,k)=>sum+c*(z[k]-p.model.pca_mean[k]),0)));
   }
   for(const method of ['cluster','rule'])segmentProfiles(s.rows,method).forEach((v,g)=>{for(const key of Object.keys(v))if(key==='median_rfm'){if(v[key]===null){if(s.profiles[method][g][key]!==null)throw new Error('空群画像无效');}else v[key].forEach((x,k)=>near(x,s.profiles[method][g][key][k]));}else near(v[key],s.profiles[method][g][key]);});
   if(deep){const byId=new Map(s.rows.map(r=>[r.id,r])),sample=s.silhouette_ids.map(id=>byId.get(id));if(sample.length!==s.silhouette_n||sample.some(r=>!r))throw new Error('轮廓系数样本不一致');const z=sample.map(r=>r.rfm.map((v,k)=>(Math.log1p(v)-p.model.scaler_center[k])/p.model.scaler_scale[k]));for(const m of ['cluster','rule'])near(silhouette(z,sample.map(r=>r[m])),s.silhouette[m]);}
  }
  for(const m of ['cluster','rule']){const a=segmentTransitions(p.snapshots[0].rows,p.snapshots[1].rows,m),b=p.transitions[m];for(const k of ['common','entered','exited','same_share','ari'])near(a[k],b[k]);if(JSON.stringify(a.matrix)!==JSON.stringify(b.matrix))throw new Error('分群迁移不一致');}
  const baseline=p.snapshots[0].rows.map(r=>r.cluster);for(const s of p.stability){near(adjustedRand(baseline,s.assignments),s.ari);alignedRetention(baseline,s.assignments).forEach((v,i)=>near(v,s.retention[i]));}
 }return p;
}
