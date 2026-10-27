import test from 'node:test';
import assert from 'node:assert/strict';
import {routeBetween,routeBlocks,returnAlong,pathFor} from '../dist/geometry.js';

test('an inner entry on the left is approached from the left even when the caller is to its right',()=>{const target={x:200,y:180};const route=routeBetween({x:650,y:100},target,{dir:-1,endDir:1,lane:400});assert.deepEqual(route.at(-1).to,target);assert.ok(route.at(-1).c2.x<target.x);assert.equal(route.length,3);});
test('facing ports across a wide gap connect directly even on very tall code blocks',()=>{
  for(const dir of [1,-1]){
    const source={x:dir===1?0:1200,y:0,w:350,h:5000},target={x:dir===1?1200:0,y:80,w:350,h:4500};
    const s={x:dir===1?350:1200,y:400},t={x:dir===1?1200:350,y:110};
    const route=routeBlocks(s,t,{source,target,dir});
    assert.equal(route.length,1);assert.deepEqual(route[0].from,s);assert.deepEqual(route[0].to,t);
    for(const p of Object.values(route[0]))assert.ok(p.y>=110&&p.y<=400);
  }
});
test('an internal entry on the far side takes the nearer outside path without crossing the block',()=>{
  const source={x:650,y:0,w:350,h:5000},target={x:200,y:80,w:350,h:4500};
  for(const [sy,ty,lane] of [[100,180,-40],[4900,4500,5040]]){
    const route=routeBlocks({x:650,y:sy},{x:200,y:ty},{source,target,dir:-1,endDir:1});
    assert.equal(route.length,3);assert.equal(route[1].from.y,lane);assert.equal(route[1].to.y,lane);
    assert.ok(route.at(-1).c2.x<200);
  }
});
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
