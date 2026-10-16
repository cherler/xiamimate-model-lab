import {INPUT_VARIANTS as VARIANTS,INPUT_MODELS as MODELS,inputPair,verifyInputs} from './classification-input-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toFixed(4),pct=v=>`${(v*100).toFixed(2)}%`,signed=v=>`${v>0?'+':''}${num(v)}`;
const table=(headers,rows,label)=>`<div class="table-scroll classification-table" role="region" tabindex="0" aria-label="${esc(label)}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const select=(id,label,options,value)=>`<label for="${id}">${label}<select id="${id}">${Object.entries(options).map(([v,n])=>`<option value="${v}" ${String(value)===v?'selected':''}>${n}</option>`).join('')}</select></label>`;
const name=key=>{const [v,m]=key.split(':');return `${MODELS[m]} · ${VARIANTS[v]}`;};
let pending;
export async function loadInputs(parent){
 if(!pending)pending=(async()=>{
  const r=await fetch('./classification-input-results/manifest.json',{cache:'no-cache'});if(!r.ok)throw Error('输入价值实验尚未导出');const m=await r.json();
  if(!/^[a-f0-9]{64}\.json$/.test(m.path)||m.path!==m.sha256+'.json')throw Error('输入价值路径无效');
  const response=await fetch('./classification-input-results/'+m.path);if(!response.ok)throw Error('输入价值实验文件缺失');
  const bytes=await response.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(sha!==m.sha256)throw Error('输入价值文件校验失败');const data=JSON.parse(new TextDecoder().decode(bytes));if(data.run_id!==m.run_id||data.parent_run!==m.parent_run)throw Error('输入价值版本不一致');return {data,manifest:m};
 })().catch(e=>{pending=null;throw e;});
 const result=await pending;verifyInputs(result.data,parent);return result;
}
export function inputEntry(teaching=false){
 return `<section class="case-story"><h2>${teaching?'输入贡献与输入价值的区别':'输入采集与维护依据'}</h2><p>${teaching?'逐条贡献说明一个已训练模型如何打分；输入组消融则在相同训练预算下重新拟合，检查该组在其他输入已存在时增加了什么。两者都不是因果证明。':'词频、特殊字符和大写统计是否都需要保留，要结合复核名额、排序质量和概率误差判断。现有十组受控实验可查看输入删减的得失。'}</p><a class="text-link" href="#classify?case=spambase&view=inputs">查看输入价值实验 · 已知开发验证</a></section>`;
}
export function inputStudyHtml(study,state){
 const p=study.data,m=state.inputModel,contrast=state.inputContrast,s=state.inputShare;
 const a=`all:${m}`,b=contrast==='algorithm'?`all:${m==='lightgbm'?'logistic':'lightgbm'}`:`${contrast}:${m}`;
 const pair=inputPair(p.rows,a,b,s),resultA=p.result.models[a],resultB=p.result.models[b];
 let evidence=p.result.pairs.find(x=>x.a===a&&x.b===b),reverse=false;
 if(!evidence){evidence=p.result.pairs.find(x=>x.a===b&&x.b===a);reverse=true;}
 const range=key=>reverse?evidence.intervals[key].slice().reverse().map(v=>-v):evidence.intervals[key];
 const ap=resultA.calibrated.ap-resultB.calibrated.ap,brier=resultB.calibrated.brier-resultA.calibrated.brier;
 const interval=range('ap_gain'),uncertain=interval[0]<=0&&interval[1]>=0;
 const changes=pair.changes,positive=p.rows.reduce((n,r)=>n+r.label,0),quota=pair.a.selected;
 const transitionNames={corrected_fn:'新找回垃圾邮件',new_fn:'丢失原来找回的垃圾邮件',corrected_fp:'减少正常邮件误标',new_fp:'新增正常邮件误标'};
 const byId=new Map(p.rows.map(r=>[r.id,r]));
 return `<section class="case-story"><h2>输入价值与采用条件</h2><p><strong>词频的排序增量较明确，特殊字符与大写统计尚未体现一致的排序增量。</strong>三类输入是否都保留，需要同时核对实际复核队列和概率误差；本轮没有测量采集费用，不能直接给出投入回报。</p><p class="validation-boundary">本轮仅用 429 条已知开发验证记录（垃圾邮件 ${positive} 条、正常邮件 ${p.rows.length-positive} 条）。十组模型重新拟合，不读取原留出；不能与旧留出成绩混合比较，也不是新邮箱或未来时段验证。</p></section>
 <section class="m5-section"><h2>同一复核名额下的输入与模型增量</h2><div class="lesson-controls">${select('input-model','当前模型',MODELS,m)}${select('input-contrast','对照方式',{no_words:'保留 / 移除词频',no_characters:'保留 / 移除特殊字符频率',no_capitals:'保留 / 移除大写统计',words_only:'全部输入 / 仅词频',algorithm:'全部输入：当前模型 / 另一模型'},contrast)}${select('input-share','复核名额占比',{'0.1':'10%','0.2':'20%（预设主比较）','0.3':'30%'},s)}</div>
 <p><strong>当前：${name(a)}；对照：${name(b)}。</strong>每侧同样复核 ${quota} 条，当前净${pair.a.tp-pair.b.tp>=0?'多':'少'}找回 ${Math.abs(pair.a.tp-pair.b.tp)} 条垃圾邮件，正常邮件误标相应${pair.a.fp-pair.b.fp<=0?'减少':'增加'} ${Math.abs(pair.a.fp-pair.b.fp)} 条。</p>
 ${table(['同名额结果','当前','对照'],[['进入复核',quota,pair.b.selected],['找回垃圾邮件',pair.a.tp,pair.b.tp],['漏掉垃圾邮件',pair.a.fn,pair.b.fn],['误标正常邮件',pair.a.fp,pair.b.fp],['垃圾邮件召回率',pct(pair.a.recall),pct(pair.b.recall)]],'同名额输入增量')}
 <p>当前新找回 ${changes.corrected_fn.length} 条，也丢失对照原来能找回的 ${changes.new_fn.length} 条。净增量不能代表每条都改善。当前名额最多覆盖 ${pct(Math.min(quota,positive)/positive)} 的垃圾邮件；排序再好也无法突破名额上限。</p>
 <details><summary>查看队列变化的全部 ${Object.values(changes).reduce((n,x)=>n+x.length,0)} 条记录</summary><p>下列分数来自本轮各自重新训练及校准的模型；不借用旧模型的逐样本贡献来解释删减模型。没有原始邮件正文。</p>${table(['配对变化','记录','真实标签','当前分数','对照分数'],Object.entries(changes).flatMap(([kind,ids])=>ids.map(id=>{const r=byId.get(id);return [transitionNames[kind],esc(id),r.label?'垃圾邮件':'正常邮件',num(r.scores[a]),num(r.scores[b])];})),'输入变化逐条追溯')}</details></section>
 <section class="m5-section"><h2>排序增量与概率可靠性</h2>${table(['指标','当前','对照','差值及描述性 95% 范围'],[['AP（整体排序，越高越好）',num(resultA.calibrated.ap),num(resultB.calibrated.ap),`${signed(ap)}；${range('ap_gain').map(signed).join(' ～ ')}`],['Brier（概率均方误差，越低越好）',num(resultA.calibrated.brier),num(resultB.calibrated.brier),`降低 ${signed(brier)}；${range('brier_reduction').map(signed).join(' ～ ')}`]],'输入增量与重采样范围')}
 <p>${uncertain?'本项 AP 增量范围跨过零，当前样本不足以支持稳定的排序优胜。':interval[0]>0?'本项 AP 增量范围高于零，支持本历史开发范围内的排序改善。':'本项 AP 增量范围低于零，当前方案在本历史开发范围内的排序更弱。'}这与前 ${quota} 条的识别数量是不同问题，不能互相替代。</p><p class="small-note">固定模型后按原完整输入组配对重采样 1,000 次；保留组内所有记录。范围未做多重比较调整、不包含重新训练的不确定性，也没有消除已知开发数据反馈或相近邮件关联。</p>
 <details><summary>概率校准、冻结阈值与不同工作量</summary>${table(['方案','校准前 Brier','校准后 Brier','冻结阈值','待复核','漏掉','误标','正常邮件误报率'],[[a,resultA],[b,resultB]].map(([key,r])=>[name(key),num(r.raw.brier),num(r.calibrated.brier),num(r.threshold),r.policy.selected,r.policy.fn,r.policy.fp,pct(r.policy.fpr)]),'输入实验概率与冻结阈值')}<p>阈值在 728 条校准分区上按误报率 ≤2% 选定，且该分区同时拟合 sigmoid；不是独立阈值验证。上表是其后开发验证结果，不保证仍满足 2%。两侧阈值策略的工作量不同，不能当作同名额优胜；校准后变差也保留。</p></details></section>
 <section class="m5-section"><h2>输入采集建议与尚缺条件</h2>${table(['输入或需求','当前证据','可讨论的方案与限制'],[['44 项词频','两模型移除词频后的 AP 均下降；小复核队列的净增量仍有限','优先验证业务词表、分词和词频质量；词表来自旧英文邮件，不能直接用于中文或现代邮箱。'],['6 项字符频率、3 项大写统计','AP 边际增量范围跨零；全输入在小队列中也会退步，概率误差可能改善','若可复用现成统计，可保留做新数据对照；尚无成本测量，不能承诺增加或删除这些字段能省钱。'],['只保留统计、没有正文的场景','本例可做结构化特征分类，不包含文本理解','可讨论规则与表格模型；当前实验不证明缺词表输入与全输入等效。'],['语义、发件人、时间漂移','原始文本、身份与时间均不可用','需另备合法可用的新数据与标签，安排时间／来源留出；语义模型、概率迁移与线上误报控制尚未验证。']],'输入采用建议')}
 <p>这里的“移除”是在其他输入、模型参数和训练预算固定时重新训练；相关特征会互相替代。增量不等于因果作用，也不说明某类字段永远无用。删减输入后出现的相同向量不重新分区，避免比较人群随实验变化。</p></section>
 <details class="depth-calculation"><summary>全部十组实验、输入重合与复现记录</summary>${table(['输入','字段数','模型','AP','校准 Brier','同名额找回 / 漏掉 / 误标'],Object.entries(p.result.models).map(([key,r])=>{const [v,m]=key.split(':');return [VARIANTS[v],p.audit.variants[v].features.length,MODELS[m],num(r.calibrated.ap),num(r.calibrated.brier),`${r.capacity[s].tp} / ${r.capacity[s].fn} / ${r.capacity[s].fp}`];}),'全部受控输入实验')}${table(['输入方案','与训练输入相同的验证记录数'],Object.entries(p.audit.variants).map(([v,a])=>[VARIANTS[v],a.validation_rows_matching_reduced_train_input]),'删减输入重合审计')}<p>原完整输入相同记录不跨分区。删减后原本不同的邮件可能无法区分；该重合不是重新切分或读取留出标签，仍限制其泛化解释。</p><p>原训练 2,797、校准 728、开发验证 429 条，原四项采集来源字段持续排除。原参数：逻辑回归 C=1／最多 3,000 次；LightGBM 300 棵树／15 叶／学习率 0.04。每组一次固定种子拟合，没有调优或依据结果替换默认方案。</p><p>训练、校准拟合用时合计 ${Object.values(p.training_seconds).reduce((a,b)=>a+b,0).toFixed(2)} 秒（本地 CPU；不是线上响应延迟）。运行 ${esc(p.run_id)}。${esc(p.notice)}</p><a href="./classification-input-results/${esc(study.manifest.path)}" download>下载全部输入对照、逐条分数与实验协议</a></details>`;
}
