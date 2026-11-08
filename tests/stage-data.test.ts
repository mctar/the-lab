import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairedMovement} from '../src/stage-data.js';

test('projected before/after paths use only matched answers and conserve each category total',()=>{
  const transitions=[[2,3,1],[4,5,6],[0,2,8]];
  const result=pairedMovement(transitions);
  assert.deepEqual(result.before,[6,15,10]);
  assert.deepEqual(result.after,[6,10,15]);
  assert.equal(result.total,31);assert.equal(result.moved,16);assert.equal(result.stayed,15);
  assert.equal(result.before.reduce((a,b)=>a+b),result.after.reduce((a,b)=>a+b));
  assert.deepEqual(pairedMovement([[0,0,0],[0,0,0],[0,0,0]]),{before:[0,0,0],after:[0,0,0],total:0,moved:0,stayed:0});
});
