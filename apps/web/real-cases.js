import {renderRoundThree} from './round-three.js';
import {cancelRoundTwo} from './round-two.js';
import {loadUciReport} from './uci-static.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let generation=0;
export function cancelCase(){generation++;cancelRoundTwo();}
export async function renderCase(page,main,expectedRunId,expectedReportHash){
 const token=++generation;
 main.innerHTML='<div class="empty-state"><h1>正在读取 UCI 保存结果…</h1><p>核验静态案例包与报告版本。</p></div>';
 try{const report=await loadUciReport(expectedRunId,expectedReportHash);if(token!==generation)return;await renderRoundThree(page,main,report,()=>token===generation);}
 catch(error){if(token!==generation)return;main.innerHTML=`<section class="report-panel"><h1>UCI 案例暂不可用</h1><p>请恢复完整且版本一致的静态案例包，再刷新本页。缺失数据时不会显示替代成绩。</p><p class="small-note">${esc(error.message)}</p><button class="outline" id="retry-model">重新读取</button></section>`;main.querySelector('#retry-model').onclick=()=>renderCase(page,main,expectedRunId,expectedReportHash);}
}
