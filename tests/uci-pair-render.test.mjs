import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderRoundTwo} from '../apps/web/round-two.js';
const root='apps/web/uci-results/';
const exists=fs.existsSync(root+'manifest.json');
test('UCI paired replay suppresses stale requests and clears both lists on resource failure',{skip:!exists},async()=>{
 const m=JSON.parse(fs.readFileSync(root+'manifest.json')),report=JSON.parse(fs.readFileSync(root+m.version+'/report.json'));
 const previousFetch=global.fetch,previousLocation=global.location,previousHistory=global.history,previousWindow=global.window;
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',classList:{toggle(){}},setAttribute(){}});return nodes.get(id);};
 const main={innerHTML:'',querySelector:node,querySelectorAll:()=>[]};
 let release,blocked=false,fail=false;
 const paused=new Promise(resolve=>{release=resolve;});
 global.location={hash:'#recommend?case=uci'};
 global.history={replaceState:(_s,_t,url)=>{global.location.hash=url;}};global.window={dispatchEvent(){}};
 global.fetch=async url=>{
  assert.ok(String(url).startsWith('./uci-results/'),'no local API or foreign resource');
  if(String(url).endsWith('customer-12849.json')){blocked=true;await paused;}
  if(fail&&String(url).endsWith('customer-12867.json'))return new Response('',{status:404});
  return new Response(fs.readFileSync('apps/web/'+String(url).slice(2)));
 };
 const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),'render completed');};
 try{
  const initial=renderRoundTwo('recommend',main,report,()=>true);
  await until(()=>blocked);
  node('#customer').onchange({target:{value:'new'}});
  await until(()=>node('#uci-rec-delta').innerHTML.includes('共享顾客 new'));
  assert.match(node('#recommendations').innerHTML,/回退热门/);assert.match(node('#uci-baseline-results').innerHTML,/回退热门/);
  release();await initial;
  assert.match(node('#uci-rec-delta').innerHTML,/共享顾客 new/,'late previous customer cannot overwrite the pair');
  assert.equal(new URLSearchParams(global.location.hash.split('?')[1]).get('customer'),'new');
  fail=true;node('#customer').onchange({target:{value:'12867'}});
  await until(()=>node('#recommendations').innerHTML.includes('文件缺失'));
  for(const id of ['#uci-baseline-results','#uci-rec-delta','#uci-rec-population'])assert.equal(node(id).innerHTML,'',id);
 }finally{release();global.fetch=previousFetch;global.location=previousLocation;global.history=previousHistory;global.window=previousWindow;}
});
