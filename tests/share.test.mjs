import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../dist/model.js';
import {sharedWorkspace,shareTokenFromUrl} from '../dist/share.js';
test('share URLs support root and /code/ and do not mistake ordinary project links for shares',()=>{
  assert.equal(shareTokenFromUrl('https://example.com/code/'),null);
  assert.equal(shareTokenFromUrl('https://example.com/?share=abc'),'abc');
  assert.equal(shareTokenFromUrl('https://example.com/code/?share=abc'),'abc');
  assert.equal(shareTokenFromUrl('https://example.com/code/?share='),'');
});
test('a shared snapshot creates exactly one isolated project and normalizes the published view',()=>{
  const document=createDemo();document.nodes[0].positions.logic={x:123,y:456};
  const view={mode:'code',cameras:{logic:{x:10,y:20,z:.8},code:{x:50,y:100,z:1}}};
  const input={project:{document,view,id:'private-id',user:'owner-secret'},updatedAt:123456};
  const ws=sharedWorkspace(input);assert.equal(ws.projects.length,1);assert.equal(ws.trash.length,0);assert.equal(ws.projects[0].id,'shared-project');
  assert.deepEqual(ws.projects[0].document.nodes[0].positions.logic,document.nodes[0].positions.code);
  assert.deepEqual(document.nodes[0].positions.logic,{x:123,y:456});
  assert.deepEqual(ws.projects[0].view,view);assert.ok(!JSON.stringify(ws).includes('owner-secret'));assert.ok(!JSON.stringify(ws).includes('private-id'));
  assert.throws(()=>sharedWorkspace({project:{document:{}},updatedAt:1}));assert.throws(()=>sharedWorkspace({project:{document},updatedAt:'bad'}));
});

test('a read-only snapshot preserves independent code and logic layouts and camera views',()=>{
  const document=createDemo();document.layoutSync=false;
  for(const block of [...document.nodes,...document.groups])block.positions.logic={x:-700,y:420};
  const view={mode:'logic',cameras:{logic:{x:-500,y:10,z:.5},code:{x:120,y:30,z:1.3}}};
  const ws=sharedWorkspace({project:{document,view},updatedAt:123456});
  assert.deepEqual(ws.projects[0].document,document);assert.deepEqual(ws.projects[0].view,view);
});
