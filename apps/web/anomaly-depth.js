import {ANOMALY_MODELS as MODELS,alertMetrics} from './monitoring-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:3});
const date=t=>t==null?'—':new Date(t).toISOString().replace('T',' ').slice(0,16);
const table=(headers,rows,label)=>`<div class="table-scroll monitoring-table" role="region" tabindex="0" aria-label="${esc(label)}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const ALERT_STATES={quiet:'未超阈值',suppressed:'超阈值，冷却抑制',first:'事件首报',repeat:'同事件重复告警',outside:'窗口外告警'};
// Always replay the complete evaluation interval before selecting a display window.
export function auditAlerts(rows,windows,model,threshold,cooldown=60){
 const metrics=alertMetrics(rows,windows,model,threshold,cooldown),emitted=new Map(metrics.alerts.map(a=>[a.i,a])),seen=new Set(),counts=Object.fromEntries(Object.keys(ALERT_STATES).map(k=>[k,0]));let last=null;
 const decisions=rows.map((r,i)=>{
  const event=windows.findIndex(w=>w.start<=r.t&&r.t<=w.end),flag=r.scores[model]>threshold,alert=emitted.get(i);let state='quiet';
  const blockedBy=flag&&!alert?last:null,remaining=blockedBy==null?0:Math.max(0,cooldown-(r.t-blockedBy)/60000);
  if(alert){state=event<0?'outside':seen.has(event)?'repeat':'first';if(event>=0)seen.add(event);last=r.t;}else if(flag)state='suppressed';
  counts[state]++;return {i,t:r.t,event:event<0?null:event,state,blockedBy,remaining};
 });
 const events=windows.map((w,j)=>{const points=decisions.filter(d=>d.event===j),raw=points.filter(d=>d.state!=='quiet').length,suppressed=points.filter(d=>d.state==='suppressed').length;return {...metrics.events[j],raw,suppressed,miss:metrics.events[j].detected?null:raw?'cooldown':'no_signal'};});
 return {model,threshold,cooldown,metrics,decisions,counts,events};
}
export function seriesAudits(series,multiplier=1,cooldown=60){
 const rows=series.rows.filter(r=>r.split==='evaluation'&&r.scores);
 if(!Number.isFinite(multiplier)||multiplier<=0)throw new Error('阈值倍数无效');
 return Object.fromEntries(Object.keys(MODELS).map(model=>[model,auditAlerts(rows,series.windows,model,series.thresholds[model]*multiplier,cooldown)]));
}
const symbols={first:(x,y)=>`<circle cx="${x}" cy="${y}" r="5" fill="#bc584e"/>`,repeat:(x,y)=>`<rect x="${x-2.5}" y="${y-2.5}" width="5" height="5" fill="#bc584e"/>`,outside:(x,y)=>`<path d="M${x},${y-4}l4,8h-8Z" fill="#af8038"/>`,suppressed:(x,y)=>`<path d="M${x},${y-3}v6" stroke="#8799a7"/>`};
export function alignedTimeline(series,audits,window='all'){
 const rows=series.rows.filter(r=>r.split==='evaluation'&&r.scores),w=series.windows[Number(window)],shown=w?rows.filter(r=>r.t>=w.start-86400000&&r.t<=w.end+86400000):rows;
 const loT=shown[0].t,hiT=shown.at(-1).t,low=Math.min(...shown.map(r=>r.v)),high=Math.max(...shown.map(r=>r.v)),x=t=>170+(t-loT)/Math.max(1,hiT-loT)*740,y=v=>142-(v-low)/Math.max(1e-8,high-low)*110;
 const step=Math.max(1,Math.ceil(shown.length/350)),points=[];
 for(let i=0;i<shown.length;i+=step){const bucket=shown.slice(i,i+step);points.push(...[bucket[0],bucket.reduce((a,b)=>a.v<b.v?a:b),bucket.reduce((a,b)=>a.v>b.v?a:b),bucket.at(-1)].sort((a,b)=>a.t-b.t));}
 return `<div class="monitoring-chart anomaly-aligned" role="region" tabindex="0" aria-label="同一时段三种方法的告警时间线"><svg viewBox="0 0 960 425" role="img" aria-label="原始测量值及三种方法对齐的告警轨道；形状区分首报、重复、窗口外及冷却抑制"><path d="M170 20V370H910" fill="none" stroke="#b9cddd"/>${series.windows.filter(v=>v.end>=loT&&v.start<=hiT).map(v=>`<rect x="${x(Math.max(loT,v.start))}" y="20" width="${Math.max(1,x(Math.min(hiT,v.end))-x(Math.max(loT,v.start)))}" height="350" fill="#bc584e" opacity=".09"/>`).join('')}<text x="15" y="45">原始测量值</text><text x="160" y="35" text-anchor="end">${num(high)}</text><text x="160" y="145" text-anchor="end">${num(low)}</text><path d="${points.map((r,i)=>`${i?'L':'M'}${x(r.t)},${y(r.v)}`).join(' ')}" fill="none" stroke="#087f9d" stroke-width="1.2"/>${Object.entries(MODELS).map(([model,label],i)=>{const cy=210+i*65;return `<text x="15" y="${cy-12}">${esc(label)}</text><path d="M170 ${cy}H910" stroke="#dce7ee"/>${audits[model].decisions.filter(d=>d.state!=='quiet'&&d.t>=loT&&d.t<=hiT).sort((a,b)=>Number(a.state==='first')-Number(b.state==='first')).map(d=>`<g><title>${date(d.t)} · ${ALERT_STATES[d.state]}</title>${symbols[d.state](x(d.t),cy)}</g>`).join('')}`;}).join('')}<text x="170" y="403">${date(loT)}</text><text x="910" y="403" text-anchor="end">${date(hiT)}</text></svg></div><p class="small-note">浅红区域为标注容忍窗口；红圆：事件首报，红方：同事件重复，棕三角：窗口外告警，灰竖线：超阈值但被冷却抑制。三条轨道共用时间轴，不比较分数大小。曲线按桶保留极值，告警点未抽样；密集重叠以表格计数为准。时间沿用源文件，不推断时区。</p>`;
}
export function eventComparison(series,audits,window='all'){
 const indices=window==='all'?series.windows.map((_,i)=>i):[Number(window)];
 return `<section class="m5-section anomaly-event-comparison"><h2>同一事件的三种方法对照</h2><p>当前显示${window==='all'?'全部标注事件':`事件 ${Number(window)+1} 及前后一天`}。三种方法各自使用冻结校准阈值 × 当前倍数、相同冷却分钟；先回放整段评估，再截取图表，不在窗口边缘重置冷却。</p>${alignedTimeline(series,audits,window)}${table(['事件 / 方法','首个发出告警','距窗口起点（分）','窗口内超阈值点','被冷却抑制','窗口内告警 / 重复','检测结论'],indices.flatMap(i=>Object.entries(MODELS).map(([model,label])=>{const e=audits[model].events[i];return [`事件 ${i+1} / ${label}`,date(e.first_alert),num(e.delay_minutes),e.raw,e.suppressed,`${e.alerts} / ${Math.max(0,e.alerts-1)}`,e.detected?'已命中':e.miss==='cooldown'?'漏检：全部触发被冷却抑制':'漏检：窗口内未超阈值'];})),'同一事件多方法首报与漏检')}<p>首报间隔从标注容忍窗口起点计算，不能当作实际故障延迟或提前发现时间。未命中显示“—”，不按零延迟计入中位数；图中窗口以评估边界截断，原始起止见事件记录。</p></section>`;
}
export function pointComparison(point,audits){
 return `<section class="anomaly-point-comparison"><h3>同一观测的告警决策</h3>${table(['方法','保存分数 / 当前阈值','该点处理','冷却依据'],Object.entries(MODELS).map(([model,label])=>{const a=audits[model],d=a.decisions.find(d=>d.t===point.t);return [label,`${num(point.scores[model])} / ${num(a.threshold)}`,ALERT_STATES[d.state],d.blockedBy==null?'—':`上次发出 ${date(d.blockedBy)}；还需 ${num(d.remaining)} 分钟`];}),'同一点三种方法告警决策')}<p class="small-note">分数严格大于各自阈值才触发；显示值经过舍入，实际比较使用完整精度。抑制点不会延长冷却，只有新发出的告警重新计时。窗口外按本基准记误报，不足以确认真实系统没有异常。</p></section>`;
}
