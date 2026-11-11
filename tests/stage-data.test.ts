import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupIdeaTitles,pairedMovement,wallPage} from '../src/stage-data.js';

test('projected before/after paths use only matched answers and conserve each category total',()=>{
  const transitions=[[2,3,1],[4,5,6],[0,2,8]];
  const result=pairedMovement(transitions);
  assert.deepEqual(result.before,[6,15,10]);
  assert.deepEqual(result.after,[6,10,15]);
  assert.equal(result.total,31);assert.equal(result.moved,16);assert.equal(result.stayed,15);
  assert.equal(result.before.reduce((a,b)=>a+b),result.after.reduce((a,b)=>a+b));
  assert.deepEqual(pairedMovement([[0,0,0],[0,0,0],[0,0,0]]),{before:[0,0,0],after:[0,0,0],total:0,moved:0,stayed:0});
});

test('a 150-pair wall walks all groups and keeps the current group when a new one arrives',()=>{
  const groups=Array.from({length:19},(_,index)=>wallPage(150,8,index));
  assert.deepEqual(groups.map(group=>group.current),Array.from({length:19},(_,index)=>index));
  assert.deepEqual(groups[18].preload,[18,0]);
  assert.equal(wallPage(160,8,3).current,3);
  assert.deepEqual(wallPage(1,8,3).preload,[0]);
  assert.equal(groupIdeaTitles([{title:'Bridge for strangers'},{title:' bridge   for strangers '},{title:'Community table'}])[0].count,2);
});
