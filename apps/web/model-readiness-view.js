import {MODEL_READINESS} from './model-readiness.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const facts=rows=>`<dl>${rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
export function readinessHtml(business){
 const {sequence:s,retrieval:r}=MODEL_READINESS;
 if(business==='recommend')return `<section class="readiness-review" aria-label="推荐序列条件审查"><h3>审查结论：先验证购物篮顺序，不直接套用单商品序列</h3><p>同一购物篮里的商品没有可靠先后。将它们任意排成一串，会让模型学习不存在的顺序。</p>${facts([
 ['UCI 九月前历史',`${n(s.uci.customers)} 位顾客，购物次数中位数 ${n(s.uci.sequence_length_quantiles['0.5'])}；${n(s.uci.multi_item_basket_share*100)}% 的篮子包含多件商品。`],
 ['较长历史的覆盖',`按购物日保守合并，UCI 至少 10 天购买的顾客只有 ${n(s.uci.users_with_at_least_purchase_days['10'])} 位；Ta Feng 二月前为 ${n(s.tafeng.users_with_at_least_purchase_days['10'])}／${n(s.tafeng.customers)} 位。阈值只用于描述，不是通用训练资格线。`],
 ['下一项可验证能力','先比较有无购物篮顺序的推荐差异，保留短历史回退；复购、发现及不同历史长度分别报告。']
 ])}<p class="small-note">仅核查已有历史；未训练 SASRec，未读取 Ta Feng 二月封存购买标签。原模型成绩保持不变。</p></section>`;
 if(business==='retrieve')return `<section class="readiness-review" aria-label="ColBERT 可行性审查"><h3>前期可行性记录：文本截断与运行成本</h3><p>本机 ${r.threads} CPU 线程，预先按 ID 哈希选择 ${r.sampleDocuments} 篇文献、${r.sampleQueries} 条查询试跑，未按相关性挑选样本，也未评估排名效果。</p>${facts([
 ['文本覆盖',`默认 ${r.docMaxlen} tokens 会截断 ${n(r.truncated)}／${n(r.documents)} 篇摘要；${r.queryMaxlen}-token 查询有 ${r.truncatedQueries}／${r.queries} 条超限。多向量不能补回被截掉的内容。`],
 ['实测运行成本',`${r.sampleDocuments} 篇编码 ${n(r.encodingSeconds)} 秒；查询编码中位 ${n(r.queryMedianMs)} ms，已缓存 50 篇文献的评分中位 ${n(r.score50MedianMs)} ms。后两项不含召回、文献编码、加载及下载，不是端到端延迟。`],
 ['存储估算',`按全库实际保留 token 数，float32 向量负载约 ${n(r.vectorFloat32Bytes/1048576)} MiB；现有单向量文件 ${n(r.denseBytes/1048576)} MiB。前者不含索引辅助结构，未使用官方压缩索引。`],
 ['下一项可验证能力','已完成官方核心例程核对与 300 查询同池分块重排；本页“长摘要重排”实验可查看当前结果。全库多向量召回及官方压缩引擎仍待验证。']
 ])}<p class="small-note">本段保留前期原型记录，当时未做领域微调、质量评分或官方 PLAID 验收；新的质量评分见本页受控实验，未做微调或 PLAID 验收。词片匹配不是事实证据。项目与权重卡声明 MIT，数据仍遵循原案例许可与署名。</p></section>`;
 return '';
}
