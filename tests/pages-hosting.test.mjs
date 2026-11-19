import test from 'node:test';
import assert from 'node:assert/strict';
import {onlineServiceHtml} from '../apps/web/online-service.js';

test('online handoff keeps case choices without sending questions, drafts or customer IDs',()=>{
 const html=onlineServiceHtml('#agent?case=retail&origin=2011-09-01&budget=1&question=private-question&draft=private-draft&customer=12345');
 assert.match(html,/https:\/\/xiamimate\.com\/model-lab\/#agent\?case=retail/);
 assert.match(html,/origin=2011-09-01/);
 assert.doesNotMatch(html,/private-question|private-draft|12345/);
 assert.match(html,/rel="noopener noreferrer"/);
});
test('online links cannot switch destination or inject markup',()=>{
 const html=onlineServiceHtml('#javascript:alert(1)?case=%22%3E%3Cscript%3E','<script>label</script>');
 assert.match(html,/https:\/\/xiamimate\.com\/model-lab\/#agent/);
 assert.doesNotMatch(html,/<script>|javascript:/);
 assert.match(html,/&lt;script&gt;label/);
});
