import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../dist/model.js';
import {createWorkspace,validateWorkspace,addProject,renameProject,softDeleteProject,restoreProject,buildFileTree} from '../dist/workspace.js';
test('projects own independent documents and support renaming',()=>{const ws=createWorkspace(createDemo()),original=ws.projects[0],added=addProject(ws,'项目二');assert.equal(added.document.nodes.length,0);renameProject(ws,added.id,'项目二改名');assert.equal(added.document.title,'项目二改名');assert.equal(original.document.nodes.length,5);assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(ws))),ws);});
test('project deletion is recoverable and deleting the final live project creates an empty workspace entry',()=>{const ws=createWorkspace(createDemo()),old=ws.activeId;softDeleteProject(ws,old);assert.equal(ws.projects.length,1);assert.equal(ws.projects[0].document.nodes.length,0);assert.notEqual(ws.activeId,old);const restored=restoreProject(ws,old);assert.equal(restored.document.nodes.length,5);assert.equal(ws.trash.length,0);assert.doesNotThrow(()=>validateWorkspace(ws));});
test('directory trees normalize path separators and group functions under files',()=>{const nodes=[{id:'a',file:'src\\auth\\login.c'},{id:'b',file:'src/auth/login.c'},{id:'c',file:'src/data/db.rs'},{id:'d',file:''}];const tree=buildFileTree(nodes),src=tree.find(t=>t.name==='src');assert.equal(src.children.find(t=>t.name==='auth').children[0].nodes.length,2);assert.equal(tree.find(t=>t.name==='未指定文件').nodes[0].id,'d');});
test('invalid project identities and names are rejected',()=>{const ws=createWorkspace(createDemo());assert.throws(()=>addProject(ws,''));assert.throws(()=>renameProject(ws,ws.activeId,' '.repeat(4)));ws.projects.push({...ws.projects[0]});assert.throws(()=>validateWorkspace(ws));});

test('existing and deleted projects retain their last visible layout when migrating independent coordinates',()=>{
  const ws=createWorkspace(createDemo()),first=ws.projects[0],second=addProject(ws,'第二个',createDemo());
  for(const project of ws.projects){for(const block of [...project.document.nodes,...project.document.groups])block.positions.logic={x:-120,y:80};}
  first.view={mode:'code',cameras:{logic:{x:1,y:2,z:.8},code:{x:20,y:30,z:1}}};
  second.view={...first.view,mode:'logic'};softDeleteProject(ws,second.id);
  const migrated=validateWorkspace(ws);
  assert.deepEqual(migrated.projects[0].document.nodes[0].positions.logic,first.document.nodes[0].positions.code);
  assert.deepEqual(migrated.trash[0].document.nodes[0].positions.code,{x:-120,y:80});
  assert.deepEqual(migrated.projects[0].view,first.view);assert.deepEqual(validateWorkspace(migrated),migrated);
  assert.deepEqual(first.document.nodes[0].positions.logic,{x:-120,y:80});
});
