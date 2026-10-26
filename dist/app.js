import {COLORS,uid,clone,createDemo,reconcileLines,repairAnchors,filterNodes,deleteNode,deleteEdge,validateDocument,scopePath,canParent,assignNodeTag,setBlockPosition} from './model.js';
import {routeBetween,returnAlong,pathFor} from './geometry.js';
import {LANGUAGES,highlightCode} from './highlight.js';
import {createWorkspace,validateWorkspace,addProject,renameProject,softDeleteProject,restoreProject,buildFileTree} from './workspace.js';
import {createCodeEditor,codePreviewLines,compactPreviewLines} from './vendor/editor.js';
import {emptyProject} from './workspace.js';
import {connectAccount,mountAccount} from './account.js';
import {dismissOnBackdrop} from './dialog.js';
import {shareTokenFromUrl,connectShared,mountSharedView,mountSharing} from './share.js';
import {installPinchNavigation} from './touch.js';

const shareToken=shareTokenFromUrl(location.href);
const account=shareToken===null?await connectAccount():await connectShared(shareToken);
const readOnly=Boolean(account.readonly);
let cloudSync=null;

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE='callpath.document.v1',VIEW='callpath.view.v1',WORKSPACE='callpath.workspace.v1';
let doc=account.remote?emptyProject('新项目'):createDemo(),mode='logic',tool='select',selected=null,pending=null;
let search='',tags=[],matchAll=false,trace=null,openNotes=new Set();
let tagEditing=false;
let multi=new Set(),snap=true;
let focusedLine=null;
let pointConnect=false,lastConnectionAt=-Infinity;
let codeEditor=null,editorLines=null,innerDraft=[];
let showComments=false;const previewCache=new WeakMap();
try{showComments=localStorage.getItem('callpath.show-comments')==='true';}catch{}
let treeDragUntil=0;
let cameras={logic:{x:0,y:0,z:1},code:{x:0,y:0,z:1}},history=[],future=[],storageFailed=false;
let toastTimer,saveTimer,renderFrame,drag=null,suppressClick=false,editingColor=null,hadSavedView=false;
const heldArrows=new Set();let keyMotion=null,keyFrame=0;
if(!account.remote)try{const raw=localStorage.getItem(STORAGE);const saved=JSON.parse(localStorage.getItem(VIEW)||'null');if(saved&&['logic','code'].includes(saved.mode)){hadSavedView=true;mode=saved.mode;for(const m of ['logic','code'])if(['x','y','z'].every(k=>Number.isFinite(saved.cameras?.[m]?.[k]))&&saved.cameras[m].z>=.2&&saved.cameras[m].z<=2)cameras[m]=saved.cameras[m];}if(raw)doc=validateDocument(JSON.parse(raw),mode);}catch{storageFailed=true;}
let workspace=createWorkspace(doc),workspaceWritable=true;const closedTree=new Set();
try{const raw=account.remote?(account.draft?.workspace||account.snapshot.workspace):JSON.parse(localStorage.getItem(WORKSPACE)||'null');if(raw){workspace=validateWorkspace(raw);const active=workspace.projects.find(p=>p.id===workspace.activeId);doc=active.document;if(active.view){mode=active.view.mode;cameras=clone(active.view.cameras);hadSavedView=true;}}}catch{storageFailed=true;workspaceWritable=false;}
const camera=()=>cameras[mode];
const nodeBy=id=>doc.nodes.find(n=>n.id===id);
const edgeBy=id=>doc.edges.find(e=>e.id===id);
const groupBy=id=>(doc.groups||[]).find(g=>g.id===id);
const blockKind=n=>n.kind||'function';
const blockSymbol=n=>({function:'ƒ',struct:'▦',macro:'#'}[blockKind(n)]);
const blockTitle=n=>({function:'函数',struct:'结构体',macro:'宏定义'}[blockKind(n)]);
const snapValue=v=>Math.max(-100000,Math.min(100000,snap?Math.round(v/20)*20:Math.round(v)));
const visible=()=>filterNodes(search?{...doc,nodes:doc.nodes.map(n=>({...n,description:n.description+' '+nestedEntries(n).map(entry=>entry.name).join(' ')}))}:doc,{search,tags,matchAll,trace});
const isFiltering=()=>Boolean(search.trim()||tags.length||trace);
const nodeElement=id=>[...$('nodes').children].find(el=>el.dataset.node===id);
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function stashProject(){const p=workspace.projects.find(p=>p.id===workspace.activeId);if(p){p.document=doc;p.view={mode,cameras:clone(cameras)};p.updatedAt=Date.now();}}
function saveNow(){clearTimeout(saveTimer);saveTimer=null;if(readOnly)return;try{stashProject();if(!workspaceWritable)throw Error('工作空间读取失败，请先导出当前项目');if(account.remote){cloudSync?.queue(workspace);return;}localStorage.setItem(WORKSPACE,JSON.stringify(workspace));localStorage.setItem(STORAGE,JSON.stringify(doc));localStorage.setItem(VIEW,JSON.stringify({mode,cameras}));storageFailed=false;$('save-status').innerHTML='<i></i> 已保存到本机';}catch{storageFailed=true;$('save-status').textContent='保存失败 · 请导出备份';}}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,200);}
function importWorkspaceProjects(incoming){
  if(workspace.projects.length+incoming.projects.length>100)throw Error('合并后项目超过 100 个，请减少后重试');
  stashProject();for(const p of incoming.projects)workspace.projects.push({...clone(p),id:uid('project')});
  saveNow();render();toast(`已添加 ${incoming.projects.length} 个项目，可在项目管理中打开`);
}
function activateProject(id,{stash=true,close=true}={}){
  finishKeyMotion();if(stash)stashProject();const p=workspace.projects.find(p=>p.id===id);if(!p)return;workspace.activeId=id;doc=p.document;mode=p.view?.mode||'logic';cameras=p.view?clone(p.view.cameras):{logic:{x:0,y:0,z:1},code:{x:0,y:0,z:1}};history=[];future=[];selected=null;pending=null;tool='select';search='';tags=[];trace=null;multi.clear();openNotes.clear();closedTree.clear();focusedLine=null;$('search').value='';if(close)$('projects-dialog').close();render();if(!p.view)fit();saveNow();
}
function renderProjectManager(){
  const dialog=$('projects-dialog');dialog.innerHTML=`<div class="dialog-heading"><span class="eyebrow">项目管理</span><button id="close-projects" class="icon-btn" aria-label="关闭项目管理">×</button></div><h2>我的项目</h2><p>每个项目独立保存文件、函数、调用链和画布布局。</p><form id="new-project-form" class="new-project-form"><input name="title" aria-label="新项目名称" placeholder="输入新项目名称…" maxlength="80" required/><button class="button primary" type="submit">＋ 新建项目</button></form><div class="project-list">${workspace.projects.map(p=>`<article class="project-card ${p.id===workspace.activeId?'active':''}"><div class="project-card-title"><span>▱</span><input data-project-name="${esc(p.id)}" aria-label="重命名 ${esc(p.document.title)}" value="${esc(p.document.title)}" maxlength="80"/></div><small>${new Set(p.document.nodes.map(n=>n.file||'未指定文件')).size} 个文件 · ${p.document.nodes.length} 个函数${p.id===workspace.activeId?' · 当前项目':''}</small><div class="project-card-actions"><button class="button secondary" data-open-project="${esc(p.id)}">${p.id===workspace.activeId?'返回画布':'进入项目'}</button><button class="text-btn" data-rename-project="${esc(p.id)}">保存名称</button><button class="text-btn remove-project" data-delete-project="${esc(p.id)}">删除</button></div></article>`).join('')}</div>${workspace.trash.length?`<details class="project-trash"><summary>最近删除 · ${workspace.trash.length}</summary>${workspace.trash.map(p=>`<div><span>${esc(p.document.title)}</span><button class="text-btn" data-restore-project="${esc(p.id)}">恢复项目</button></div>`).join('')}</details>`:''}`;
  dialog.querySelector('#close-projects').addEventListener('click',()=>dialog.close());
  dialog.querySelector('#new-project-form').addEventListener('submit',e=>{e.preventDefault();try{stashProject();const p=addProject(workspace,new FormData(e.currentTarget).get('title'));activateProject(p.id,{stash:false});toast('已创建项目');}catch(err){toast(err.message);}});
  dialog.querySelectorAll('[data-open-project]').forEach(b=>b.addEventListener('click',()=>activateProject(b.dataset.openProject)));
  dialog.querySelectorAll('[data-rename-project]').forEach(b=>b.addEventListener('click',()=>{try{stashProject();const id=b.dataset.renameProject,input=[...dialog.querySelectorAll('[data-project-name]')].find(i=>i.dataset.projectName===id);renameProject(workspace,id,input.value);if(id===workspace.activeId)doc=workspace.projects.find(p=>p.id===id).document;saveNow();render();renderProjectManager();toast('项目名称已更新');}catch(err){toast(err.message);}}));
  dialog.querySelectorAll('[data-delete-project]').forEach(b=>b.addEventListener('click',()=>{stashProject();const id=b.dataset.deleteProject,active=id===workspace.activeId;softDeleteProject(workspace,id);if(active)activateProject(workspace.activeId,{stash:false,close:false});else saveNow();renderProjectManager();toast('项目已移入最近删除，可恢复');}));
  dialog.querySelectorAll('[data-restore-project]').forEach(b=>b.addEventListener('click',()=>{try{restoreProject(workspace,b.dataset.restoreProject);saveNow();renderProjectManager();toast('项目已恢复');}catch(err){toast(err.message);}}));
}
function commit(change){if(readOnly)return;finishKeyMotion();history.push(clone(doc));if(history.length>60)history.shift();future=[];change();save();render();}
function undo(){finishKeyMotion();if(!history.length)return;future.push(clone(doc));doc=history.pop();sanitizeSelection();pending=null;save();render();toast('已撤销');}
function redo(){finishKeyMotion();if(!future.length)return;history.push(clone(doc));doc=future.pop();sanitizeSelection();pending=null;save();render();toast('已重做');}
function sanitizeSelection(){if(selected&&!(selected.type==='node'?nodeBy(selected.id):selected.type==='group'?groupBy(selected.id):edgeBy(selected.id)))selected=null;if(trace&&!nodeBy(trace.id))trace=null;tags=tags.filter(t=>doc.nodes.some(n=>n.tags.includes(t)));multi=new Set([...multi].filter(id=>nodeBy(id)));}
function functionTargets(node,lineId,name){
  const linked=[...new Set(doc.edges.filter(e=>e.type==='call'&&e.from===node.id&&e.fromLine===lineId&&nodeBy(e.to)?.name===name).map(e=>e.to))];if(linked.length)return linked;
  const candidates=doc.nodes.filter(n=>n.name===name);if(candidates.length<=1)return candidates.map(n=>n.id);
  const local=candidates.filter(n=>n.parentId===node.id||n.parentId===node.parentId);if(local.length===1)return [local[0].id];
  const sameFile=candidates.filter(n=>n.file&&n.file===node.file);return (sameFile.length===1?sameFile:candidates).map(n=>n.id);
}
function syntax(text,node,lineId){const attrs=(name,ids)=>`data-function-name="${esc(name)}" data-jump-nodes="${esc(JSON.stringify(ids))}" title="${ids.length?'Ctrl + 单击定位 '+esc(name):'尚未创建 '+esc(name)+' 的定义块'}"`;return highlightCode(text,node.language||'javascript',name=>{const local=nestedEntries(node).filter(entry=>entry.name===name),matches=local.length?local.map(entry=>({node,entry})):doc.nodes.flatMap(owner=>nestedEntries(owner).filter(entry=>entry.name===name).map(entry=>({node:owner,entry})));if(matches.length===1)return attrs(name,[matches[0].node.id])+` data-jump-line="${esc(matches[0].entry.lineId)}"`;return attrs(name,functionTargets(node,lineId,name));},name=>{const candidates=doc.nodes.filter(n=>blockKind(n)!=='function'&&n.name===name),sameFile=candidates.filter(n=>n.file&&n.file===node.file),ids=(sameFile.length===1?sameFile:candidates).map(n=>n.id);return ids.length?attrs(name,ids):'';});}
function canvasLines(n){
  const anchorIds=new Set(nestedEntries(n).map(entry=>entry.lineId));
  for(const edge of doc.edges){if(edge.from===n.id&&edge.fromLine)anchorIds.add(edge.fromLine);if(edge.to===n.id&&edge.toLine)anchorIds.add(edge.toLine);}
  if(showComments)return compactPreviewLines(n.code.map((line,index)=>({...line,index})),anchorIds);
  let cached=previewCache.get(n.code);if(!cached||cached.language!==n.language){cached={language:n.language,lines:codePreviewLines(n.code,n.language||'javascript')};previewCache.set(n.code,cached);}
  return compactPreviewLines(cached.lines,anchorIds);
}
function nestedEntries(n){return (n.innerFunctions||[]).map(entry=>({...entry,lineIndex:n.code.findIndex(line=>line.id===entry.lineId),scope:n.name+' / '+entry.name})).filter(entry=>entry.lineIndex>=0);}
function endpointTitle(edge,end){const n=nodeBy(edge[end]),entry=nestedEntries(n).find(entry=>entry.id===edge[end+'Entry']);return entry?entry.scope:n.name;}
function entryPort(n,entry){return `<button class="entry-port" data-inner-entry="${esc(n.id)}" data-inner-id="${esc(entry.id)}" data-inner-line="${esc(entry.lineId)}" aria-label="调用内部函数 ${esc(entry.name)}" title="${esc(entry.scope)} · 第 ${entry.lineIndex+1} 行入口"></button>`;}
function codeLineMarkup(n,line,linked){const entry=n.exposeEmbedded!==false?nestedEntries(n).find(entry=>entry.lineId===line.id):null;return `<div class="code-line ${linked.has(line.id)?'linked':''} ${entry?'inner-interface':''} ${focusedLine?.node===n.id&&focusedLine.line===line.id?'jump-focus':''}" data-line="${esc(line.id)}" ${entry?`data-entry-row="${esc(entry.id)}" style="--entry-color:${n.color}"`:''}>${entry?entryPort(n,entry):''}<span class="line-number">${line.index+1}</span><code>${line.hiddenCommentAnchor||line.hiddenBlankAnchor?`<span class="hidden-comment-anchor">${line.hiddenBlankAnchor?'空行':'注释已隐藏'} · 连线锚点</span>`:syntax(line.text,n,line.id)||' '}</code>${entry?`<span class="inline-entry-label">↳ ${esc(entry.name)}</span>`:''}<button class="line-port" data-line-port="${esc(line.id)}" aria-label="从第 ${line.index+1} 行连线" title="从第 ${line.index+1} 行发起调用"></button></div>`;}
function render(){
  sanitizeSelection();
  $('project-title').value=doc.title;
  document.title=`${doc.title} · Callpath`;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
  if(tool==='select')pointConnect=false;$('click-connect-btn').classList.toggle('active',pointConnect);
  $('mode-status').textContent=mode==='logic'?'LOGIC VIEW':'CODE VIEW';
  $('comments-btn').hidden=mode!=='code';$('comments-btn').setAttribute('aria-pressed',String(showComments));$('comments-btn').classList.toggle('active',showComments);$('comments-btn').textContent=showComments?'隐藏注释':'显示注释';
  $('undo-btn').disabled=!history.length;$('redo-btn').disabled=!future.length;
  $('edit-selection').disabled=!selected;
  $('group-btn').textContent=multi.size?`▧ 分区 (${multi.size})`:'▧ 分区';
  $('graph-status').textContent=`${doc.nodes.filter(n=>blockKind(n)==='function').length} 个函数 · ${doc.nodes.filter(n=>blockKind(n)!=='function').length} 个定义 · ${doc.edges.filter(e=>e.type==='call').length} 次调用 · ${(doc.groups||[]).length} 个分区`;
  renderSidebar();renderNodes();renderGroups();renderInspector();updateToolHint();applyCamera();drawEdges();
}
function renderSidebar(){
  const matches=visible();$('function-count').textContent=String(doc.nodes.length).padStart(2,'0');
  const files=new Set(doc.nodes.map(n=>n.file||'未指定文件'));$('sidebar-project-name').textContent=doc.title;$('sidebar-project-count').textContent=`${files.size} 个文件 · ${doc.nodes.length} 个块`;
  function branch(items){return items.map(item=>{const key=item.type+':'+item.path;return `<details class="tree-${item.type}" data-tree-key="${esc(key)}" ${closedTree.has(key)?'':'open'}><summary title="${esc(item.path)}"><span class="tree-icon">${item.type==='directory'?'▱':'▤'}</span><span>${esc(item.name)}</span>${item.type==='file'?`<small>${item.nodes.length}</small>`:''}</summary><div class="tree-children">${item.type==='directory'?branch(item.children):item.nodes.map(n=>`<button class="function-item ${selected?.type==='node'&&selected.id===n.id?'active':''} ${matches.has(n.id)?'':'dimmed'}" data-list-node="${esc(n.id)}" style="--node-color:${n.color}" title="${esc(scopePath(doc,n))}"><span class="fn-symbol">${blockSymbol(n)}</span><span class="function-name">${esc(scopePath(doc,n))}</span><span class="file-icon">↗</span></button>`).join('')}</div></details>`;}).join('');}
  $('function-list').innerHTML=doc.nodes.length?branch(buildFileTree(doc.nodes)):'<p class="no-results">还没有文件和函数。添加函数并填写所属文件后，会自动整理到这里。</p>';
  for(const button of $('function-list').querySelectorAll('[data-list-node]')){button.draggable=!readOnly;if(!readOnly)button.title+=' · 拖到画布摆放，或拖到文件修改归属';}
  for(const button of $('function-list').querySelectorAll('[data-list-node]')){const node=nodeBy(button.dataset.listNode),fragment=document.createDocumentFragment();for(const entry of nestedEntries(node)){const item=document.createElement('button');item.className='function-item tree-inner-function'+(matches.has(node.id)?'':' dimmed');item.dataset.listNode=node.id;item.dataset.listLine=entry.lineId;item.textContent='↳ '+entry.name;item.title=entry.scope+' · 第 '+(entry.lineIndex+1)+' 行';fragment.appendChild(item);}button.after(fragment);}
  for(const details of $('function-list').querySelectorAll('.tree-file')){const path=details.dataset.treeKey.slice(5);details.querySelector('summary').dataset.filePath=path==='未指定文件'&&!doc.nodes.some(n=>n.file===path)?'':path;}
  const tagMap=new Map();for(const n of doc.nodes)for(const t of new Set(n.tags)){if(!tagMap.has(t))tagMap.set(t,{count:0,color:n.color});tagMap.get(t).count++;}
  $('tag-list').innerHTML=[...tagMap].map(([t,v])=>`<button class="tag-filter ${tags.includes(t)?'active':''}" data-filter-tag="${esc(t)}" style="--tag-color:${v.color}" aria-pressed="${tags.includes(t)}"><i></i>${esc(t)}<span>${v.count}</span></button>`).join('')||'<span class="no-results">在函数属性中添加标签</span>';
  $('tag-match').textContent=matchAll?'全部匹配':'任一匹配';$('clear-filter').hidden=!isFiltering();
  const assigning=!readOnly&&tagEditing&&tags.length===1;$('viewport').classList.toggle('tag-editing',assigning);$('tag-edit-btn').hidden=readOnly||tags.length!==1;$('tag-edit-btn').classList.toggle('active',assigning);$('tag-edit-btn').textContent=assigning?'正在双击标记':'双击标记函数';$('tag-assignment').hidden=!assigning;$('tag-assignment-name').textContent=assigning?`双击画布中的函数，加入「${tags[0]}」。点击 ⋯ 或按 Enter 编辑。`:'';
  $('filter-indicator').hidden=!isFiltering();$('filter-indicator').textContent=`聚焦 ${matches.size} / ${doc.nodes.length} 个函数${trace?' · '+(trace.direction==='upstream'?'上游':'下游'):''}`;
}
function renderNodes(){
  const matches=visible();
  $('nodes').innerHTML=doc.nodes.map(n=>{
    const p=n.positions[mode];const selectedNode=selected?.type==='node'&&selected.id===n.id;
    const linked=new Set(doc.edges.flatMap(e=>[...(e.from===n.id&&e.fromLine?[e.fromLine]:[]),...(e.to===n.id&&e.toLine?[e.toLine]:[])]));
    return `<article class="node ${mode==='code'?'code-node':''} ${selectedNode?'selected':''} ${multi.has(n.id)?'multi-selected':''} ${matches.has(n.id)?'':'dimmed'} ${pending?.node===n.id?'connect-source':''}" data-node="${esc(n.id)}" style="left:${p.x}px;top:${p.y}px;--node-color:${n.color}" aria-label="${blockTitle(n)} ${esc(n.name)}"><span class="node-coordinates">X ${Math.round(p.x)} · Y ${Math.round(p.y)}</span>
      <button class="port in" data-port="in" title="连接到 ${esc(n.name)}" aria-label="连接到 ${esc(n.name)}" ${readOnly?'disabled tabindex="-1"':''}></button><button class="port out" data-port="out" title="从 ${esc(n.name)} 连出" aria-label="从 ${esc(n.name)} 连出" ${readOnly?'disabled tabindex="-1"':''}></button>
      <div class="node-header"><span class="node-function-icon">${blockSymbol(n)}</span><span class="node-title" title="${esc(scopePath(doc,n))}">${esc(n.name)}${blockKind(n)==='function'?'()':''}</span>${n.parentId?`<span class="node-scope">in ${esc(scopePath(doc,nodeBy(n.parentId)))}</span>`:''}<button class="node-menu" data-edit-node="${esc(n.id)}" title="${readOnly?'查看':'编辑'}${blockTitle(n)}" aria-label="${readOnly?'查看':'编辑'} ${esc(n.name)}">⋯</button></div>
      ${n.file?`<div class="node-file" title="${esc(n.file)}">▱ ${esc(n.file)}</div>`:''}
      ${mode==='logic'&&n.exposeEmbedded!==false&&nestedEntries(n).length?`<div class="nested-entries">${nestedEntries(n).map(entry=>`<div class="nested-entry" data-entry-row="${esc(entry.id)}" style="--entry-color:${n.color}">${entryPort(n,entry)}<span class="entry-symbol">↳</span><button class="entry-name" data-entry-jump="${esc(n.id)}" data-entry-line="${esc(entry.lineId)}" title="定位 ${esc(entry.scope)} 的定义">${esc(entry.name)}()</button><span class="entry-badge">内部入口</span></div>`).join('')}</div>`:''}
      ${mode==='code'?`<div class="code-lines">${canvasLines(n).map(line=>codeLineMarkup(n,line,linked)).join('')||'<div class="code-preview-empty">暂无可显示代码，双击编辑查看完整内容</div>'}</div>`:`<div class="node-description" title="${esc(n.description)}">${esc(n.description)||'添加一句函数说明…'}</div>`}
      <div class="node-tags">${n.tags.slice(0,5).map(t=>`<span class="node-tag">${esc(t)}</span>`).join('')||'<span class="node-tag">未分类</span>'}${n.tags.length>5?`<span class="node-tag">+${n.tags.length-5}</span>`:''}</div>
      <div class="node-foot"><button class="note-btn" data-note="${esc(n.id)}" title="展开或收起备注">${n.note?'▤ '+esc(n.note.split('\n')[0]):'＋ 添加备注'}</button><span>${mode==='code'?n.code.length+' lines':blockKind(n)==='function'?doc.edges.filter(e=>e.from===n.id&&e.type==='call').length+' 次调用':blockTitle(n)}</span></div>
      ${n.note?`<div class="node-note ${openNotes.has(n.id)?'open':''}">${esc(n.note)}</div>`:''}
    </article>`;
  }).join('');
  $('canvas-empty').hidden=doc.nodes.length>0;
  if(readOnly)$('nodes').querySelectorAll('[data-port],[data-line-port],[data-inner-entry]').forEach(button=>{button.disabled=true;button.tabIndex=-1;});
}
function measureNode(n){const el=nodeElement(n.id);return {x:n.positions[mode].x,y:n.positions[mode].y,w:mode==='code'?352:242,h:el?.offsetHeight||180};}
function groupBounds(g){const members=g.members.map(nodeBy).filter(Boolean);if(!members.length)return {...g.positions[mode],w:330,h:190};const rs=members.map(measureNode),x=Math.min(...rs.map(r=>r.x))-24,y=Math.min(...rs.map(r=>r.y))-52;return {x,y,w:Math.max(...rs.map(r=>r.x+r.w))-x+24,h:Math.max(...rs.map(r=>r.y+r.h))-y+24};}
function renderGroups(){
  $('groups').innerHTML=(doc.groups||[]).map(g=>{const r=groupBounds(g);return `<section class="group-frame ${selected?.type==='group'&&selected.id===g.id?'selected':''}" data-group="${esc(g.id)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;--group-color:${g.color}" aria-label="分区 ${esc(g.name)}"><div class="group-header" title="拖动以整体移动分区"><span>▧</span><strong>${esc(g.name)}</strong><small>${g.members.length} FUNCTIONS</small><button data-edit-group="${esc(g.id)}" aria-label="编辑分区 ${esc(g.name)}">⋯</button></div>${!g.members.length?'<div class="group-placeholder">在右侧勾选函数加入分区</div>':''}</section>`;}).join('');
}
function anchor(n,lineId,right){const r=measureNode(n);let y=r.y+28;const el=nodeElement(n.id);if(mode==='code'&&lineId&&el){const row=[...el.querySelectorAll('[data-line]')].find(e=>e.dataset.line===lineId);if(row)y=r.y+(row.getBoundingClientRect().top-el.getBoundingClientRect().top)/camera().z+12;}return {x:r.x+(right?r.w:0),y};}
function exposedAnchor(n,entryId){
  if(!entryId||n.exposeEmbedded===false)return null;
  const el=nodeElement(n.id),row=el&&[...el.querySelectorAll('[data-entry-row]')].find(row=>row.dataset.entryRow===entryId);
  if(!row)return null;const r=measureNode(n);return {x:r.x,y:r.y+(row.getBoundingClientRect().top-el.getBoundingClientRect().top+row.getBoundingClientRect().height/2)/camera().z};
}
function edgeGeometry(e){
  const a=nodeBy(e.from),b=nodeBy(e.to);if(!a||!b)return null;
  if(e.type==='return'){
    const call=e.callId?edgeBy(e.callId):doc.edges.find(c=>c.type==='call'&&c.from===e.to&&c.to===e.from);
    if(call?.type==='call'){
      const base=edgeGeometry(call),forward=base.dir>0,dir=base.dir;
      const peers=doc.edges.filter(r=>r.type==='return'&&(r.callId===call.id||(!r.callId&&r.from===e.from&&r.to===e.to))),offset=14+Math.max(0,peers.findIndex(r=>r.id===e.id))*12;
      const start=mode==='code'?exposedAnchor(a,e.fromEntry)||anchor(a,e.fromLine,!forward):null,end=mode==='code'?exposedAnchor(b,e.toEntry)||anchor(b,e.toLine,forward):null;
      if(end)end.y+=5;
      const segments=returnAlong(base.segments,{offset,start,end,dir});return {d:pathFor(segments),segments,dir};
    }
  }
  const exposed=exposedAnchor(b,e.toEntry),fromEntry=exposedAnchor(a,e.fromEntry);
  const ar=measureNode(a),br=measureNode(b);const forward=br.x>=ar.x;
  const s=fromEntry||anchor(a,e.fromLine,forward),t=exposed||anchor(b,e.toLine,!forward);
  const parallel=doc.edges.filter(v=>v.from===e.from&&v.to===e.to&&v.type===e.type),index=parallel.findIndex(v=>v.id===e.id),offset=index*22;
  if(a.id===b.id&&!exposed){const x=ar.x+ar.w+65+offset,segments=[{from:{x:ar.x+ar.w,y:s.y},c1:{x,y:s.y-70},c2:{x:x+30,y:s.y+110},to:{x:ar.x+ar.w,y:s.y+80}}];return {d:pathFor(segments),segments,dir:1};}
  const gap=Math.abs(t.x-s.x),dir=forward?1:-1;
  let lane=null;
  if(gap>420||e.type==='return'){
    const bottom=e.type==='return'||br.y>ar.y+50;
    lane=bottom?Math.max(ar.y+ar.h,br.y+br.h)+40+offset:Math.min(ar.y,br.y)-78-offset;
  }
  if(exposed&&s.x>=t.x)lane=Math.max(ar.y+ar.h,br.y+br.h)+40+offset;
  if(fromEntry&&t.x>s.x)lane=Math.max(ar.y+ar.h,br.y+br.h)+40+offset;
  const segments=routeBetween(s,t,{dir:fromEntry?-1:dir,endDir:exposed?1:dir,lane,offset});return {d:pathFor(segments),segments,dir};
}
function drawEdges(){
  const matches=visible();
  const chosen=selected?.type==='edge'?edgeBy(selected.id):null,callId=chosen?.type==='return'?chosen.callId:chosen?.id;
  const defs=`<defs><marker id="arrow-call" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="#71c9ef" stroke-width="1.3"/></marker><marker id="arrow-return" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="#b5a1e7" stroke-width="1.3"/></marker></defs>`;
  $('edges').innerHTML=defs+doc.edges.map(e=>{const g=edgeGeometry(e);if(!g)return '';return `<g class="edge ${e.type} ${selected?.type==='edge'&&selected.id===e.id?'selected':''} ${callId&&(e.id===callId||e.callId===callId)?'related':''} ${matches.has(e.from)&&matches.has(e.to)?'':'dimmed'}" data-edge="${esc(e.id)}" role="button" tabindex="0" aria-label="${esc(endpointTitle(e,'from'))} ${e.type==='call'?'调用':'返回到'} ${esc(endpointTitle(e,'to'))}"><path class="hit-path" d="${g.d}"/><path class="visible-path" d="${g.d}" marker-end="url(#arrow-${e.type})"/></g>`;}).join('');
}
function applyCamera(){const c=camera();$('scene').style.transform=`translate(${c.x}px,${c.y}px) scale(${c.z})`;$('zoom-value').textContent=Math.round(c.z*100)+'%';$('viewport').style.backgroundPosition=`${c.x}px ${c.y}px`;$('viewport').style.backgroundSize=`${20*c.z}px ${20*c.z}px`;}
function fit(){
  if(!doc.nodes.length){cameras[mode]={x:20,y:100,z:1};applyCamera();save();return;}
  const matches=visible(),chosen=doc.nodes.filter(n=>matches.has(n.id)),nodes=chosen.length?chosen:doc.nodes;
  const rects=[...nodes.map(measureNode),...(doc.groups||[]).filter(g=>!g.members.length||g.members.some(id=>nodes.some(n=>n.id===id))).map(groupBounds)],minX=Math.min(...rects.map(r=>r.x))-40,maxX=Math.max(...rects.map(r=>r.x+r.w))+40,minY=Math.min(...rects.map(r=>r.y))-35,maxY=Math.max(...rects.map(r=>r.y+r.h))+70;
  const w=$('viewport').clientWidth,h=$('viewport').clientHeight,top=mobileLayout.matches?20:55,bottom=mobileLayout.matches?125:90;
  const z=Math.min(1.15,Math.max(.2,Math.min((w-48)/(maxX-minX),(h-top-bottom)/(maxY-minY))));
  cameras[mode]={z,x:(w-(maxX-minX)*z)/2-minX*z,y:top-minY*z};applyCamera();drawEdges();save();
}
function zoom(factor,point){const c=camera(),rect=$('viewport').getBoundingClientRect();const p=point||{x:rect.width/2,y:rect.height/2};const next=Math.max(.2,Math.min(2,c.z*factor));c.x=p.x-(p.x-c.x)*next/c.z;c.y=p.y-(p.y-c.y)*next/c.z;c.z=next;applyCamera();save();}
function centerNode(id){const n=nodeBy(id);if(!n)return;const r=measureNode(n),c=camera(),w=$('viewport').clientWidth,h=$('viewport').clientHeight;c.x=w/2-(r.x+r.w/2)*c.z;c.y=mobileLayout.matches?Math.max(16,(h-110-r.h*c.z)/2)-r.y*c.z:h/2-(r.y+r.h/2)*c.z;applyCamera();save();}
function renderInnerMarkers(){
  const list=$('embedded-list');if(!list)return;const lines=editorLines||[];
  list.innerHTML=innerDraft.map((entry,index)=>`<div class="inner-marker" data-inner-marker="${esc(entry.id)}"><label>函数名<input data-inner-name="${esc(entry.id)}" aria-label="内嵌函数名称 ${index+1}" value="${esc(entry.name)}" maxlength="100" placeholder="例如 internal_demuxer" required/></label><label class="inner-marker-line">行号<input data-inner-line="${esc(entry.id)}" aria-label="内嵌函数行号 ${index+1}" type="number" min="1" max="${lines.length}" value="${lines.findIndex(line=>line.id===entry.lineId)+1||''}" required/></label><button type="button" data-inner-locate="${esc(entry.id)}" title="定位到代码行" aria-label="定位内嵌函数 ${index+1}">⌖</button><button type="button" data-inner-remove="${esc(entry.id)}" title="移除入口标记，保留代码" aria-label="移除内嵌函数标记 ${index+1}">×</button></div>`).join('')||'<small>添加行号和名称即可，不复制或生成代码。</small>';
  list.querySelectorAll('[data-inner-name]').forEach(input=>input.addEventListener('input',()=>{innerDraft.find(entry=>entry.id===input.dataset.innerName).name=input.value;}));
  list.querySelectorAll('[data-inner-line]').forEach(input=>input.addEventListener('input',()=>{innerDraft.find(entry=>entry.id===input.dataset.innerLine).lineId=lines[Number(input.value)-1]?.id||null;}));
  list.querySelectorAll('[data-inner-remove]').forEach(button=>button.addEventListener('click',()=>{innerDraft=innerDraft.filter(entry=>entry.id!==button.dataset.innerRemove);renderInnerMarkers();}));
  if(readOnly){list.querySelectorAll('input').forEach(input=>input.readOnly=true);list.querySelectorAll('[data-inner-remove]').forEach(button=>button.hidden=true);}
  list.querySelectorAll('[data-inner-locate]').forEach(button=>button.addEventListener('click',()=>{const entry=innerDraft.find(entry=>entry.id===button.dataset.innerLocate),index=lines.findIndex(line=>line.id===entry.lineId);if(index<0){toast('对应代码行已删除，请重新选择行号');return;}const offset=lines.slice(0,index).reduce((total,line)=>total+line.text.length+1,0);codeEditor?.reveal(offset,offset+lines[index].text.length);}));
}
function mountCodeEditor(){const panel=$('inspector'),host=panel.querySelector('.cm-host'),source=panel.querySelector('textarea[name="code"]');if(codeEditor||!host||!source)return;const form=source.closest('form');codeEditor=createCodeEditor({parent:host,doc:source.value,language:form.elements.language.value,indentSize:Number(form.elements.indentSize.value),readOnly,onChange:value=>{source.value=value;try{editorLines=reconcileLines(editorLines||nodeBy(selected.id).code,value);renderInnerMarkers();}catch{}}});form.elements.language.addEventListener('change',()=>codeEditor?.setLanguage(form.elements.language.value));form.elements.indentSize.addEventListener('change',()=>codeEditor?.setIndentSize(Number(form.elements.indentSize.value)));renderInnerMarkers();}
function openInspector(){if(mobileLayout.matches&&document.querySelector('.app').classList.contains('mobile-sidebar-open'))mobileSidebar(false);finishKeyMotion();if(selected&&!$('inspector').open)$('inspector').showModal();mountCodeEditor();codeEditor?.measure();}
function select(type,id,edit=true){finishKeyMotion();selected={type,id};multi.clear();$('group-btn').textContent='▧ 分区';$('edit-selection').disabled=false;renderSidebar();for(const el of $('nodes').children){el.classList.toggle('selected',type==='node'&&el.dataset.node===id);el.classList.remove('multi-selected');for(const row of el.querySelectorAll('[data-line]'))row.classList.toggle('jump-focus',focusedLine?.node===el.dataset.node&&focusedLine.line===row.dataset.line);}for(const el of $('groups').children)el.classList.toggle('selected',type==='group'&&el.dataset.group===id);renderInspector();drawEdges();if(edit)openInspector();}
function jumpToNode(id,line=null){if(!nodeBy(id))return;if($('inspector').open)$('inspector').close();if(pending||tool!=='select')setTool('select');focusedLine=line?{node:id,line}:null;select('node',id,false);centerNode(id);$('viewport').focus();toast('已定位到 '+nodeBy(id).name+(mode==='code'&&line?' 的对应代码行':''));}
function showJumpTargets(ids){const dialog=$('jump-dialog');dialog.innerHTML=`<div class="dialog-heading"><span class="eyebrow">JUMP TO FUNCTION</span><button id="close-jump" class="icon-btn" aria-label="关闭目标选择">×</button></div><h2>选择要定位的函数</h2><p>找到多个同名函数，可根据作用域和所属文件选择。</p>${ids.map(id=>{const n=nodeBy(id);return `<button class="export-option" data-jump-choice="${esc(id)}"><div><strong>${esc(scopePath(doc,n))}</strong><small>${esc(n.file||'未指定文件')}</small></div><span>→</span></button>`;}).join('')}`;dialog.querySelector('#close-jump').addEventListener('click',()=>dialog.close());dialog.querySelectorAll('[data-jump-choice]').forEach(b=>b.addEventListener('click',()=>{dialog.close();jumpToNode(b.dataset.jumpChoice);}));dialog.showModal();}
function labelField(label,name,value,{textarea=false,placeholder='',code=false,hint=''}={}){
  if(code){const language=nodeBy(selected.id)?.language||'javascript',indentSize=nodeBy(selected.id)?.indentSize||(['javascript','typescript','json'].includes(language)?2:4);return `<div class="field code-field"><div class="field-label"><span>〈/〉代码</span><select name="language" class="language-select" aria-label="代码类型">${Object.entries(LANGUAGES).map(([key,title])=>`<option value="${key}" ${key===language?'selected':''}>${title}</option>`).join('')}</select><select name="indentSize" class="indent-select" aria-label="缩进空格数">${[2,4,8].map(size=>`<option value="${size}" ${size===indentSize?'selected':''}>${size} 空格</option>`).join('')}</select></div><div class="code-editor-wrap"><div class="cm-host"></div><textarea name="code" hidden aria-hidden="true">${esc(value)}</textarea></div></div>`;}
  return `<label class="field"><span class="field-label">${label}${hint?`<small>${hint}</small>`:''}</span>${textarea?`<textarea name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${name==='name'?100:name==='file'?500:name==='tags'?800:5000}"/>`}</label>`;
}
function inspectorTitle(label,code){return `<div class="inspector-title">${label}<span>${code}</span>${selected?.type==='node'?'<button id="locate-node" class="text-btn">⌖ 定位函数</button>':''}<button class="icon-btn" id="close-inspector" title="关闭属性" aria-label="关闭属性">×</button></div>`;}
function lineOptions(node,current){return `<option value="">函数块（未绑定代码行）</option>`+node.code.map((l,i)=>`<option value="${esc(l.id)}" ${l.id===current?'selected':''}>L${i+1} · ${esc(l.text.trim().slice(0,35))}</option>`).join('');}
function pairedDetails(e){const related=e.type==='return'?(e.callId?[edgeBy(e.callId)].filter(Boolean):[]):doc.edges.filter(r=>r.callId===e.id);if(!related.length)return '';return `<div class="paired-details"><h3>${e.type==='call'?'关联返回':'关联调用'} · 与当前连线并排显示</h3>${related.map(r=>`<button type="button" data-select-edge="${esc(r.id)}">${r.type==='call'?'↗':'↩'} ${esc(r.label||'未命名')}<span>${esc(r.params||'点击查看和编辑详情')}</span><b>→</b></button>`).join('')}</div>`;}
function renderInspector(){
  codeEditor?.destroy();codeEditor=null;
  editingColor=null;
  if(!selected){
    if($('inspector').open)$('inspector').close();$('inspector').innerHTML='';return;
  }
  if(selected.type==='group'){
    const g=groupBy(selected.id);if(!g)return;editingColor=g.color;const bounds=groupBounds(g);
    $('inspector').innerHTML=inspectorTitle('分区属性','PARTITION')+`<div class="inspector-hero"><div class="inspector-icon">▧</div><h2>${esc(g.name)}</h2><p>拖动分区标题，整体移动其中的函数。每个函数归属一个分区。</p></div><form id="group-form" class="inspector-form">${labelField('分区名称','name',g.name)}${labelField('▤ 分区备注','note',g.note,{textarea:true,placeholder:'记录这个模块的职责…'})}<div class="field"><span class="field-label">分区颜色</span><div class="color-options">${COLORS.map(c=>`<button type="button" class="color-dot ${g.color===c?'active':''}" style="--swatch:${c}" data-color="${c}" aria-label="选择颜色 ${c}"></button>`).join('')}</div></div><div class="field"><span class="field-label">包含的函数<small>勾选后点击保存</small></span><div class="group-members">${doc.nodes.map(n=>{const other=(doc.groups||[]).find(v=>v.id!==g.id&&v.members.includes(n.id));return `<label><input type="checkbox" name="members" value="${esc(n.id)}" ${g.members.includes(n.id)?'checked':''}/><span>${esc(n.name)}</span>${other?`<small>从 ${esc(other.name)} 移入</small>`:''}</label>`;}).join('')||'<p>先添加函数，再分配归属。</p>'}</div></div><p class="field-help">左上角坐标 X ${Math.round(bounds.x)} · Y ${Math.round(bounds.y)}<br/>边界会自动包围成员函数。</p><button type="submit" class="button primary">保存分区</button><button type="button" id="delete-selection" class="button delete-btn">解散分区 · 保留函数</button></form><div class="inspector-bottom">A PLACE FOR EVERY FUNCTION.</div>`;
  }else if(selected.type==='node'){
    const n=nodeBy(selected.id);if(!n)return;editingColor=n.color;editorLines=clone(n.code);innerDraft=clone(n.innerFunctions||[]);
    $('inspector').innerHTML=inspectorTitle(blockTitle(n)+'属性',blockKind(n).toUpperCase())+`<div class="inspector-hero"><div class="inspector-icon" style="color:${n.color};border-color:${n.color}55;background:${n.color}10">${blockSymbol(n)}</div><h2>${esc(n.name)}${blockKind(n)==='function'?'()':''}</h2><p>${esc(n.description)||'记录定义、所属文件和说明。'}</p></div><form id="node-form" class="inspector-form">
      ${labelField(blockTitle(n)+'名称','name',n.name,{placeholder:'输入名称'})}
      ${labelField('功能说明','description',n.description,{placeholder:'一句话说明函数的职责'})}
      ${labelField('所属文件','file',n.file||'',{placeholder:'例如 src/auth/login.ts',hint:'相对项目路径'})}
      ${blockKind(n)==='function'?`<section class="field nested-functions"><div class="field-label">内嵌函数入口<button type="button" id="add-nested-function">＋ 添加</button></div><p>行号控制左侧接口，名称用于检索与跳转。</p><div id="embedded-list"></div><label class="nested-entry-option"><input type="checkbox" name="exposeEmbedded" ${n.exposeEmbedded!==false?'checked':''}/><span>在画布左侧显示入口</span></label></section>`:''}
      <div class="field"><span class="field-label">左上角坐标<small>逻辑 / 代码模式共用 · px</small></span><div class="coordinate-inputs"><label>X<input name="posX" type="number" step="1" min="-100000" max="100000" value="${Math.round(n.positions[mode].x)}"/></label><label>Y<input name="posY" type="number" step="1" min="-100000" max="100000" value="${Math.round(n.positions[mode].y)}"/></label></div></div>
      <label class="field"><span class="field-label">所属分区</span><select name="groupId"><option value="">不属于任何分区</option>${(doc.groups||[]).map(g=>`<option value="${esc(g.id)}" ${g.members.includes(n.id)?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">父函数 / 嵌套作用域<small>定义关系，不自动连调用线</small></span><select name="parentId"><option value="">文件级定义</option>${doc.nodes.filter(p=>blockKind(p)==='function'&&p.id!==n.id&&canParent(doc,n.id,p.id)).map(p=>`<option value="${esc(p.id)}" ${n.parentId===p.id?'selected':''}>${esc(scopePath(doc,p))}</option>`).join('')}</select></label>
      <div class="field"><span class="field-label">标记颜色</span><div class="color-options">${COLORS.map(c=>`<button type="button" class="color-dot ${n.color===c?'active':''}" style="--swatch:${c}" data-color="${c}" aria-label="选择颜色 ${c}"></button>`).join('')}</div></div>
      ${labelField('标签','tags',n.tags.join(', '),{placeholder:'认证, 数据, 入口',hint:'逗号分隔'})}
      ${labelField('▤ '+blockTitle(n)+'备注','note',n.note,{textarea:true,placeholder:'记录思路、前置条件或待解决的问题…'})}
      ${labelField('〈/〉代码','code',n.code.map(l=>l.text).join('\n'),{textarea:true,code:true,hint:n.code.length+' 行'})}
      <button class="button primary" type="submit">保存修改</button>
      ${blockKind(n)==='function'?`<div class="inspector-section"><h3>聚焦调用链</h3><div class="trace-buttons"><button type="button" data-trace="upstream" class="${trace?.id===n.id&&trace.direction==='upstream'?'active':''}">↖ 谁调用了它</button><button type="button" data-trace="downstream" class="${trace?.id===n.id&&trace.direction==='downstream'?'active':''}">↘ 它调用了谁</button></div><div class="inspector-meta"><span>${doc.edges.filter(e=>e.to===n.id&&e.type==='call').length} 次被调用</span><span>${doc.edges.filter(e=>e.from===n.id&&e.type==='call').length} 次向外调用</span></div></div>`:'<div class="inspector-section"><p class="field-help">在代码中 Ctrl + 单击本定义的名称，可直接跳转到此块。</p></div>'}
      <button type="button" id="delete-selection" class="button delete-btn">删除${blockTitle(n)}及相关连线</button></form><div class="inspector-bottom">CHANGES SAVED LOCALLY.</div>`;
  }else{
    const e=edgeBy(selected.id);if(!e)return;
    const a=nodeBy(e.from),b=nodeBy(e.to),isReturn=e.type==='return';
    $('inspector').innerHTML=inspectorTitle('连线详情',isReturn?'RETURN':'CALL')+`<div class="inspector-hero"><div class="inspector-icon">${isReturn?'↩':'↗'}</div><h2>${esc(endpointTitle(e,'from'))} ${isReturn?'↩':'→'} ${esc(endpointTitle(e,'to'))}</h2><p>${isReturn?'返回详情':'调用详情'} · 参数与说明仅在此显示，画布保持简洁。</p></div>${pairedDetails(e)}<form id="edge-form" class="inspector-form"><div class="field"><span class="field-label">关系类型</span><select name="type"><option value="call" ${isReturn?'':'selected'}>调用 →</option><option value="return" ${isReturn?'selected':''}>返回 ↩</option></select></div>
      <div class="jump-actions"><button type="button" data-jump-end="from">⌖ 定位起点 · ${esc(a.name)}</button><button type="button" data-jump-end="to">⌖ 定位终点 · ${esc(b.name)}</button></div>
      ${labelField('连线名称','label',e.label,{placeholder:isReturn?'例如 token':'例如 查询用户'})}
      ${labelField(isReturn?'返回值 / 其他信息':'参数 / 其他信息','params',e.params,{textarea:true,placeholder:isReturn?'例如 { user, token }':'例如 userId = 42'})}
      ${labelField('触发条件','condition',e.condition,{placeholder:'例如 ok === true'})}
      <label class="field"><span class="field-label">起始代码行<small>${esc(a.name)}</small></span><select name="fromLine">${lineOptions(a,e.fromLine)}</select></label>
      <label class="field"><span class="field-label">${isReturn?'返回位置':'目标代码行'}<small>${esc(b.name)}</small></span><select name="toLine">${lineOptions(b,e.toLine)}</select></label>
      ${isReturn?`<label class="field"><span class="field-label">关联调用</span><select name="callId"><option value="">独立返回（未关联）</option>${doc.edges.filter(c=>c.type==='call'&&c.from===e.to&&c.to===e.from).map(c=>`<option value="${esc(c.id)}" ${c.id===e.callId?'selected':''}>${esc(c.label||c.params||'未命名调用')}</option>`).join('')}</select></label>`:''}
      ${labelField('▤ 连线备注','note',e.note,{textarea:true,placeholder:'补充这次调用或返回的说明…'})}
      <button type="submit" class="button primary">保存修改</button>${!isReturn?'<button id="add-linked-return" type="button" class="button secondary">↩ 添加这次调用的返回</button>':''}<button type="button" id="delete-selection" class="button delete-btn">删除${isReturn?'返回':'调用及关联返回'}</button></form><div class="inspector-bottom">${e.fromLine?'LINE ANCHOR CONNECTED.':'FUNCTION LEVEL CONNECTION.'}</div>`;
  }
  bindInspector();
}
function bindInspector(){
  const panel=$('inspector'),body=document.createElement('div');body.className='editor-body';for(const child of [...panel.children])if(!child.classList.contains('inspector-title'))body.appendChild(child);panel.appendChild(body);
  const footer=document.createElement('div');footer.className='editor-footer';footer.innerHTML='<span>Tab 缩进 · Shift+Tab 反缩进 · Ctrl+F 搜索 · Ctrl+Enter 保存</span><button type="button" class="button secondary" data-editor-close>返回画布</button><button type="button" class="button primary" data-editor-save>保存修改</button>';panel.appendChild(footer);
  footer.querySelector('[data-editor-save]').addEventListener('click',()=>panel.querySelector('form')?.requestSubmit());footer.querySelector('[data-editor-close]').addEventListener('click',()=>{selected=null;render();});
  $('close-inspector')?.addEventListener('click',()=>{selected=null;render();});
  $('locate-node')?.addEventListener('click',()=>jumpToNode(selected.id));
  document.querySelectorAll('[data-jump-end]').forEach(b=>b.addEventListener('click',()=>{const e=edgeBy(selected.id),end=b.dataset.jumpEnd;jumpToNode(e[end],e[end+'Line']);}));
  document.querySelectorAll('[data-select-edge]').forEach(b=>b.addEventListener('click',()=>select('edge',b.dataset.selectEdge)));
  $('inspector-help')?.addEventListener('click',()=>$('help-dialog').showModal());
  $('add-nested-function')?.addEventListener('click',()=>{if(innerDraft.length>=100){toast('一个函数块最多支持 100 个内嵌入口');return;}const index=codeEditor?.view.state.doc.lineAt(codeEditor.view.state.selection.main.head).number||1;innerDraft.push({id:uid('inner'),name:'',lineId:editorLines[index-1]?.id});renderInnerMarkers();$('embedded-list').querySelectorAll('[data-inner-name]').item(innerDraft.length-1)?.focus();});
  $('node-form')?.addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(event.currentTarget),name=String(data.get('name')).trim();if(!name){toast('请填写函数名称');return;}
    const newTags=[...new Set(String(data.get('tags')).split(/[,，\n]/).map(t=>t.trim()).filter(Boolean))];if(newTags.length>20||newTags.some(t=>t.length>40)){toast('最多支持 20 个标签，每个标签不超过 40 字');return;}
    const n=nodeBy(selected.id);let code;try{const source=String(data.get('code'));code=editorLines&&editorLines.map(line=>line.text).join('\n')===source?clone(editorLines):reconcileLines(n.code,source);}catch(err){toast(err.message);return;}
    const entryLines=new Set();for(const entry of innerDraft){if(!entry.name.trim()||entry.name.length>100){toast('请填写内嵌函数名称（最多 100 字符）');return;}if(!code.some(line=>line.id===entry.lineId)){toast('内嵌函数「'+entry.name+'」的行已删除，请重新选择行号');return;}if(entryLines.has(entry.lineId)){toast('同一行只能暴露一个内嵌函数入口');return;}entryLines.add(entry.lineId);}
    const x=Number(data.get('posX')),y=Number(data.get('posY'));if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>100000||Math.abs(y)>100000){toast('坐标必须在 -100000 到 100000 之间');return;}
    const parentId=String(data.get('parentId')||'')||null;if(parentId&&!canParent(doc,n.id,parentId)){toast('父函数不能指向自身或自己的子函数');return;}
    const file=String(data.get('file')||'').trim();if(file.length>500){toast('文件路径不能超过 500 字符');return;}
    let detached=0;commit(()=>{Object.assign(n,{name,parentId,innerFunctions:innerDraft.map(entry=>({...entry,name:entry.name.trim()})),exposeEmbedded:data.has('exposeEmbedded'),file,language:String(data.get('language')||'javascript'),indentSize:Number(data.get('indentSize')||4),description:String(data.get('description')),tags:newTags,note:String(data.get('note')),code,color:editingColor||n.color});setBlockPosition(n,{x,y});for(const g of doc.groups||[]){g.members=g.members.filter(id=>id!==n.id);if(g.id===data.get('groupId'))g.members.push(n.id);}detached=repairAnchors(doc);});toast(detached?`已保存；${detached} 处已删除代码行的连线改为连接函数块`:'函数已更新');
  });
  $('group-form')?.addEventListener('submit',e=>{e.preventDefault();const data=new FormData(e.currentTarget),name=String(data.get('name')).trim();if(!name){toast('请填写分区名称');return;}const g=groupBy(selected.id),members=data.getAll('members').map(String);commit(()=>{g.name=name;g.note=String(data.get('note'));g.color=editingColor||g.color;for(const other of doc.groups)if(other.id!==g.id)other.members=other.members.filter(id=>!members.includes(id));g.members=members;});toast('分区已更新');});
  $('edge-form')?.addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(event.currentTarget),e=edgeBy(selected.id),nextType=String(data.get('type'));
    const linkedReturns=doc.edges.filter(r=>r.callId===e.id);
    commit(()=>{e.type=nextType;for(const k of ['label','params','condition','note'])e[k]=String(data.get(k)||'');e.fromLine=String(data.get('fromLine')||'')||null;e.toLine=String(data.get('toLine')||'')||null;if(nextType==='call'){delete e.callId;for(const r of linkedReturns)r.toLine=e.fromLine;}else{e.callId=String(data.get('callId')||'')||undefined;for(const r of linkedReturns)delete r.callId;}repairAnchors(doc);});toast('连线已更新');
  });
  document.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click',()=>{editingColor=b.dataset.color;document.querySelectorAll('[data-color]').forEach(c=>c.classList.toggle('active',c===b));}));
  document.querySelectorAll('[data-trace]').forEach(b=>b.addEventListener('click',()=>{const dir=b.dataset.trace;trace=trace?.id===selected.id&&trace.direction===dir?null:{id:selected.id,direction:dir};render();}));
  $('delete-selection')?.addEventListener('click',()=>{const s=selected;commit(()=>{if(s.type==='node')deleteNode(doc,s.id);else if(s.type==='group')doc.groups=doc.groups.filter(g=>g.id!==s.id);else deleteEdge(doc,s.id);selected=null;});toast(s.type==='group'?'已解散分区，函数已保留；可撤销恢复':'已删除，可使用撤销恢复');});
  $('add-linked-return')?.addEventListener('click',()=>addReturn(edgeBy(selected.id)));
  if(panel.open)mountCodeEditor();
  if(readOnly){
    panel.classList.add('readonly-inspector');
    panel.querySelector('.inspector-title').firstChild.textContent='只读详情 ';
    panel.querySelectorAll('input,textarea').forEach(input=>{input.readOnly=true;if(input.type==='checkbox')input.disabled=true;});
    panel.querySelectorAll('select').forEach(select=>select.disabled=true);
    panel.querySelectorAll('button[type="submit"],#delete-selection,#add-linked-return,#add-nested-function,[data-inner-remove],[data-color],[data-editor-save]').forEach(button=>button.hidden=true);
    footer.querySelector('span').textContent='只读项目 · 可查看、搜索和定位代码';
    panel.querySelectorAll('.inspector-bottom').forEach(el=>el.textContent='只读分享 · 无法修改原项目');
  }
}
function updateToolHint(){
  $('viewport').classList.toggle('connecting',tool!=='select'||!!pending);
  $('connection-hint').hidden=tool==='select'&&!pending;
  const name=pending?nodeBy(pending.node)?.name:'';
  $('connection-hint').innerHTML=`${pending?`已选 ${esc(name)}${pending.line?' 的代码行':''}，点击${tool==='return'?'调用方':'目标'}函数${mode==='code'?'或代码行':''}`:`点击起始函数${mode==='code'?'或代码行':''}，添加${tool==='return'?'返回':'调用'}连线`}<button id="cancel-connect">取消 Esc</button>`;
  $('cancel-connect')?.addEventListener('click',()=>setTool('select'));
}
function setTool(next){if(readOnly)next='select';tool=next;pending=null;if(next==='select')pointConnect=false;$('click-connect-btn').classList.toggle('active',pointConnect);document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));renderNodes();updateToolHint();drawEdges();}
function connect(nodeId,lineId=null,entryId=null){
  if(readOnly)return;
  if(blockKind(nodeBy(nodeId))!=='function'){toast('结构体和宏可通过 Ctrl 点击名称跳转，无需调用线');return;}
  if(!pending){pending={node:nodeId,line:lineId,entry:entryId};if(tool==='select')tool='call';document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));renderNodes();updateToolHint();drawEdges();return;}
  const from=nodeBy(pending.node),to=nodeBy(nodeId),isReturn=tool==='return';
  const edge={id:uid('edge'),type:isReturn?'return':'call',from:from.id,to:to.id,fromLine:pending.line,toLine:lineId,fromEntry:pending.entry||null,toEntry:entryId,label:isReturn?'返回':'调用',params:'',condition:'',note:''};
  if(isReturn){const calls=doc.edges.filter(c=>c.type==='call'&&c.from===to.id&&c.to===from.id);if(calls.length===1){edge.callId=calls[0].id;if(!edge.toLine)edge.toLine=calls[0].fromLine;}}
  lastConnectionAt=performance.now();commit(()=>{doc.edges.push(edge);selected={type:'edge',id:edge.id};pending=null;if(!pointConnect)tool='select';});$('viewport').focus();toast('已连接；点击连线可编辑详情');
}
function addReturn(call){if(!call)return;const callee=nodeBy(call.to);const returnLine=[...callee.code].reverse().find(l=>/\breturn\b/.test(l.text));const e={id:uid('edge'),type:'return',callId:call.id,from:call.to,to:call.from,fromLine:call.toEntry?call.toLine:returnLine?.id||null,toLine:call.fromLine,fromEntry:call.toEntry||null,toEntry:call.fromEntry||null,label:'返回值',params:'',condition:'',note:''};commit(()=>{doc.edges.push(e);selected={type:'edge',id:e.id};});toast('已添加关联返回，请填写返回值');}
function addNode(kind='function'){
  if(readOnly)return;
  if(typeof kind!=='string')kind='function';
  if(doc.nodes.length>=200){toast('Demo 最多支持 200 个代码块');return;}
  const id=uid('fn'),view=$('viewport'),c=camera(),p={x:(view.clientWidth/2-c.x)/c.z-120,y:(view.clientHeight/2-c.y)/c.z-60};let num=doc.nodes.length+1;while(doc.nodes.some(n=>n.name==='function'+num))num++;
  let name=kind==='struct'?'Struct'+num:kind==='macro'?'MACRO_'+num:'function'+num;while(doc.nodes.some(n=>n.name===name)){num++;name=kind==='struct'?'Struct'+num:kind==='macro'?'MACRO_'+num:'function'+num;}
  const text=kind==='struct'?`struct ${name} {\n    int value;\n};`:kind==='macro'?`#define ${name} 1`:`function ${name}() {\n  // 在这里记录你的代码\n}`;
  const n={id,name,kind,language:kind==='function'?'javascript':'c',file:'',description:'',note:'',tags:[],color:COLORS[doc.nodes.length%COLORS.length],code:text.split('\n').map(text=>({id:uid('line'),text})),positions:{logic:{...p},code:{...p}}};
  search='';tags=[];trace=null;$('search').value='';commit(()=>{doc.nodes.push(n);selected={type:'node',id};pending=null;tool='select';});openInspector();setTimeout(()=>$('node-form')?.elements.name.focus(),0);
}
function addGroup(){
  if(readOnly)return;
  if((doc.groups||[]).length>=100){toast('最多支持 100 个分区');return;}
  const members=multi.size?[...multi]:selected?.type==='node'?[selected.id]:[];
  const c=camera(),pos={x:($('viewport').clientWidth/2-c.x)/c.z-165,y:($('viewport').clientHeight/2-c.y)/c.z-80};
  const g={id:uid('group'),name:'新分区',note:'',color:COLORS[(doc.groups||[]).length%COLORS.length],members,positions:{logic:{...pos},code:{...pos}}};
  commit(()=>{doc.groups||=[];for(const old of doc.groups)old.members=old.members.filter(id=>!members.includes(id));doc.groups.push(g);multi.clear();selected={type:'group',id:g.id};});openInspector();toast(members.length?`已将 ${members.length} 个函数圈入新分区`:'已创建分区，在弹窗勾选要加入的函数');
}
function setMode(next){if(mode===next)return;finishKeyMotion();cameras[next]={...camera()};mode=next;pending=null;tool='select';render();if(mobileLayout.matches&&selected?.type==='node')centerNode(selected.id);save();}
function download(content,type,extension){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=(doc.title.replace(/[<>:"/\\|?*]/g,'_')||'callpath')+'.'+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportSvg(){
  if(!doc.nodes.length){toast('先添加一个函数再导出');return;}
  const chosen=doc.nodes.filter(n=>visible().has(n.id));if(!chosen.length){toast('当前没有匹配的函数，请先清除筛选');return;}
  const rects=[...chosen.map(measureNode),...(doc.groups||[]).filter(g=>g.members.some(id=>chosen.some(n=>n.id===id))).map(groupBounds)],minX=Math.min(...rects.map(r=>r.x))-100,minY=Math.min(...rects.map(r=>r.y))-120,maxX=Math.max(...rects.map(r=>r.x+r.w))+100,maxY=Math.max(...rects.map(r=>r.y+r.h))+140;
  const ids=new Set(chosen.map(n=>n.id));
  const paths=doc.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>{const g=edgeGeometry(e);return `<g><path d="${g.d}" fill="none" stroke="${e.type==='call'?'#71c9ef':'#b5a1e7'}" stroke-width="1.7" ${e.type==='return'?'stroke-dasharray="6 5"':''} marker-end="url(#arrow)"/></g>`;}).join('');
  const blocks=chosen.map(n=>{const r=measureNode(n);return `<g transform="translate(${r.x} ${r.y})"><rect width="${r.w}" height="${r.h}" rx="9" fill="#192536" stroke="${n.color}"/><text x="17" y="32" fill="${n.color}" font-size="14">ƒ  ${esc(n.name)}()</text><path d="M0 56H${r.w}" stroke="#414956"/>${mode==='code'?canvasLines(n).map((l,i)=>`<text x="14" y="${83+i*24}" fill="#c2cbd7" font-size="10" xml:space="preserve">${String(l.index+1).padStart(2,' ')}  ${esc((l.hiddenCommentAnchor?'注释已隐藏 · 连线锚点':l.hiddenBlankAnchor?'空行 · 连线锚点':l.text).slice(0,51))}</text>`).join(''):`<text x="16" y="81" font-size="11" fill="#a6b1c0">${esc(n.description.slice(0,25))}</text>`}<text x="16" y="${r.h-39}" font-size="10" fill="${n.color}">${esc(n.tags.join(' · ').slice(0,45))}</text><text x="16" y="${r.h-12}" font-size="9" fill="#8f9cae">${esc((n.note?'▤ '+n.note.split('\n')[0]:'无备注').slice(0,40))}</text></g>`;}).join('');
  const groupShapes=(doc.groups||[]).filter(g=>g.members.some(id=>ids.has(id))).map(g=>{const r=groupBounds(g);return `<g><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="14" fill="${g.color}" fill-opacity=".03" stroke="${g.color}" stroke-opacity=".5" stroke-dasharray="6 5"/><text x="${r.x+15}" y="${r.y+22}" fill="${g.color}" font-size="11">${esc(g.name)}</text></g>`;}).join('');
  download(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX-minX} ${maxY-minY}" width="${maxX-minX}" height="${maxY-minY}" style="background:#0c1220;font-family:Consolas,'Microsoft YaHei',monospace"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="#71c9ef"/></marker></defs><rect x="${minX}" y="${minY}" width="${maxX-minX}" height="${maxY-minY}" fill="#0c1220"/><text x="${minX+30}" y="${minY+35}" fill="#e5edf8" font-size="16">${esc(doc.title)} · ${mode==='logic'?'逻辑模式':'代码模式'}</text>${groupShapes}${paths}${blocks}</svg>`,'image/svg+xml;charset=utf-8','svg');toast('当前视图已导出为 SVG');
}

// Application controls
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
$('comments-btn').addEventListener('click',()=>{showComments=!showComments;try{localStorage.setItem('callpath.show-comments',String(showComments));}catch{}renderNodes();renderGroups();drawEdges();$('comments-btn').textContent=showComments?'隐藏注释':'显示注释';$('comments-btn').setAttribute('aria-pressed',String(showComments));$('comments-btn').classList.toggle('active',showComments);});
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
$('click-connect-btn').addEventListener('click',()=>{pointConnect=!pointConnect;if(pointConnect){tool='call';pending=null;$('click-connect-btn').classList.add('active');document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));renderNodes();updateToolHint();toast('点选连线：依次点击两个端点，可连续连接；Esc 退出');}else setTool('select');});
for(const id of ['add-btn','add-sidebar','empty-add'])$(id).addEventListener('click',addNode);
$('add-kind-btn').addEventListener('click',()=>$('add-kind-menu').hidden=!$('add-kind-menu').hidden);
document.querySelectorAll('[data-add-kind]').forEach(b=>b.addEventListener('click',()=>{$('add-kind-menu').hidden=true;addNode(b.dataset.addKind);}));
document.addEventListener('click',e=>{if(!e.target.closest('#add-kind-btn,#add-kind-menu'))$('add-kind-menu').hidden=true;});
const mobileLayout=matchMedia('(max-width:900px)');
function mobileSidebar(open){
  const app=document.querySelector('.app');app.classList.toggle('mobile-sidebar-open',open);
  $('sidebar-backdrop').hidden=!open;$('mobile-files').setAttribute('aria-expanded',String(open));
  $('toggle-sidebar').setAttribute('aria-expanded',String(open));
  $('file-sidebar').inert=mobileLayout.matches&&!open;
  document.querySelector('.main').inert=open;document.querySelector('.topbar').inert=open;
  if(open)$('toggle-sidebar').focus({preventScroll:true});else if(mobileLayout.matches)$('mobile-files').focus({preventScroll:true});
}
function toggleSidebar(collapsed){document.querySelector('.app').classList.toggle('sidebar-collapsed',collapsed);$('toggle-sidebar').textContent=mobileLayout.matches?'×':collapsed?'›':'‹';$('toggle-sidebar').setAttribute('aria-expanded',String(mobileLayout.matches?document.querySelector('.app').classList.contains('mobile-sidebar-open'):!collapsed));$('toggle-sidebar').title=mobileLayout.matches?'关闭文件与标签':collapsed?'展开文件树':'收起文件树';try{localStorage.setItem('callpath.sidebar-collapsed',String(collapsed));}catch{}}
$('toggle-sidebar').addEventListener('click',()=>{if(mobileLayout.matches)mobileSidebar(false);else toggleSidebar(!document.querySelector('.app').classList.contains('sidebar-collapsed'));});
$('mobile-files').addEventListener('click',()=>mobileSidebar(true));
$('sidebar-backdrop').addEventListener('click',()=>mobileSidebar(false));
document.addEventListener('keydown',event=>{
  if(!document.querySelector('.app').classList.contains('mobile-sidebar-open'))return;
  if(event.key==='Escape'){event.preventDefault();mobileSidebar(false);}
  if(event.key==='Tab'){
    const focusable=[...$('file-sidebar').querySelectorAll('button:not(:disabled),input,summary,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden]'));
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
mobileLayout.addEventListener('change',()=>{mobileSidebar(false);toggleSidebar(document.querySelector('.app').classList.contains('sidebar-collapsed'));});
$('file-sidebar').inert=mobileLayout.matches;
try{toggleSidebar(localStorage.getItem('callpath.sidebar-collapsed')==='true');}catch{}
$('group-btn').addEventListener('click',addGroup);
$('projects-btn').addEventListener('click',()=>{finishKeyMotion();stashProject();renderProjectManager();$('projects-dialog').showModal();});
$('edit-selection').addEventListener('click',()=>{if(selected){renderInspector();openInspector();}});
$('load-demo').addEventListener('click',()=>{commit(()=>{doc=createDemo();selected=null;multi.clear();tags=[];search='';trace=null;pending=null;tool='select';$('search').value='';});fit();toast('已载入示例，可撤销恢复原来的项目');});
$('snap-btn').addEventListener('click',()=>{snap=!snap;$('snap-btn').classList.toggle('active',snap);$('snap-btn').setAttribute('aria-pressed',String(snap));toast(snap?'已启用 20 px 网格吸附':'已关闭网格吸附，可自由移动');});
$('undo-btn').addEventListener('click',undo);$('redo-btn').addEventListener('click',redo);
$('fit-btn').addEventListener('click',fit);$('zoom-in').addEventListener('click',()=>zoom(1.2));$('zoom-out').addEventListener('click',()=>zoom(1/1.2));$('zoom-value').addEventListener('click',()=>zoom(1/camera().z));
$('search').addEventListener('input',e=>{search=e.target.value;renderSidebar();renderNodes();drawEdges();});
$('tag-match').addEventListener('click',()=>{matchAll=!matchAll;render();});
$('clear-filter').addEventListener('click',()=>{search='';tags=[];trace=null;$('search').value='';render();});
$('tag-list').addEventListener('click',e=>{const b=e.target.closest('[data-filter-tag]');if(!b)return;const t=b.dataset.filterTag;tags=tags.includes(t)?tags.filter(v=>v!==t):[...tags,t];tagEditing=!readOnly&&tags.length===1;render();});
$('tag-edit-btn').addEventListener('click',()=>{tagEditing=!tagEditing;renderSidebar();});
$('exit-tag-assignment').addEventListener('click',()=>{tagEditing=false;renderSidebar();});
$('function-list').addEventListener('click',e=>{if(performance.now()<treeDragUntil)return;const b=e.target.closest('[data-list-node]');if(b){if(mobileLayout.matches){mobileSidebar(false);camera().z=Math.max(camera().z,1);}if(b.dataset.listLine)setMode('code');jumpToNode(b.dataset.listNode,b.dataset.listLine||null);}});
$('function-list').addEventListener('toggle',e=>{const key=e.target.dataset.treeKey;if(!key)return;if(e.target.open)closedTree.delete(key);else closedTree.add(key);},true);
const TREE_MIME='application/x-callpath-node';
function treePayload(event){try{const data=JSON.parse(event.dataTransfer.getData(TREE_MIME));return data.projectId===workspace.activeId&&nodeBy(data.nodeId)?data:null;}catch{return null;}}
function clearDropHints(){document.querySelectorAll('.file-drop-target,.canvas-drop-target').forEach(el=>el.classList.remove('file-drop-target','canvas-drop-target'));}
$('function-list').addEventListener('dragstart',e=>{const button=e.target.closest('[data-list-node]');if(!button)return;finishKeyMotion();e.dataTransfer.effectAllowed='move';e.dataTransfer.setData(TREE_MIME,JSON.stringify({projectId:workspace.activeId,nodeId:button.dataset.listNode}));e.dataTransfer.setData('text/plain',nodeBy(button.dataset.listNode).name);});
$('function-list').addEventListener('dragover',e=>{if(!e.dataTransfer.types.includes(TREE_MIME))return;const file=e.target.closest('.tree-file')?.querySelector('[data-file-path]');if(file){e.preventDefault();e.dataTransfer.dropEffect='move';clearDropHints();file.classList.add('file-drop-target');}});
$('function-list').addEventListener('drop',e=>{const data=treePayload(e),file=e.target.closest('.tree-file')?.querySelector('[data-file-path]');clearDropHints();if(!data||!file)return;e.preventDefault();treeDragUntil=performance.now()+200;const path=file.dataset.filePath,n=nodeBy(data.nodeId);if((n.file||'')===path)return;commit(()=>{n.file=path;selected={type:'node',id:n.id};});toast('已移到 '+(path||'未指定文件')+'，原有连线保留');});
document.addEventListener('dragend',()=>{treeDragUntil=performance.now()+150;clearDropHints();});
$('viewport').addEventListener('dragover',e=>{if(!e.dataTransfer.types.includes(TREE_MIME))return;e.preventDefault();e.dataTransfer.dropEffect='move';$('viewport').classList.add('canvas-drop-target');});
$('viewport').addEventListener('dragleave',e=>{if(!$('viewport').contains(e.relatedTarget))$('viewport').classList.remove('canvas-drop-target');});
$('viewport').addEventListener('drop',e=>{const data=treePayload(e);clearDropHints();if(!data)return;e.preventDefault();const r=$('viewport').getBoundingClientRect(),c=camera(),n=nodeBy(data.nodeId),position={x:snapValue((e.clientX-r.left-c.x)/c.z),y:snapValue((e.clientY-r.top-c.y)/c.z)};commit(()=>{setBlockPosition(n,position);selected={type:'node',id:n.id};});toast('已摆放 '+n.name+'，原有连线保留');});
$('project-title').addEventListener('change',e=>{const title=e.target.value.trim();if(title&&title!==doc.title)commit(()=>doc.title=title);else e.target.value=doc.title;});
for(const id of ['help-btn'])$(id).addEventListener('click',()=>$('help-dialog').showModal());
for(const id of ['close-help','start-btn'])$(id).addEventListener('click',()=>$('help-dialog').close());
$('export-btn').addEventListener('click',()=>$('export-dialog').showModal());$('close-export').addEventListener('click',()=>$('export-dialog').close());
$('download-json').addEventListener('click',()=>{download(JSON.stringify(doc,null,2),'application/json;charset=utf-8','json');$('export-dialog').close();toast('项目已导出为 JSON');});
$('download-svg').addEventListener('click',()=>{exportSvg();$('export-dialog').close();});
$('import-btn').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>5*1024*1024)throw Error('项目文件不能超过 5 MB');const incoming=validateDocument(JSON.parse(await file.text()));commit(()=>{doc=incoming;selected=doc.nodes.length?{type:'node',id:doc.nodes[0].id}:null;pending=null;trace=null;tags=[];search='';$('search').value='';});fit();toast('项目已导入；可以撤销恢复导入前的内容');}catch(err){toast(err.message||'无法导入项目文件');}finally{e.target.value='';}});

// Delegated node / edge interactions
$('nodes').addEventListener('click',e=>{
  if(suppressClick)return;
  const nEl=e.target.closest('[data-node]');if(!nEl)return;const id=nEl.dataset.node;
  const row=e.target.closest('[data-line]'),line=row?.dataset.line||null;
  const entry=e.target.closest('[data-inner-entry]');if(entry){e.stopPropagation();connect(entry.dataset.innerEntry,entry.dataset.innerLine,entry.dataset.innerId);return;}
  const entryJump=e.target.closest('[data-entry-jump]');if(entryJump){if(pending||tool!=='select'){const model=nestedEntries(nEl?nodeBy(id):null).find(entry=>entry.lineId===entryJump.dataset.entryLine);connect(id,model?.lineId,model?.id);}else{setMode('code');jumpToNode(entryJump.dataset.entryJump,entryJump.dataset.entryLine);}return;}
  if(e.ctrlKey||e.metaKey){const link=e.target.closest('[data-jump-nodes]');if(link){const targets=JSON.parse(link.dataset.jumpNodes);if(targets.length===1)jumpToNode(targets[0],link.dataset.jumpLine||null);else if(targets.length>1)showJumpTargets(targets);else toast('尚未创建 '+link.dataset.functionName+' 的函数块');}else if(e.target.closest('.node-header'))jumpToNode(id);return;}
  if(pending||tool!=='select'){e.stopPropagation();connect(id,line);return;}
  if(e.target.closest('[data-edit-node]')){select('node',id);return;}
  if(e.shiftKey){if(multi.has(id))multi.delete(id);else{if(selected?.type==='node')multi.add(selected.id);multi.add(id);}renderNodes();$('group-btn').textContent=multi.size?`▧ 分区 (${multi.size})`:'▧ 分区';return;}
  const note=e.target.closest('[data-note]');if(note){e.stopPropagation();const n=nodeBy(id);if(!n.note){select('node',id);$('node-form')?.elements.note.focus();return;}if(openNotes.has(id))openNotes.delete(id);else openNotes.add(id);renderNodes();renderGroups();drawEdges();return;}
  if(e.target.closest('[data-line-port]')){connect(id,line);return;}
  if(pending||tool!=='select'){connect(id,line);return;}
  if(e.target.closest('[data-port]')){connect(id);return;}
  select('node',id,false);
});
$('edges').addEventListener('click',e=>{if(suppressClick)return;const edge=e.target.closest('[data-edge]');if(edge){if(e.ctrlKey||e.metaKey){const model=edgeBy(edge.dataset.edge);jumpToNode(model.to,model.toLine);}else if(!pending&&tool==='select')select('edge',edge.dataset.edge);}});
$('nodes').addEventListener('dblclick',e=>{if(pending||tool!=='select'||performance.now()-lastConnectionAt<450)return;const n=e.target.closest('[data-node]');if(!n||e.ctrlKey||e.metaKey||e.target.closest('[data-note],[data-port],[data-line-port],[data-inner-entry],[data-entry-jump]'))return;const id=n.dataset.node;if(tagEditing&&tags.length===1){const tag=tags[0],node=nodeBy(id);if(node.tags.includes(tag)){toast(node.name+' 已属于「'+tag+'」');return;}try{if(node.tags.length>=20)throw Error('一个函数最多支持 20 个标签');commit(()=>{assignNodeTag(doc,id,tag);selected={type:'node',id};});toast('已将 '+node.name+' 加入「'+tag+'」');}catch(err){toast(err.message);}return;}select('node',id);});
$('edges').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const edge=e.target.closest('[data-edge]');if(edge){e.preventDefault();select('edge',edge.dataset.edge);}}});
$('inspector').addEventListener('cancel',()=>{selected=null;renderSidebar();renderNodes();drawEdges();});
$('inspector').addEventListener('submit',event=>{if(readOnly){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
dismissOnBackdrop($('inspector'),()=>{selected=null;render();});
$('groups').addEventListener('click',e=>{if(suppressClick)return;const g=e.target.closest('[data-group]');if(g)select('group',g.dataset.group,!!e.target.closest('[data-edit-group]'));});
$('groups').addEventListener('dblclick',e=>{const g=e.target.closest('[data-group]');if(g)select('group',g.dataset.group);});
$('viewport').addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('.canvas-tools,.zoom-controls,.connection-hint,.filter-indicator,.canvas-empty'))return;
  const n=e.target.closest('[data-node]');
  const group=e.target.closest('[data-group]');
  const touchPan=e.pointerType==='touch'&&tool==='select'&&!pending&&!e.target.closest('button')&&((n&&(readOnly||!e.target.closest('.node-header')))||(group&&(readOnly||!e.target.closest('.group-header')))||e.target.closest('[data-edge]'));
  if(touchPan){drag={type:'pan',startX:e.clientX,startY:e.clientY,original:{x:camera().x,y:camera().y},moved:false};}
  else if(n){if(readOnly||e.ctrlKey||e.metaKey||e.shiftKey||tool!=='select'||pending||!e.target.closest('.node-header')||e.target.closest('[data-edit-node]'))return;const model=nodeBy(n.dataset.node);drag={type:'node',id:model.id,startX:e.clientX,startY:e.clientY,original:{...model.positions[mode]},before:clone(doc),moved:false};}
  else if(group){if(readOnly||!e.target.closest('.group-header')||e.target.closest('[data-edit-group]'))return;const g=groupBy(group.dataset.group);drag={type:'group',id:g.id,startX:e.clientX,startY:e.clientY,original:clone(g.positions[mode]),originalMembers:g.members.map(id=>({id,position:{...nodeBy(id).positions[mode]}})),before:clone(doc),moved:false};}
  else if(!e.target.closest('[data-edge]')){drag={type:'pan',startX:e.clientX,startY:e.clientY,original:{x:camera().x,y:camera().y},moved:false};}
  if(drag){drag.pointerId=e.pointerId;e.preventDefault();window.getSelection()?.removeAllRanges();$('viewport').focus({preventScroll:true});}
});
$('viewport').addEventListener('pointermove',e=>{
  if(!drag||drag.pointerId!==e.pointerId)return;const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;if(!drag.moved)return;if(!$('viewport').hasPointerCapture(e.pointerId)){$('viewport').setPointerCapture(e.pointerId);$('viewport').classList.add('panning');}
  if(drag.type==='pan'){camera().x=drag.original.x+dx;camera().y=drag.original.y+dy;applyCamera();}
  else if(drag.type==='node'){const n=nodeBy(drag.id);setBlockPosition(n,{x:snapValue(drag.original.x+dx/camera().z),y:snapValue(drag.original.y+dy/camera().z)});const el=nodeElement(n.id);el.style.left=n.positions[mode].x+'px';el.style.top=n.positions[mode].y+'px';el.querySelector('.node-coordinates').textContent=`X ${n.positions[mode].x} · Y ${n.positions[mode].y}`;cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(()=>{renderGroups();drawEdges();});}
  else{const gx=snapValue(dx/camera().z),gy=snapValue(dy/camera().z),g=groupBy(drag.id);setBlockPosition(g,{x:drag.original.x+gx,y:drag.original.y+gy});for(const m of drag.originalMembers){setBlockPosition(nodeBy(m.id),{x:m.position.x+gx,y:m.position.y+gy});const el=nodeElement(m.id);el.style.left=nodeBy(m.id).positions[mode].x+'px';el.style.top=nodeBy(m.id).positions[mode].y+'px';el.querySelector('.node-coordinates').textContent=`X ${Math.round(nodeBy(m.id).positions[mode].x)} · Y ${Math.round(nodeBy(m.id).positions[mode].y)}`;}cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(()=>{renderGroups();drawEdges();});}
});
function endDrag(e){if(!drag||drag.pointerId!==e.pointerId)return;const d=drag;drag=null;$('viewport').classList.remove('panning');if($('viewport').hasPointerCapture(e.pointerId))$('viewport').releasePointerCapture(e.pointerId);if(d.moved){suppressClick=true;setTimeout(()=>suppressClick=false,50);if(d.type!=='pan'){history.push(d.before);if(history.length>60)history.shift();future=[];$('undo-btn').disabled=false;$('redo-btn').disabled=true;if(d.type==='node'&&selected?.type==='node'&&selected.id===d.id){const form=$('node-form');if(form){form.elements.posX.value=Math.round(nodeBy(d.id).positions[mode].x);form.elements.posY.value=Math.round(nodeBy(d.id).positions[mode].y);}}}save();}else if(e.type==='pointercancel'){return;}else if(d.type==='pan'&&!pending&&tool==='select'){selected=null;multi.clear();render();}else if(d.type==='node'||d.type==='group'){select(d.type,d.id,false);}}
$('viewport').addEventListener('pointerup',endDrag);$('viewport').addEventListener('pointercancel',endDrag);
installPinchNavigation($('viewport'),{
  getCamera:camera,paint:applyCamera,save,
  beforePinch(){finishKeyMotion();if(drag)endDrag({pointerId:drag.pointerId,type:'pointercancel'});},
  suppressClick(){suppressClick=true;setTimeout(()=>suppressClick=false,450);}
});
$('viewport').addEventListener('wheel',e=>{if(e.target.closest('.inspector'))return;e.preventDefault();const r=$('viewport').getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0013),{x:e.clientX-r.left,y:e.clientY-r.top});},{passive:false});
function keyPositions(subject){if(subject.type==='pan')return [camera()];if(subject.type==='node')return [nodeBy(subject.id).positions[mode]];const g=groupBy(subject.id);return [g.positions[mode],...g.members.map(id=>nodeBy(id).positions[mode])];}
function paintKeyMotion(){if(!keyMotion)return;if(keyMotion.subject.type==='pan'){applyCamera();return;}const group=keyMotion.subject.type==='group'?groupBy(keyMotion.subject.id):null;if(group)setBlockPosition(group,group.positions[mode]);const ids=group?group.members:[keyMotion.subject.id];for(const id of ids){const n=nodeBy(id),el=nodeElement(id);setBlockPosition(n,n.positions[mode]);if(!el)continue;const p=n.positions[mode];el.style.left=p.x+'px';el.style.top=p.y+'px';el.querySelector('.node-coordinates').textContent=`X ${Math.round(p.x)} · Y ${Math.round(p.y)}`;}renderGroups();drawEdges();}
function finishKeyMotion(){
  cancelAnimationFrame(keyFrame);keyFrame=0;heldArrows.clear();if(!keyMotion)return;const m=keyMotion;keyMotion=null;
  if(m.moved&&m.subject.type!=='pan'){history.push(m.before);if(history.length>60)history.shift();future=[];$('undo-btn').disabled=false;$('redo-btn').disabled=true;const form=$('node-form');if(m.subject.type==='node'&&selected?.id===m.subject.id&&form){form.elements.posX.value=Math.round(nodeBy(m.subject.id).positions[mode].x);form.elements.posY.value=Math.round(nodeBy(m.subject.id).positions[mode].y);}}
  save();
}
function beginKeyMotion(e){
  if(!keyMotion){const subject=!readOnly&&selected&&['node','group'].includes(selected.type)?{...selected}:{type:'pan'};const positions=keyPositions(subject);keyMotion={subject,before:subject.type==='pan'?null:clone(doc),initial:positions.map(p=>({x:p.x,y:p.y})),started:performance.now(),last:performance.now(),vx:0,vy:0,moved:false,boost:e.shiftKey,settle:null};}
  keyMotion.boost=e.shiftKey;keyMotion.direction={x:e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0,y:e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0};keyMotion.settle=null;heldArrows.add(e.key);if(!keyFrame)keyFrame=requestAnimationFrame(animateKeyMotion);
}
function animateKeyMotion(now){
  keyFrame=0;const m=keyMotion;if(!m)return;const dt=Math.min(.04,Math.max(.001,(now-m.last)/1000));m.last=now;const positions=keyPositions(m.subject),pan=m.subject.type==='pan';
  if(m.settle){m.settle.elapsed+=dt;const t=Math.min(1,m.settle.elapsed/.14),ease=1-Math.pow(1-t,3);positions.forEach((p,i)=>{p.x=m.settle.from[i].x+(m.settle.to[i].x-m.settle.from[i].x)*ease;p.y=m.settle.from[i].y+(m.settle.to[i].y-m.settle.from[i].y)*ease;});m.moved=true;paintKeyMotion();if(t>=1){finishKeyMotion();return;}}
  else{
    let dx=(heldArrows.has('ArrowRight')?1:0)-(heldArrows.has('ArrowLeft')?1:0),dy=(heldArrows.has('ArrowDown')?1:0)-(heldArrows.has('ArrowUp')?1:0);if(dx&&dy){dx/=Math.SQRT2;dy/=Math.SQRT2;}
    const speed=(pan?470:230/camera().z)*(m.boost?2.5:1),smooth=1-Math.exp(-dt*(heldArrows.size?16:25));m.vx+=(dx*speed-m.vx)*smooth;m.vy+=(dy*speed-m.vy)*smooth;
    for(const p of positions){p.x+=m.vx*dt*(pan?-1:1);p.y+=m.vy*dt*(pan?-1:1);if(!pan){p.x=Math.max(-100000,Math.min(100000,p.x));p.y=Math.max(-100000,Math.min(100000,p.y));}}
    if(Math.abs(m.vx)+Math.abs(m.vy)>.3)m.moved=true;paintKeyMotion();
    if(!heldArrows.size&&Math.abs(m.vx)+Math.abs(m.vy)<3){if(!pan&&snap){const source=positions.map(p=>({...p}));m.settle={from:source,to:source.map(p=>({x:Math.round(p.x/20)*20,y:Math.round(p.y/20)*20})),elapsed:0};}else{finishKeyMotion();return;}}
  }
  keyFrame=requestAnimationFrame(animateKeyMotion);
}
document.addEventListener('keyup',e=>{
  if(e.key==='Control'||e.key==='Meta')$('viewport').classList.remove('ctrl-held');
  if(!keyMotion)return;if(e.key==='Shift')keyMotion.boost=false;if(!heldArrows.has(e.key))return;heldArrows.delete(e.key);
  if(!heldArrows.size&&performance.now()-keyMotion.started<130){const m=keyMotion,positions=keyPositions(m.subject),pan=m.subject.type==='pan',step=(pan?40:snap?20:10)*(m.boost?3:1),dir=m.direction;m.settle={from:positions.map(p=>({...p})),to:m.initial.map(p=>({x:p.x+dir.x*step*(pan?-1:1),y:p.y+dir.y*step*(pan?-1:1)})),elapsed:0};if(!keyFrame)keyFrame=requestAnimationFrame(animateKeyMotion);}
});
window.addEventListener('blur',()=>{finishKeyMotion();$('viewport').classList.remove('ctrl-held');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)finishKeyMotion();});
document.addEventListener('keydown',e=>{
  if($('share-dialog').open)return;
  if(e.key==='Control'||e.key==='Meta')$('viewport').classList.add('ctrl-held');
  const editable=e.target.closest('input,textarea,select,[contenteditable=true]');
  if($('inspector').open&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('inspector').querySelector('form')?.requestSubmit();return;}
  if(e.key==='Escape'){if(pending||tool!=='select'){setTool('select');return;}if(!$('help-dialog').open&&!$('export-dialog').open&&!editable){selected=null;render();}return;}
  if(editable||$('account-dialog').open||$('inspector').open||$('projects-dialog').open||$('jump-dialog').open||$('help-dialog').open||$('export-dialog').open)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();beginKeyMotion(e);return;}
  if(e.key==='Shift'&&keyMotion)keyMotion.boost=true;
  if(e.key==='Enter'&&selected){e.preventDefault();renderInspector();openInspector();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='/'){e.preventDefault();$('search').focus();}
  if(e.key.toLowerCase()==='v')setTool('select');if(e.key.toLowerCase()==='c')setTool('call');if(e.key.toLowerCase()==='r')setTool('return');if(e.key.toLowerCase()==='f')fit();
  if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();$('delete-selection')?.click();}
});
let resizeTimer,viewportSize={w:$('viewport').clientWidth,h:$('viewport').clientHeight};
new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{
  const w=$('viewport').clientWidth,h=$('viewport').clientHeight;
  if(viewportSize.w&&viewportSize.h){camera().x+=(w-viewportSize.w)/2;camera().y+=(h-viewportSize.h)/2;applyCamera();}
  viewportSize={w,h};drawEdges();
},120);}).observe($('viewport'));
window.addEventListener('beforeunload',()=>{if(!account.remote||saveTimer)saveNow();},{capture:true});
cloudSync=readOnly?mountSharedView(account):mountAccount(account,{getWorkspace:()=>{saveNow();return workspace;},importWorkspace:importWorkspaceProjects,importLocal:()=>{
  const raw=localStorage.getItem(WORKSPACE),legacy=localStorage.getItem(STORAGE);
  if(!raw&&!legacy)throw Error('此浏览器没有旧的本地项目；可使用 JSON 备份导入');
  importWorkspaceProjects(raw?validateWorkspace(JSON.parse(raw)):createWorkspace(validateDocument(JSON.parse(legacy))));
}});
mountSharing(account,{getProject:()=>{finishKeyMotion();stashProject();return {id:workspace.activeId,title:doc.title};},prepare:async()=>{finishKeyMotion();saveNow();if(!cloudSync||!await cloudSync.flush())throw Error('请先完成同步或解决版本冲突，再分享项目');return cloudSync.revision;}});
render();
if(!hadSavedView||mobileLayout.matches){requestAnimationFrame(fit);}else applyCamera();
if(storageFailed)toast('未能读取上次保存的数据，已打开示例。请保留原有备份。');
