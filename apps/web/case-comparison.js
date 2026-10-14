// Comparisons describe frozen outcomes; they do not estimate causal effects.
export function rankOutcome(sample,model){
 const ranking=sample.rankings[model];
 if(!Array.isArray(ranking)||new Set(ranking).size!==ranking.length||typeof sample.target_retrieved!=='boolean')throw new Error('推荐对照数据无效');
 const index=ranking.slice(0,100).indexOf(sample.target),rank=index<0?null:index+1;
 if(rank&&!sample.target_retrieved)throw new Error('目标名次与候选记录不一致');
 return {rank,rr:rank?1/rank:0,hit10:rank!==null&&rank<=10,stage:!sample.target_retrieved?'retrieval':rank===null?'outside100':rank>10?'outside10':'hit'};
}
export function compareRecommendation(sample,model,baseline){
 const current=rankOutcome(sample,model),base=rankOutcome(sample,baseline),delta=current.rr-base.rr;
 const left=sample.rankings[model].slice(0,10),right=sample.rankings[baseline].slice(0,10),common=left.filter(id=>right.includes(id));
 return {current,base,delta,status:delta>0?'improved':delta<0?'worse':'tied',common,added:left.filter(id=>!right.includes(id)),removed:right.filter(id=>!left.includes(id))};
}
export function recommendationCohort(samples,model,baseline){
 const counts={improved:0,tied:0,worse:0};
 const rows=samples.map(sample=>{const result=compareRecommendation(sample,model,baseline);counts[result.status]++;return {sample,result};});
 return {rows,counts,total:rows.length};
}
export function compareForecast(actual,current,baseline){
 if(!actual.length||actual.length!==current.length||actual.length!==baseline.length||[...actual,...current,...baseline].some(x=>!Number.isFinite(x)||x<0))throw new Error('预测对照数据无效');
 const rows=actual.map((value,i)=>{const error=Math.abs(current[i]-value),baseError=Math.abs(baseline[i]-value),gain=baseError-error;return {day:i,actual:value,predicted:current[i],baseline:baseline[i],error,baseError,gain,status:Math.abs(gain)<1e-9?'tied':gain>0?'improved':'worse'};});
 const sum=key=>rows.reduce((n,r)=>n+r[key],0),error=sum('error'),baseError=sum('baseError'),gain=baseError-error;
 const counts={improved:0,tied:0,worse:0};rows.forEach(r=>counts[r.status]++);
 const weeks=Array.from({length:Math.ceil(rows.length/7)},(_,i)=>{const days=rows.slice(i*7,i*7+7);return {week:i+1,error:days.reduce((n,r)=>n+r.error,0),baseError:days.reduce((n,r)=>n+r.baseError,0),gain:days.reduce((n,r)=>n+r.gain,0)};});
 return {rows,weeks,counts,error,baseError,gain,relative:baseError>0?gain/baseError:null,total:sum('actual')};
}
