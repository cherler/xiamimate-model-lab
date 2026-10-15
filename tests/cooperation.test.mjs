import test from 'node:test';
import assert from 'node:assert/strict';
import {briefRequest,briefText} from '../apps/web/cooperation.js';
import {runAssistant,validateRequest} from '../services/assistant/runtime.mjs';

test('brief mode has no case tools or context and repairs incomplete drafts',async()=>{
 const request=briefRequest('我开网店，补货靠经验，想减少断货。');
 assert.throws(()=>validateRequest({...request,context:'forecast:uci'}));
 let calls=0;
 const result=await runAssistant(request,{execute:async()=>{throw new Error('must not read cases');},complete:async(messages,defs)=>{
  assert.deepEqual(defs,[]);assert.match(messages[0].content,/未知项严格写/);
  calls++;
  return {message:{content:JSON.stringify({summary:'有历史销量记录吗？',citations:[],brief:calls===1?'业务问题：希望减少断货':briefText({goal:'希望减少断货'}).replace('现有数据条件','已有数据').replace('业务约束','约束').replace('期望合作范围','合作范围')})}};
 }});
 assert.equal(calls,2);assert.equal(result.trace.length,0);assert.equal(result.sources.length,0);
 assert.equal((result.brief.match(/待沟通/g)||[]).length,5);
});

test('brief request sends only the chosen description with no case context or retained fields',()=>{
 const r=briefRequest('  我开网店，补货靠经验，想减少断货。  ');
 assert.deepEqual(Object.keys(r).sort(),['mode','question']);
 assert.equal(r.mode,'brief');
 assert.equal(r.question,'我开网店，补货靠经验，想减少断货。');
 assert.throws(()=>briefRequest('  '));assert.throws(()=>briefRequest('字'.repeat(1801)));
 assert.ok(briefRequest('字'.repeat(1800)).question.length<3000);
});

test('local brief retains the stated problem and leaves unknown requirements unclaimed',()=>{
 const result=briefText({goal:'希望减少断货'});
 assert.match(result,/业务问题：希望减少断货/);
 assert.equal((result.match(/待沟通/g)||[]).length,5);
 assert.doesNotMatch(result,/LightGBM|10%|保证/);
});
