// Explanatory diagrams only: these controls never run tools or change the task form.
import {esc} from './assistant.js';

export const AGENT_PATHS={
 agent:{name:'AI Agent',intro:'模型根据问题选择查询；补货报告算完后直接交付，一般咨询可继续查询或澄清。',steps:[
  {title:'明确任务与条件',brief:'问题、窗口与资源',detail:'提交任务和所选日期、预测模型、预算、库容及缺货惩罚。服务端先读取公开案例说明，作为本次分析的依据。',boundary:'仅使用明确选择或明确要求的支持条件，不静默猜日期或倍率。'},
  {title:'AI 选择查询',brief:'按问题决定查什么',detail:'语言模型可以查支持的条件、案例证据和扩展规划，或提出补货报告计划；报告计划注明条件及是否包含事后模拟。',boundary:'模型没有任意文件、网址或下单权限。问题不清楚时可能返回澄清，未必生成补货报告。'},
  {title:'工具核对与复算',brief:'数据与计算有依据',detail:'服务端校验工具和参数，读取已保存订单，复算点预测、安全库存、成本优化三策略的成本、缺货与约束；资源变化按商品计算增减。',boundary:'不重新训练或在线求解新订单。事后销量仅用于评价原订单，不参与当时的选择。'},
  {title:'查看取舍与证据',brief:'结论、明细与来源',detail:'补货计算完成后，服务端直接编排数值报告，页面显示成本和缺货取舍、三策略对照以及可展开的来源与执行记录，不再等待模型收尾。',boundary:'工具或参数失败时保留记录；来源与格式通过检查，也不代表自然语言解释全部正确。'},
 ]},
 workflow:{name:'固定流程',intro:'程序按预设顺序完成同一组复算，不解析任务描述，也不调用语言模型。',steps:[
  {title:'选择历史条件',brief:'使用表单中的参数',detail:'只读取所选日期、预测模型、预算、库容和缺货惩罚；无需填写自然语言任务。',boundary:'任务框中的预算变更或额外问题不会在固定流程中执行。'},
  {title:'读取并复算场景',brief:'保存订单与历史需求',detail:'读取该组条件的三策略保存订单，使用起点前八个需求场景，复算预期成本、缺货、预算和容量。',boundary:'条件必须在已保存范围内；没有模型自主选择或在线重新优化。'},
  {title:'复算事后结果',brief:'订单不变，评价变化',detail:'保持同一组订单，将需求替换为记录销量，计算事后模拟成本与缺货，用来观察预期和事后的差别。',boundary:'未来销量不回流到原订单；记录销量也不等于完整潜在需求。'},
  {title:'返回三策略对照',brief:'固定模板组织证据',detail:'与 AI 查询共用报告展示：先看成本与缺货取舍，再展开商品订单、约束、来源及实际工具记录。',boundary:'工具一致性不等于 Agent 任务成功率，历史模拟不等于真实经营收益。'},
 ]},
};

export function agentFlowHtml(mode='agent',step=0){
 const key=Object.hasOwn(AGENT_PATHS,mode)?mode:'agent',path=AGENT_PATHS[key],index=Number.isInteger(step)&&step>=0&&step<path.steps.length?step:0,selected=path.steps[index];
 return `<p class="agent-flow-intro">${esc(path.intro)}</p>
  <ol class="agent-flow" aria-label="${esc(path.name)}执行路径">${path.steps.map((s,i)=>`<li><button type="button" data-agent-step="${i}" aria-pressed="${i===index}" aria-controls="agent-flow-detail"><span class="agent-step-number" aria-hidden="true">${i+1}</span><span><strong>${esc(s.title)}</strong><small>${esc(s.brief)}</small></span></button></li>`).join('')}</ol>
  <div class="agent-step-detail" id="agent-flow-detail" aria-live="polite"><h3>${index+1} · ${esc(selected.title)}</h3><p>${esc(selected.detail)}</p><p class="agent-step-boundary"><strong>使用边界：</strong>${esc(selected.boundary)}</p></div>`;
}

export function agentProcessHtml(){return `<details class="agent-system" id="agent-system">
 <summary><span class="agent-system-label">工作流与架构</span><span class="agent-mini-flow">提出任务 <span aria-hidden="true">→</span> 选择工具 <span aria-hidden="true">→</span> 工具复算 <span aria-hidden="true">→</span> 核对报告</span><span class="agent-system-toggle"><span class="agent-system-closed">展开</span><span class="agent-system-open">收起</span></span></summary>
 <div class="agent-system-body">
  <div class="agent-flow-heading"><h2>两种执行方式</h2><div class="agent-path-switch" role="group" aria-label="查看执行方式"><button type="button" data-agent-path="agent" aria-pressed="true" aria-controls="agent-flow-view">AI Agent</button><button type="button" data-agent-path="workflow" aria-pressed="false" aria-controls="agent-flow-view">固定流程</button></div></div>
  <p class="agent-diagram-note">这是流程说明，不是本次运行进度。点击步骤查看职责和限制；切换图示不会运行任务或改变下方条件。</p>
  <div id="agent-flow-view">${agentFlowHtml()}</div>
  <h2 class="agent-architecture-heading">系统如何分工</h2>
  <figure class="agent-architecture" data-path="agent" aria-label="页面、分析服务、大模型与保存数据的关系">
   <div class="agent-architecture-grid">
    <div class="agent-arch-node agent-arch-client"><span>浏览器</span><h3>任务与条件</h3><p>提交问题和明确参数；最后展示报告与执行记录。</p></div>
    <div class="agent-arch-edge agent-arch-request" aria-hidden="true">→</div>
    <div class="agent-arch-node agent-arch-server"><span>分析服务</span><h3>任务编排与校验</h3><p>限定工具、检查条件、控制调用次数；密钥保留在服务端。</p></div>
    <div class="agent-arch-edge agent-arch-model-link" aria-hidden="true">⇄</div>
    <div class="agent-arch-node agent-arch-model"><span data-agent-model-label>仅 AI 模式调用</span><h3>语言模型服务</h3><p>理解任务并选择查询；接收任务、条件与公开案例工具结果。</p></div>
    <div class="agent-arch-return">↑ 报告返回页面</div>
    <div class="agent-arch-execute">↓ 校验后执行 <span>· 必要时返回证据继续查询</span></div>
    <div class="agent-arch-node agent-arch-report"><span>确定性报告</span><h3>成本与缺货取舍</h3><p>数值、排名和增减来自工具；同时保留来源及失败记录。</p></div>
    <div class="agent-arch-edge agent-arch-output" aria-hidden="true">←</div>
    <div class="agent-arch-node agent-arch-tools"><span>只读工具</span><h3>读取与复算</h3><p>按保存订单计算成本、缺货和约束；事前与事后分开评价。</p></div>
    <div class="agent-arch-edge agent-arch-data-link" aria-hidden="true">←</div>
    <div class="agent-arch-node agent-arch-data"><span>服务端保存数据</span><h3>UCI 预测与模拟订单</h3><p>已训练预测、已求解订单、历史场景和用于评价的记录销量。</p></div>
   </div>
   <figcaption>补货报告由工具计算后直接生成，不让语言模型重写金额或排名。一般咨询可能在工具返回后继续查询；固定流程跳过模型。当前不连接真实库存系统，不在线训练、重新求解或自动采购。</figcaption>
  </figure>
 </div>
</details>`;}

export function initAgentProcess(host){
 const root=host.querySelector('#agent-system');if(!root)return;
 let mode='agent';
 const draw=step=>{root.querySelector('#agent-flow-view').innerHTML=agentFlowHtml(mode,step);};
 root.addEventListener('click',event=>{
  const path=event.target.closest('[data-agent-path]'),step=event.target.closest('[data-agent-step]');
  if(path&&root.contains(path)){
   mode=path.dataset.agentPath;if(!Object.hasOwn(AGENT_PATHS,mode))return;
   root.querySelectorAll('[data-agent-path]').forEach(button=>button.setAttribute('aria-pressed',String(button===path)));
   root.querySelector('.agent-architecture').dataset.path=mode;
   root.querySelector('[data-agent-model-label]').textContent=mode==='agent'?'仅 AI 模式调用':'固定流程不调用';
   draw(0);
  }else if(step&&root.contains(step)){
   const index=Number(step.dataset.agentStep);draw(index);
   root.querySelector(`[data-agent-step="${index}"]`)?.focus({preventScroll:true});
  }
 });
}
