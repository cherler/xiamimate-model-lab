// In-memory conversations; each request owns a token and immutable input snapshot.
export function conversationHistory(turns){return turns.flatMap(t=>[{role:'user',content:t.question},{role:'assistant',content:t.result.summary}]);}
export function assertConversationSize(question,history){
 if(!question.trim()||question.length>3000)throw new Error('请填写不超过 3000 字的问题');
 if(history.length>40||history.reduce((n,m)=>n+m.content.length,question.length)>12000)throw new Error('本次对话已较长，请先复制需要保留的内容，再开始新对话；不会自动遗忘前面的条件。');
}
export function createAssistantSession(){
 const state={turns:[],draft:'',error:'',pending:null};let generation=0;
 return {state,begin(){
  const question=state.draft.trim(),history=conversationHistory(state.turns);assertConversationSize(question,history);
  this.cancel();const request={id:++generation,question,history,controller:new AbortController()};state.pending=request;state.error='';return request;
 },accept(request,result){
  if(state.pending!==request||request.controller.signal.aborted)return false;
  state.turns.push({question:request.question,result});state.draft='';state.pending=null;return true;
 },fail(request,error){if(state.pending!==request)return false;state.pending=null;state.error=error.message;return true;},cancel(){
  if(state.pending){state.pending.controller.abort();state.pending=null;state.error='已取消，问题和已有回答保留。';}generation++;
 },reset(){this.cancel();state.turns=[];state.draft='';state.error='';}};
}
