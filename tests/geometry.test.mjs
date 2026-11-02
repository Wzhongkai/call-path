import test from 'node:test';
import assert from 'node:assert/strict';
import {routeBetween,routeBlocks,returnAlong,pathFor} from '../dist/geometry.js';

function samples(route){return route.flatMap(s=>Array.from({length:101},(_,i)=>{const t=i/100,u=1-t;return {x:u*u*u*s.from.x+3*u*u*t*s.c1.x+3*u*t*t*s.c2.x+t*t*t*s.to.x,y:u*u*u*s.from.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2.y+t*t*t*s.to.y};}));}
function assertClear(route,rects){
  assert.ok(route.length>0);assert.ok(!/NaN|undefined|Infinity/.test(pathFor(route)));
  for(const p of samples(route))for(const r of rects)assert.ok(!(p.x>r.x+1e-5&&p.x<r.x+r.w-1e-5&&p.y>r.y+1e-5&&p.y<r.y+r.h-1e-5),`path enters block at ${p.x},${p.y}`);
  for(let i=1;i<route.length;i++)assert.deepEqual(route[i-1].to,route[i].from);
}

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
  for(const [sy,ty] of [[100,180],[4900,4500]]){
    const route=routeBlocks({x:650,y:sy},{x:200,y:ty},{source,target,dir:-1,endDir:1});
    assertClear(route,[source,target]);
    const ys=samples(route).map(p=>p.y);assert.ok(Math.min(...ys)>Math.min(sy,ty)-160);assert.ok(Math.max(...ys)<Math.max(sy,ty)+160);
    assert.ok(route.at(-1).c2.x<200);
  }
});

test('stacked long blocks use the gap for nearly aligned columns in both directions',()=>{
  for(const dx of [-1,0,1])for(const upwards of [false,true]){
    const upper={x:100,y:0,w:352,h:1400},lower={x:100+dx,y:1550,w:352,h:1800};
    const source=upwards?lower:upper,target=upwards?upper:lower,dir=target.x>=source.x?1:-1;
    const s={x:source.x+(dir>0?source.w:0),y:upwards?1800:1100},t={x:target.x+(dir<0?target.w:0),y:upwards?1100:1578};
    const route=routeBlocks(s,t,{source,target,dir});assertClear(route,[source,target]);
    assert.deepEqual(route[0].from,s);assert.deepEqual(route.at(-1).to,t);
    assert.ok(dir*(route[0].c1.x-s.x)>0);assert.ok(dir*(t.x-route.at(-1).c2.x)>0);
    const ys=samples(route).map(p=>p.y);assert.ok(Math.min(...ys)>=Math.min(s.y,t.y)-40);assert.ok(Math.max(...ys)<=Math.max(s.y,t.y)+40);
  }
});

test('code returns route from their actual rows with stable endpoints and distinct parallel spacing',()=>{
  const caller={x:100,y:0,w:352,h:1400},callee={x:100,y:1550,w:352,h:1800};
  const start={x:100,y:3200},end={x:452,y:1100},paths=[];
  for(const offset of [0,14,26]){
    const route=routeBlocks(start,end,{source:callee,target:caller,dir:-1,endDir:-1,offset});assertClear(route,[caller,callee]);
    assert.deepEqual(route[0].from,start);assert.deepEqual(route.at(-1).to,end);
    const ys=samples(route).map(p=>p.y);assert.ok(Math.min(...ys)>=end.y-40);assert.ok(Math.max(...ys)<=start.y+40);paths.push(pathFor(route));
  }
  assert.equal(new Set(paths).size,3);
});

test('small gaps stay usable and overlapping blocks have a finite fallback',()=>{
  for(const gap of [1,8,30]){
    const source={x:100,y:0,w:352,h:1000},target={x:100,y:1000+gap,w:352,h:800};
    const route=routeBlocks({x:452,y:900},{x:100,y:target.y+28},{source,target});assertClear(route,[source,target]);
    assert.ok(Math.min(...samples(route).map(p=>p.y))>=900-40);
  }
  const source={x:100,y:0,w:352,h:1000},target={x:120,y:20,w:352,h:1000};
  assert.ok(!/NaN|undefined|Infinity/.test(pathFor(routeBlocks({x:452,y:100},{x:120,y:200},{source,target}))));
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
