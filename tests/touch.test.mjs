import test from 'node:test';
import assert from 'node:assert/strict';
import {pinchCamera,installPinchNavigation} from '../dist/touch.js';

test('pinch zoom keeps its world anchor under the moving midpoint and clamps zoom',()=>{
  const start={camera:{x:20,y:30,z:1},distance:100,world:{x:130,y:70}};
  assert.deepEqual(pinchCamera(start,{x:100,y:100},{x:300,y:100}),{x:-60,y:-40,z:2});
  assert.deepEqual(pinchCamera(start,{x:149,y:100},{x:151,y:100}),{x:124,y:86,z:.2});
  assert.deepEqual(start.camera,{x:20,y:30,z:1});
});

function fixture(){
  const listeners={},capture=new Set(),camera={x:0,y:0,z:1},counts={paint:0,save:0,before:0,suppressed:0};
  const viewport={addEventListener(name,fn){listeners[name]=fn;},getBoundingClientRect(){return {left:10,top:20};},setPointerCapture(id){capture.add(id);},hasPointerCapture(id){return capture.has(id);},releasePointerCapture(id){capture.delete(id);}};
  installPinchNavigation(viewport,{getCamera:()=>camera,paint:()=>counts.paint++,save:()=>counts.save++,beforePinch:()=>counts.before++,suppressClick:()=>counts.suppressed++});
  function send(type,id,x,y,{pointerType='touch',control=false}={}){
    const event={pointerId:id,pointerType,clientX:x+10,clientY:y+20,target:{closest:()=>control?{}:null},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.blocked=true;}};
    listeners[type](event);return event;
  }
  return {send,camera,counts,capture};
}

test('a single touch and toolbar touches remain available to normal selection and controls',()=>{
  const f=fixture();assert.equal(f.send('pointerdown',1,50,50).blocked,undefined);
  assert.equal(f.send('pointermove',1,80,50).blocked,undefined);
  assert.equal(f.send('pointerup',1,80,50).blocked,undefined);
  f.send('pointerdown',2,0,0,{control:true});f.send('pointerdown',3,100,0,{control:true});
  assert.deepEqual(f.counts,{paint:0,save:0,before:0,suppressed:0});
});

test('two-finger navigation ends the old drag once and absorbs the remaining finger until release',()=>{
  const f=fixture();f.send('pointerdown',1,100,100);
  assert.equal(f.send('pointerdown',2,200,100).blocked,true);
  f.send('pointermove',2,300,100);
  assert.deepEqual(f.camera,{x:-100,y:-100,z:2});
  assert.equal(f.counts.before,1);assert.equal(f.counts.paint,1);
  assert.equal(f.send('pointerup',2,300,100).blocked,true);
  assert.equal(f.send('pointermove',1,120,120).blocked,true);
  assert.equal(f.counts.paint,1);assert.equal(f.counts.save,0);
  f.send('pointerup',1,120,120);assert.equal(f.counts.save,1);assert.equal(f.capture.size,0);
  assert.equal(f.send('pointerdown',4,50,50).blocked,undefined);
});

test('pointer cancellation releases pinch captures and mouse input never starts a pinch',()=>{
  const f=fixture();f.send('pointerdown',1,0,0,{pointerType:'mouse'});f.send('pointerdown',2,100,0,{pointerType:'mouse'});
  assert.equal(f.counts.before,0);
  f.send('pointerdown',3,0,0);f.send('pointerdown',4,100,0);
  f.send('pointercancel',3,0,0);f.send('pointercancel',4,100,0);
  assert.equal(f.capture.size,0);assert.equal(f.counts.save,1);
  assert.equal(f.send('pointerdown',5,0,0).blocked,undefined);
});
