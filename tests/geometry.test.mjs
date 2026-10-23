import test from 'node:test';
import assert from 'node:assert/strict';
import {routeBetween,returnAlong,pathFor} from '../dist/geometry.js';

test('an inner entry on the left is approached from the left even when the caller is to its right',()=>{const target={x:200,y:180};const route=routeBetween({x:650,y:100},target,{dir:-1,endDir:1,lane:400});assert.deepEqual(route.at(-1).to,target);assert.ok(route.at(-1).c2.x<target.x);assert.equal(route.length,3);});
test('linked logical return reverses the same route with a small parallel gap',()=>{
  for(const lane of [null,-100,600]){
    const call=routeBetween({x:200,y:150},{x:700,y:250},{dir:1,lane});
    const ret=returnAlong(call,{offset:14});
    assert.equal(ret.length,call.length);
    for(let i=0;i<call.length;i++){const c=call[call.length-1-i],r=ret[i];assert.deepEqual(r.from,{x:c.to.x,y:c.to.y+14});assert.deepEqual(r.to,{x:c.from.x,y:c.from.y+14});assert.deepEqual(r.c1,{x:c.c2.x,y:c.c2.y+14});}
  }
});
test('code return shares the trunk while attaching to actual return and caller rows',()=>{
  const call=routeBetween({x:200,y:150},{x:700,y:70},{dir:1,lane:-80});
  const start={x:700,y:280},end={x:200,y:155};
  const ret=returnAlong(call,{offset:14,start,end,dir:1});
  assert.deepEqual(ret[0].from,start);assert.deepEqual(ret.at(-1).to,end);
  assert.equal(ret.length,call.length);
  assert.deepEqual(ret[1].c1,{x:call[1].c2.x,y:call[1].c2.y+14});
  assert.ok(!/NaN|undefined|Infinity/.test(pathFor(ret)));
  for(let i=1;i<ret.length;i++)assert.deepEqual(ret[i-1].to,ret[i].from);
});
