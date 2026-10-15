import {uciData,verifyUciManifest} from './uci-static.js';
export const RELIABILITY_MODELS=['zero','last_week','four_week_mean','four_week_median','autoets','lightgbm'];
const sum=a=>a.reduce((x,y)=>x+y,0);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'不定义':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const pct=v=>v==null?'不定义':`${(100*v).toFixed(2)}%`;
const table=(heads,rows,title)=>`<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(title)}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const historyScale=r=>Math.max(1,sum(r.history)/8);
export function residualQuantile(values,target=.9){const rank=Math.ceil((values.length+1)*target);return values.length&&rank<=values.length?[...values].sort((a,b)=>a-b)[rank-1]:null;}
export function reliabilityPoint(rows,model){const total=sum(rows.map(r=>r.actual)),error=sum(rows.map(r=>Math.abs(r.predictions[model]-r.actual)));return {n:rows.length,wape:total?error/total:null,mae:error/rows.length,bias:total?sum(rows.map(r=>r.predictions[model]-r.actual))/total:null};}
export function reliabilityInterval(rows,model){
 const part=rows.filter(r=>r.intervals!==null);if(!part.length)return null;
 let covered=0,below=0,above=0,width=0,normalized=0,score=0;
 for(const r of part){const {lower:l,upper:u}=r.intervals[model],y=r.actual;covered+=l<=y&&y<=u;below+=y<l;above+=y>u;width+=u-l;normalized+=(u-l)/r.scale;score+=u-l+20*Math.max(l-y,y-u,0);}
 return {n:part.length,covered,below,above,coverage:covered/part.length,mean_width:width/part.length,mean_scaled_width:normalized/part.length,interval_score:score/part.length};
}
export function verifyUciReliability(p,parent,manifest){
 const fail=why=>{throw new Error(`UCI 可靠性校验失败：${why}`);};
 const match=(a,b,path='')=>{
  if(typeof b==='number'){if(!Number.isFinite(a)||Math.abs(a-b)>1e-8*Math.max(1,Math.abs(b)))fail(path);}
  else if(b===null||typeof b!=='object'){if(a!==b)fail(path);}
  else{if(!a||JSON.stringify(Object.keys(a).sort())!==JSON.stringify(Object.keys(b).sort()))fail(path);for(const k of Object.keys(b))match(a[k],b[k],`${path}.${k}`);}
 };
 if(p?.schema!=='uci-reliability-v1'||p.parent_run!==manifest.run_id||p.parent_version!==manifest.version||p.protocol?.target_coverage!==.9||p.protocol.minimum_complete_windows!==4||p.protocol.minimum_rows!==48||p.protocol.evidence_level!=='known_development_diagnostic'||JSON.stringify(p.protocol.models)!==JSON.stringify(RELIABILITY_MODELS))fail('协议或父版本');
 for(const n of ['report.json','weekly-series.json','forecast-series.json'])if(p.sources?.[n]!==manifest.files[n].sha256||p.protocol.sources[n]!==p.sources[n])fail('源哈希');
 const rows=parent.series,origins=[...new Set(rows.map(r=>r.origin))].sort(),items=[...new Set(rows.map(r=>r.item))].sort();
 if(rows.length!==144||origins.length!==12||items.length!==12||new Set(rows.map(r=>r.origin+':'+r.item)).size!==144||!Array.isArray(p.records)||p.records.length!==144||p.windows?.length!==12)fail('商品窗口范围');
 const expected=[];
 for(const [wi,origin] of origins.entries()){
  const past=rows.filter(r=>r.end<origin),prior=[...new Set(past.map(r=>r.origin))].sort(),eligible=prior.length>=4&&past.length>=48;
  const quantiles=eligible?Object.fromEntries(RELIABILITY_MODELS.map(m=>[m,residualQuantile(past.map(r=>Math.abs(r.actual-r.predictions[m])/historyScale(r)))])):null;
  const current=rows.filter(r=>r.origin===origin).sort((a,b)=>a.item.localeCompare(b.item)).map(r=>{
   if(r.history.length!==56||r.history_dates.some(d=>d>=origin)||![r.actual,...r.history,...Object.values(r.predictions)].every(v=>Number.isFinite(v)&&v>=0))fail('输入或历史边界');
   const scale=historyScale(r);return {origin,end:r.end,item:r.item,actual:r.actual,scale,predictions:r.predictions,intervals:eligible?Object.fromEntries(RELIABILITY_MODELS.map(m=>[m,{lower:Math.max(0,r.predictions[m]-quantiles[m]*scale),upper:r.predictions[m]+quantiles[m]*scale}])):null};
  });
  expected.push(...current);
  match(p.windows[wi],{origin,end:current[0].end,calibration_origins:prior,calibration_n:past.length,calibration_end:past.length?past.map(r=>r.end).sort().at(-1):null,eligible,quantiles,models:Object.fromEntries(RELIABILITY_MODELS.map(m=>[m,{point:reliabilityPoint(current,m),interval:reliabilityInterval(current,m)}]))},'window');
 }
 match(p.records,expected,'intervals');const eligible=expected.filter(r=>r.intervals);
 match(p.summary,Object.fromEntries(RELIABILITY_MODELS.map(m=>[m,{all_point:reliabilityPoint(expected,m),eligible_point:reliabilityPoint(eligible,m),interval:reliabilityInterval(eligible,m)}])),'summary');
 match(p.by_item,Object.fromEntries(items.map(item=>[item,Object.fromEntries(RELIABILITY_MODELS.map(m=>[m,reliabilityInterval(eligible.filter(r=>r.item===item),m)]))])),'item');
 return p;
}
let cached;
export async function loadUciReliability(){
 if(!cached)cached=(async()=>{
  const [response,mResponse,parent]=await Promise.all([fetch('./uci-reliability-results/manifest.json',{cache:'no-cache'}),fetch('./uci-results/manifest.json',{cache:'no-cache'}),uciData('weekly-forecasts')]);
  if(!response.ok||!mResponse.ok)throw new Error('UCI 可靠性结果尚未导出');
  const m=await response.json(),parentManifest=verifyUciManifest(await mResponse.json());
  if(!/^[a-f0-9]{16}\/case\.json$/.test(m.path)||!/^[a-f0-9]{64}$/.test(m.sha256))throw new Error('可靠性清单无效');
  const r=await fetch(`./uci-reliability-results/${m.path}`);if(!r.ok)throw new Error('可靠性文件缺失');
  const bytes=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==m.sha256)throw new Error('可靠性文件校验失败');
  const p=verifyUciReliability(JSON.parse(new TextDecoder().decode(bytes)),parent,parentManifest);
  if(p.parent_run!==m.parent_run||p.protocol_sha256!==m.protocol_sha256)throw new Error('可靠性协议版本不一致');
  return p;
 })().catch(e=>{cached=null;throw e;});return cached;
}
export function pointStabilityHtml(summary,model,baseline,task='weekly_sales'){
 const windows=summary.windows,weekly=task==='weekly_sales',name=m=>esc(summary.models[m].label),wins=windows.filter(w=>w.models[model].wape<w.models[baseline].wape).length,ties=windows.filter(w=>w.models[model].wape===w.models[baseline].wape).length;
 const worst=[...windows].sort((a,b)=>b.models[model].wape-a.models[model].wape)[0];
 return `<section class="report-panel uci-stability"><h2>跨窗口表现：改善是否持续</h2><p>同 12 件商品、全部 ${windows.length} 个${weekly?'7 日总量':'28 日逐日'}窗口。当前方法相对对照的 WAPE：改善 ${wins} 窗口、持平 ${ties}、退步 ${windows.length-wins-ties}。当前最差窗口 ${worst.origin}，WAPE ${pct(worst.models[model].wape)}。${weekly?'此处含前四个积累残差的窗口；区间评分单独使用后八个窗口。':'仅三个起点，不足以说明跨季节稳定性。'}</p><details><summary>全部窗口的误差与偏差</summary>${table(['起点','当前 WAPE ↓','对照 WAPE ↓','当前总量偏差','对照总量偏差'],windows.map(w=>[w.origin,pct(w.models[model].wape),pct(w.models[baseline].wape),pct(w.models[model].bias),pct(w.models[baseline].bias)]),'逐窗口预测稳定性')}</details><p class="small-note">当前 ${name(model)}；对照 ${name(baseline)}。偏差负数表示总量低估，正数表示高估；误差按每窗全部商品计算。窗口不是独立重复实验，旧模型选择已参考这些开发结果。</p>${weekly?'':'<p class="validation-boundary">28 日任务只有 3 个已发布起点，未达到至少 4 个已结束窗口的残差积累条件，本轮不提供逐日预测区间。每窗 28 天的相关误差不能当作 28 个独立起点，也不借用周总量或 M5 区间。</p>'}</section>`;
}
export function reliabilityHtml(p,s,model,baseline,summary,error=''){
 if(!p)return `<section class="report-panel"><h2>预测区间暂不可用</h2><p>${esc(error||'可靠性结果缺失')}。仍可查看已核验的点预测；不以示意范围代替实验。</p></section>`;
 const models=[...new Set([model,baseline])],name=m=>esc(summary.models[m].label),r=p.records.find(r=>r.origin===s.origin&&r.item===s.item),w=p.windows.find(w=>w.origin===s.origin),interval=m=>p.summary[m].interval;
 const one=m=>{const v=r.intervals?.[m];return `<section><h3>${name(m)}</h3>${v?`<p><strong>${num(v.lower)}～${num(v.upper)} 件</strong> · 7 天总量参考区间</p><p>点预测 ${num(r.predictions[m])} 件，实际 ${num(r.actual)} 件。${r.actual<v.lower?'实际低于下界':r.actual>v.upper?'实际超过上界':'实际落在区间内'}；区间宽 ${num(v.upper-v.lower)} 件。</p>`:'<p>历史残差积累不足，当前窗口不提供区间。</p>'}</section>`;};
 const chart=r.intervals?(()=>{const max=Math.max(r.actual,...models.map(m=>r.intervals[m].upper),1)*1.08,x=v=>190+v/max*490;return `<svg class="weekly-chart" viewBox="0 0 740 155" role="img" aria-label="当前商品的预测区间、点预测及真实销量"><text x="190" y="15">七日销量 / 件；线段为区间，圆点为点预测，竖线为实际</text>${models.map((m,i)=>{const v=r.intervals[m],y=47+i*50;return `<text x="8" y="${y+4}">${m===model?'当前方法':'对照方法'}</text><path d="M${x(v.lower)} ${y}H${x(v.upper)}" stroke="${m===model?'#087f9d':'#af8038'}" stroke-width="8"/><circle cx="${x(r.predictions[m])}" cy="${y}" r="6" fill="#17324d"/><path d="M${x(r.actual)} ${y-14}V${y+14}" stroke="#17324d" stroke-width="2"/><text x="190" y="${y+25}">${num(v.lower)}～${num(v.upper)}；实际 ${num(r.actual)}</text>`;}).join('')}</svg>`;})():'';
 return `<section class="report-panel uci-reliability"><h2>预测区间与可靠性</h2><p>目标覆盖 90% 的历史残差参考区间，用于判断预测可能偏离多少。${esc(s.item)} · ${s.origin}～${s.end}。覆盖率是多条记录的统计，不能解释成这件商品未来有 90% 的保证。</p><div class="depth-duel">${models.map(one).join('')}</div>${chart}<p>当前可用 ${w.calibration_origins.length} 个已结束窗口、${w.calibration_n} 个商品周残差${w.calibration_end?`，最晚目标结束于 ${w.calibration_end}`:''}。${w.eligible?'全部早于当前预测起点；每个商品自身只有 '+w.calibration_origins.length+' 个残差，区间采用跨商品的尺度化残差池。':'本协议至少积累 4 个完整窗口、48 个商品周；这是计算门槛，不代表统计保证。前四个窗口保留点预测。'}</p>${w.eligible?`<p>当前窗口全部 12 件商品：${name(model)} 覆盖 ${w.models[model].interval.covered}/12，总量偏差 ${pct(w.models[model].point.bias)}（负数为低估）。这是当前时段的整体诊断，不是所选商品的覆盖概率。</p>`:''}${w.eligible?'':'<button class="outline" id="uci-first-interval" type="button">查看首个可校准窗口 · 2011-10-01</button>'}<h3>后 8 个窗口、96 个商品周的区间效果</h3>${table(['方法','落在区间内','实际低于下界／高于上界','平均区间宽度（件）','宽度／历史周均量','区间分数 ↓'],models.map(m=>{const v=interval(m);return [name(m),`${v.covered}/${v.n} · ${pct(v.coverage)}`,`${v.below} / ${v.above}`,num(v.mean_width),`${num(v.mean_scaled_width)} 倍`,num(v.interval_score)];}),'同范围区间可靠性')}<p>当前方法 ${name(model)}：${interval(model).coverage<.9?'历史覆盖未达到':'历史覆盖达到'}目标 90%；${interval(model).above} 条实际销量高于上界。即使覆盖接近目标，各商品周区间宽度／自身历史周均量的平均值达 ${num(interval(model).mean_scaled_width)} 倍，也只能作为范围参考，不能直接将上界当作订货量。</p><p>同 96 条上的点预测 WAPE：${models.map(m=>`${name(m)} ${pct(p.summary[m].eligible_point.wape)}`).join('；')}。与下方全部 144 条的范围不同，不跨范围计算改善。</p><p class="small-note">区间分数同时惩罚过宽和越界，越低越好；比较覆盖时必须同时看宽度。此表为 2011-10-01～2011-11-28 的事后汇总，固定同 96 条，包含所有商品，不随当前样本选择改变。</p><details><summary>逐窗口覆盖与偏差：哪些时段更容易失效</summary>${table(['起点','校准窗口／商品周',...models.map(m=>`${name(m)}：覆盖／宽度／偏差`)],p.windows.map(w=>[w.origin,`${w.calibration_origins.length} / ${w.calibration_n}`,...models.map(m=>{const v=w.models[m];return v.interval?`${v.interval.covered}/12 · ${num(v.interval.mean_width)} 件 · ${pct(v.point.bias)}`:'积累残差，未评分区间';})]),'逐窗口区间诊断')}<p>每窗只含 12 件商品，单条越界就改变覆盖率 8.33 个百分点。下列单品每件仅 8 次评估，适合定位失败，不能证明单品覆盖率稳定。</p>${table(['商品',...models.map(m=>`${name(m)}：覆盖／平均宽度`)],Object.entries(p.by_item).map(([item,v])=>[esc(item),...models.map(m=>`${v[m].covered}/${v[m].n} · ${num(v[m].mean_width)} 件`)]),'全部商品区间诊断')}</details><details><summary>区间计算、时间边界与适用条件</summary><p>对每个历史商品周，尺度 = max(1，起点前 56 天销量合计 ÷ 8)，残差分数 = |实际 − 保存预测| ÷ 该时点尺度。仅收集目标结束日早于预测起点的记录。按分数升序取第 ceil((n+1)×0.9) 个作为 q；当前区间为 [max(0，预测−q×尺度)，预测+q×尺度]。</p><p>本条尺度 ${num(r.scale)} 件。${w.quantiles?models.map(m=>`${name(m)} 的 q=${num(w.quantiles[m])}`).join('；'):'当前不足以计算 q'}。区间分数 = 宽度 + 20 × 区间外距离；尺度化宽度按每条宽度／该条尺度后平均。各条等权，未按销量筛选。</p><p>本轮不重训、不重选参数。原 LightGBM 参数已按全部 12 个窗口选择；只让残差按时间进入，不能消除既有选模反馈。商品间和时间上有关联、模型逐窗重拟合，不满足标准交换性条件，因此不宣称严格保覆盖。这是已知开发数据的诊断，不是新独立测试。</p><p>有稳定口径、足够历史且误差范围可接受时，可辅助人工判断需求规模。遇到未记录的促销、断货、商品变化或超出历史范围时，应增加业务信息并人工复核；真实上线需要更多时段、独立数据和库存成本验证。销量也不等于缺货时的真实需求。</p><p>方法参考：<a href="https://arxiv.org/abs/2202.13415" target="_blank" rel="noreferrer">Conformal prediction beyond exchangeability</a>。本站未实现其漂移修正算法。</p></details></section>`;
}
