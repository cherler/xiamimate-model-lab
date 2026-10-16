import test from 'node:test';
import assert from 'node:assert/strict';
import {onPlatform} from '../apps/web/platform-chrome.js';

test('shared chrome mounts only under the exact module path',()=>{
  assert.equal(onPlatform(new URL('https://xiamimate.com/model-lab/#recommend')),true);
  assert.equal(onPlatform(new URL('http://127.0.0.1:5336/model-lab/')),true);
  for(const url of ['file:///tmp/model-lab/index.html','http://localhost:5328/','https://xiamimate.com/model-lab-fake/'])assert.equal(onPlatform(new URL(url)),false);
});
