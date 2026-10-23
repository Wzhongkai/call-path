import test from 'node:test';
import assert from 'node:assert/strict';
import {dismissOnBackdrop} from '../dist/dialog.js';

function setup(){
  const dialog=new EventTarget();dialog.getBoundingClientRect=()=>({left:100,top:100,right:900,bottom:700});
  let dismissed=0;dismissOnBackdrop(dialog,()=>dismissed++);
  const send=(type,x=50,y=50,button=0)=>{const event=new Event(type);Object.assign(event,{clientX:x,clientY:y,button});dialog.dispatchEvent(event);};
  return {send,get dismissed(){return dismissed;}};
}
test('dragging from the editor to the backdrop keeps the dialog open',()=>{
  const ui=setup();ui.send('pointerdown',300,300);ui.send('pointerup',50,50);ui.send('click',50,50);assert.equal(ui.dismissed,0);
  ui.send('pointerdown',50,50);ui.send('pointerup',300,300);ui.send('click',300,300);assert.equal(ui.dismissed,0);
});
test('a full backdrop click closes once and an isolated release cannot close again',()=>{
  const ui=setup();ui.send('pointerdown');ui.send('pointerup');ui.send('click');assert.equal(ui.dismissed,1);
  ui.send('click');assert.equal(ui.dismissed,1);
});
test('cancelled pointers, close/reopen and right clicks do not leave a stale dismissal gesture',()=>{
  for(const reset of ['pointercancel','close']){const ui=setup();ui.send('pointerdown');ui.send(reset);ui.send('click');assert.equal(ui.dismissed,0);}
  const ui=setup();ui.send('pointerdown',50,50,2);ui.send('click');assert.equal(ui.dismissed,0);
  ui.send('pointerdown',300,300);ui.send('click',300,300);assert.equal(ui.dismissed,0);
});
