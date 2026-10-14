import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyColbert} from '../apps/web/colbert-metrics.js';
import {colbertReportHtml,colbertSampleHtml} from '../apps/web/colbert-study.js';
const read=dir=>{const m=JSON.parse(fs.readFileSync(new URL(`../apps/web/${dir}/manifest.json`,import.meta.url)));return {m,p:JSON.parse(fs.readFileSync(new URL(`../apps/web/${dir}/${m.path}`,import.meta.url)))};};
const {p,m}=read('colbert-results'),parent=read('retrieval-results').p;
test('frozen ColBERT results preserve parent pools, labels, scores, costs and 900 explanations',()=>{assert.equal(verifyColbert(p,parent),p);});
test('changing pool membership, tail or score ordering is rejected',()=>{
 for(const mutate of [x=>x.rows[0].rankings.colbert_chunks[0]='invented',x=>x.rows[0].rankings.colbert_chunks.reverse(),x=>{const r=x.rows[0];r.scores.colbert_chunks[r.rankings.colbert_chunks[0]]=-1000;}]){const x=structuredClone(p);mutate(x);assert.throws(()=>verifyColbert(x,parent));}
});
test('changing query text, labels, source excerpt or token contribution is rejected',()=>{
 for(const mutate of [x=>x.rows[0].text='not original',x=>x.rows[0].relevant={'fake':1},x=>{const a=Object.values(x.rows[0].matches)[0];a.chunk.text='X'+a.chunk.text.slice(1);},x=>Object.values(x.rows[0].matches)[0].tokens[0].v+=1]){const x=structuredClone(p);mutate(x);assert.throws(()=>verifyColbert(x,parent));}
});
test('misreported aggregates, groups, timing and outcome counts are rejected',()=>{
 for(const mutate of [x=>x.summary.colbert_chunks.ndcg_at_10+=.1,x=>x.groups.long_query.n++,x=>x.timing.colbert_chunks.median+=1,x=>x.comparisons[1].wins++]){const x=structuredClone(p);mutate(x);assert.throws(()=>verifyColbert(x,parent));}
});
test('display distinguishes local development from full retrieval and retains declines',()=>{
 const html=colbertReportHtml(p,m);assert.match(html,/不是新的独立测试/);assert.match(html,/31 条退步/);assert.match(html,/候选并集缓存/);assert.match(html,/不是端到端/);assert.match(html,/输入长度不同/);assert.match(html,/不涵盖训练随机性/);
 const worse=p.rows.find(r=>r.metrics.colbert_chunks.ndcg_at_10<r.metrics.cross_chunks.ndcg_at_10);
 const sample=colbertSampleHtml(p,worse.id,'worse');assert.match(sample,/ColBERT 退步/);assert.ok(sample.includes(`value="${worse.id}" selected`));assert.match(sample,/特殊标记与 MASK/);assert.match(sample,/未标注相关/);assert.doesNotMatch(sample,/NaN|undefined/);
});
