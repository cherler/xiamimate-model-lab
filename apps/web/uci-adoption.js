import {verifyUciManifest,uciData,UCI_MODELS} from './uci-static.js';
import {verifyAdoption,ADOPTION_GROUPS,adoptionGroup,adoptionPair,adoptionConclusion} from './uci-adoption-metrics.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>v==null?'无样本':`${(100*v).toFixed(2)}%`,score=v=>v==null?'无样本':v.toFixed(4),delta=v=>v==null?'无样本':`${v>0?'+':''}${v.toFixed(4)}`,pp=v=>v==null?'无样本':`${v>0?'+':''}${(100*v).toFixed(2)} 个百分点`;
const groups={all:'全部评估顾客',cold:'无可用目录历史','1–5':'历史 1–5 种商品','6–20':'历史 6–20 种商品','21+':'历史 21 种及以上'};
const table=(heads,rows,label)=>`<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(label)}"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
let cached;
export async function loadAdoption(){
 if(!cached)cached=(async()=>{
  const [a,b,report]=await Promise.all([fetch('./uci-adoption-results/manifest.json',{cache:'no-cache'}),fetch('./uci-results/manifest.json',{cache:'no-cache'}),uciData('experiments/latest')]);
  if(!a.ok||!b.ok)throw new Error('推荐采用证据尚未导出');
  const m=await a.json(),parent=verifyUciManifest(await b.json());
  if(m.schema!=='uci-adoption-v1'||!/^[a-f0-9]{16}\/case\.json$/.test(m.path)||!/^[a-f0-9]{64}$/.test(m.sha256))throw new Error('推荐采用清单无效');
  const response=await fetch('./uci-adoption-results/'+m.path);if(!response.ok)throw new Error('推荐采用文件缺失');
  const raw=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==m.sha256)throw new Error('推荐采用文件校验失败');
  const p=verifyAdoption(JSON.parse(new TextDecoder().decode(raw)),parent,report);
  if(p.protocol_sha256!==m.protocol_sha256||p.parent_run!==m.parent_run||p.parent_version!==m.parent_version)throw new Error('推荐采用协议不一致');return p;
 })().catch(e=>{cached=null;throw e;});return cached;
}
export function adoptionHtml(p,{model='hybrid',baseline='personal_decay',group='all',output=null,matched=true,report,controls=false}={}){
 const legacyNames={popular:'热门商品',itemcf:'ItemCF',basket:'最近一单搭配',als:'ALS',ease:'EASE'};
 const name=m=>esc(report.recommendation.models[m].label||legacyNames[m]||m),pair=adoptionPair(p.records,model,baseline,group);
 const windows=p.protocol.origins.map(origin=>({origin,...adoptionPair(p.records,model,baseline,group,origin)}));
 const conclusion=adoptionConclusion(pair,windows,{cold:group==='cold',same:model===baseline,matched});
 const policy=!matched?'<p class="validation-boundary">当前数量、排除已购或探索设置与原评估不同。以下仅展示 Top 10、允许复购、无探索的历史证据，不是当前列表的新增评估。</p>':'';
 const options=keys=>keys.map(m=>`<option value="${m}">${name(m)}</option>`).join('');
 const scope=output?`当前顾客 ${esc(output.customer_id==='new'?'新客示例':output.customer_id)}，推荐前可用目录历史 ${output.history_items} 种，属于“${groups[adoptionGroup(output.history_items)]}”。所选分析人群可与该顾客不同；人群平均不是该顾客的购买概率或未来胜负。`:'人群由推荐起点前的目录内购买历史划分，目标是窗口内下一购物篮。这里不按未来购买多少或事后胜负挑选顾客。';
 const groupRows=ADOPTION_GROUPS.map(g=>{const x=adoptionPair(p.records,model,baseline,g),w=p.protocol.origins.map(o=>adoptionPair(p.records,model,baseline,g,o));return [groups[g],`${x.n} / ${x.customers}`,delta(x.ndcg_delta),pp(x.recall_delta),`${x.wins} / ${x.ties} / ${x.losses}`,`${w.filter(v=>v.ndcg_delta>1e-12).length} / ${w.filter(v=>v.ndcg_delta< -1e-12).length}`];});
 return `<h2>推荐采用依据与规则回退</h2><p>${scope}</p>${policy}<div class="model-selectors">${controls?`<label>分析方法<select data-adoption-model>${options(UCI_MODELS)}</select></label><label>分析对照<select data-adoption-baseline>${options(UCI_MODELS)}</select></label>`:''}<label>分析人群<select data-adoption-group>${Object.entries(groups).map(([k,v])=>`<option value="${k}" ${group===k?'selected':''}>${v}</option>`).join('')}</select></label></div>
 <div class="depth-verdict"><strong>${conclusion}</strong><p>${groups[group]} · ${pair.n} 个顾客窗口 / ${pair.customers} 位不同顾客；当前 ${name(model)}，对照 ${name(baseline)}。${group==='1–5'?'本组只有 83 个顾客窗口，小组结果不能外推为普遍规则。':''}${pair.recall_delta< -1e-12?'当前方法找回的目标商品比例反而下降。'+(pair.ndcg_delta>1e-12?'排序指标改善也不等于全面改善。':''):''}</p></div>
 <div class="depth-duel"><section><h3>同批顾客的实际差异</h3><p>排序质量（NDCG@10）：${score(pair.base.ndcg)} → ${score(pair.current.ndcg)}，差 ${delta(pair.ndcg_delta)}。</p><p>目标商品找回率（Recall@10）：${pct(pair.base.recall)} → ${pct(pair.current.recall)}，差 ${pp(pair.recall_delta)}。</p><p>按每条 NDCG 配对：改善 ${pair.wins}、持平 ${pair.ties}、退步 ${pair.losses}。持平可能是两者都没有命中。</p></section><section><h3>采用与回退条件</h3><p>${group==='cold'?'没有可用目录历史时使用热门回退；它不等于给新客建立了个人偏好。':group==='all'?'先区分可用历史与冷启动，再比较同一人群的简单规则。不能用总体平均替每个人选择方法。':'有可用历史时先保留近期复购规则作为强基线；只有增益、覆盖与成本都符合业务需要，才进入独立验证。'}</p><p>当前方法实际回退 ${pair.current.fallback}/${pair.n} 条，对照 ${pair.base.fallback}/${pair.n} 条。热门方法本身不计“回退”；回退量不等于错误数。</p><p>本页不执行新的人群路由。按事后胜负为每个人挑方法，会高估实际可获得的收益。</p></section></div>
 <details><summary>四类人群的增益、退步与跨窗口稳定性</summary>${table(['推荐前人群','顾客窗口 / 不同顾客','NDCG 差值','Recall 差值','改善 / 持平 / 退步','改善 / 退步窗口'],groupRows,'全部人群采用证据')}<h3>当前人群的三个窗口</h3>${table(['起点','顾客窗口','对照 → 当前 NDCG','Recall 差值','改善 / 持平 / 退步'],windows.map(w=>[w.origin,w.n,`${score(w.base.ndcg)} → ${score(w.current.ndcg)}`,pp(w.recall_delta),`${w.wins} / ${w.ties} / ${w.losses}`]),'采用证据逐窗口配对')}<p class="small-note">此处按顾客窗口直接平均，原主报告按三个窗口等权平均，口径不同不能混算提升。同一顾客可跨月重复出现，不是 ${pair.n} 个独立客户；仅三个已知开发窗口，不宣称显著性或未来稳定优势。</p></details>
 <details><summary>复购、未见历史商品与候选上限</summary>${table(['目标类型','有效顾客窗口 / 目标条目','对照 Recall','当前 Recall'],[['历史目录内已购目标',`${pair.repeat_rows} / ${pair.repeat_targets}`,pct(pair.base.repeat_recall),pct(pair.current.repeat_recall)],['未见于可用历史的目标',`${pair.novel_rows} / ${pair.novel_targets}`,pct(pair.base.novel_recall),pct(pair.current.novel_recall)]],'复购和其余目标的覆盖')}<p>两类各自在目标非空的顾客窗口内平均，不把空分母当零，也不把两行召回率相加。“未见历史”含目录外商品，不证明一生首次购买。</p><p>当前人群共有 ${pair.targets} 个目标商品条目（每顾客窗口去重），其中 ${pair.oov} 个不在当时训练目录；目录内另外 ${pair.capacity_loss} 个受每次最多 10 个位置限制。理想 Recall 上限按每条 min(10，目录内目标数)÷全部目标数计算后平均，为 ${pct(pair.ideal_recall)}。上限读取事后目标，只用于说明目录与容量限制，不能部署成推荐器。</p></details>
 <details><summary>审计范围、成本与适用限制</summary><p>九方法均有相同 4,280 个顾客窗口、2,845 位不同顾客：九月 1,259、十月 1,361、十一月 1,660。只覆盖对应窗口内有下一购物篮的顾客，不代表所有访客、未回访者或真实曝光转化。24 位页面样本及新客示例不是这批全量评估的分母。</p><p>分组是推荐前训练目录内买过的商品种数，不是订单频次、注册时长或未来购物篮。九／十月使用已核验来源代码的冻结历史分组，未独立重建那两期完整个人历史；十一月另核对了全部保存模型历史。当前没有足够证据再按最近购买天数等字段细分。</p><p>融合模型需要 ALS 与复购统计；额外计算应结合增益大小判断。原训练成本共享预处理、部分来自不同运行，不能相减得出精确增量成本；详见原完整报告。没有新训练、自动路由、客户经营收益或新的独立测试。Ta Feng 的复购／发现任务另有冻结评估，本页的人群结论不迁移到其他数据集。</p></details>`;
}
export function mountAdoption(host,p,{report,model='hybrid',baseline='personal_decay',output=null,matched=true,controls=false,error=''}={}){
 if(!p){host.innerHTML=`<h2>推荐采用依据暂不可用</h2><p>${esc(error||'全量证据未加载')}。不借用演示样本推断人群增益。</p>`;return;}
 let group=output?adoptionGroup(output.history_items):'all';
 const render=()=>{
  host.innerHTML=adoptionHtml(p,{report,model,baseline,output,matched,group,controls});
  host.querySelector('[data-adoption-group]').onchange=e=>{group=e.target.value;render();};
  if(controls)for(const [selector,value,key] of [['[data-adoption-model]',model,'model'],['[data-adoption-baseline]',baseline,'baseline']]){const node=host.querySelector(selector);node.value=value;node.onchange=e=>{if(key==='model')model=e.target.value;else baseline=e.target.value;render();};}
 };render();
}
