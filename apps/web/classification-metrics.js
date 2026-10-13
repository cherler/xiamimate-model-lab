export const CLASSIFICATION_MODELS={rules:'四项规则',logistic:'逻辑回归',lightgbm:'LightGBM'};
export function applyPolicy(rows,model,{mode='threshold',threshold=.5,share=.2}={}){
 if(!Object.hasOwn(CLASSIFICATION_MODELS,model))throw new Error('模型不存在');
 if(!['threshold','capacity'].includes(mode)||!Number.isFinite(threshold)||threshold<0||threshold>1.000001||!Number.isFinite(share)||share<0||share>1)throw new Error('策略参数无效');
 const ordered=[...rows].sort((a,b)=>b.scores[model]-a.scores[model]||(a.group<b.group?-1:a.group>b.group?1:0)||a.source_row-b.source_row);
 return new Set((mode==='capacity'?ordered.slice(0,Math.floor(rows.length*share)):ordered.filter(r=>r.scores[model]>=threshold)).map(r=>r.id));
}
export function confusionCounts(rows,selected){
 const counts={tp:0,fp:0,fn:0,tn:0};
 for(const row of rows)counts[selected.has(row.id)?(row.label?'tp':'fp'):(row.label?'fn':'tn')]++;
 const {tp,fp,fn,tn}=counts;
 return {...counts,selected:tp+fp,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,fpr:fp+tn?fp/(fp+tn):null};
}
export function scoreMetrics(rows,model,source='scores'){
 if(!rows.length)throw new Error('没有评分记录');
 const n=rows.length,positives=rows.reduce((s,r)=>s+r.label,0),negatives=n-positives;
 if(!positives||!negatives)throw new Error('需要两类标签');
 const sorted=[...rows].sort((a,b)=>b[source][model]-a[source][model]);
 let tp=0,fp=0,ap=0,auc=0;
 const pr=[{recall:0,precision:1}];
 for(let i=0;i<n;){let j=i,positive=0;while(j<n&&sorted[j][source][model]===sorted[i][source][model]){positive+=sorted[j].label;j++;}
  const negative=j-i-positive;tp+=positive;fp+=negative;
  ap+=positive/positives*tp/(tp+fp);auc+=positive*(negatives-fp+.5*negative);
  pr.push({recall:tp/positives,precision:tp/(tp+fp)});i=j;
 }
 const bins=Array.from({length:10},(_,i)=>({lower:i/10,upper:(i+1)/10,n:0,mean_score:0,positive_rate:0}));
 let brier=0,loss=0;
 for(const row of rows){const p=row[source][model],bin=bins[Math.min(9,Math.floor(p*10))];
  bin.n++;bin.mean_score+=p;bin.positive_rate+=row.label;brier+=(p-row.label)**2;
  const clipped=Math.max(Number.EPSILON,Math.min(1-Number.EPSILON,p));loss-=row.label?Math.log(clipped):Math.log1p(-clipped);
 }
 let ece=0;for(const bin of bins){if(bin.n){bin.mean_score/=bin.n;bin.positive_rate/=bin.n;ece+=bin.n*Math.abs(bin.mean_score-bin.positive_rate)/n;}else{bin.mean_score=null;bin.positive_rate=null;}}
 return {n,positives,prevalence:positives/n,ap,roc_auc:auc/(positives*negatives),brier:brier/n,log_loss:loss/n,ece,bins,pr};
}
export function verifyClassification(payload){
 const r=payload.report;
 if(!payload.run_id||payload.run_id!==r.run_id||r.test_access?.status!=='completed')throw new Error('分类结果版本或测试记录无效');
 const seen=new Set();
 for(const split of ['validation','test']){
  const rows=payload.rows[split];if(rows?.length!==r.split_sizes[split])throw new Error('分类样本数量不一致');
  const groups=new Set();const ids=new Set();
  for(const row of rows){
   if(![0,1].includes(row.label)||ids.has(row.id)||seen.has(row.group)||row.features.length!==r.features.length||row.features.some(v=>!Number.isFinite(v)||v<0))throw new Error('分类样本或分区无效');
   ids.add(row.id);groups.add(row.group);
   for(const name of Object.keys(CLASSIFICATION_MODELS))for(const source of ['scores','raw_scores'])if(!Number.isFinite(row[source]?.[name])||row[source][name]<0||row[source][name]>1)throw new Error('分类分数无效');
  }
  for(const g of groups)seen.add(g);
  for(const model of Object.keys(CLASSIFICATION_MODELS)){
   for(const [kind,source] of [['calibrated','scores'],['raw','raw_scores']]){
    const calculated=scoreMetrics(rows,model,source),stored=r[split][model][kind];
    for(const key of ['n','positives','prevalence','ap','roc_auc','brier','log_loss','ece'])if(!Number.isFinite(stored[key])||Math.abs(calculated[key]-stored[key])>1e-9)throw new Error('分类指标复算失败');
    for(let i=0;i<10;i++)for(const key of ['n','mean_score','positive_rate']){
     const a=calculated.bins[i][key],b=stored.bins[i][key];if(a===null?b!==null:b===null||!Number.isFinite(b)||Math.abs(a-b)>1e-9)throw new Error('校准分箱复算失败');
    }
   }
   const c=confusionCounts(rows,applyPolicy(rows,model,{threshold:r.thresholds[model]}));
   for(const key of Object.keys(c)){const a=c[key],b=r[split][model].policy[key];if(a===null?b!==null:b===null||!Number.isFinite(b)||Math.abs(a-b)>1e-9)throw new Error('默认策略复算失败');}
  }
 }
 return payload;
}
