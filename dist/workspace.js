import {uid,clone,validateDocument} from './model.js';
const titleOf=value=>{const title=String(value||'').trim();if(!title||title.length>80)throw Error('项目名称需要 1–80 个字符');return title;};
export function emptyProject(title){return {schemaVersion:1,title:titleOf(title),nodes:[],edges:[],groups:[]};}
export function createWorkspace(document){const id=uid('project');return {schemaVersion:1,activeId:id,projects:[{id,document:clone(document),updatedAt:Date.now()}],trash:[]};}
export function validateWorkspace(value){
  if(!value||value.schemaVersion!==1||!Array.isArray(value.projects)||!value.projects.length||value.projects.length>100||!Array.isArray(value.trash))throw Error('工作空间格式不正确');
  const ws=clone(value),ids=new Set();for(const p of [...ws.projects,...ws.trash]){if(typeof p.id!=='string'||!p.id||ids.has(p.id))throw Error('项目标识重复或无效');ids.add(p.id);p.document=validateDocument(p.document,p.view?.mode);if(!Number.isFinite(p.updatedAt))p.updatedAt=Date.now();if(p.view){const v=p.view;if(!['logic','code'].includes(v.mode))delete p.view;else for(const mode of ['logic','code'])if(!['x','y','z'].every(k=>Number.isFinite(v.cameras?.[mode]?.[k]))||v.cameras[mode].z<.2||v.cameras[mode].z>2){delete p.view;break;}}}
  if(!ws.projects.some(p=>p.id===ws.activeId))ws.activeId=ws.projects[0].id;return ws;
}
export function addProject(ws,title,document=null){if(ws.projects.length>=100)throw Error('Demo 最多支持 100 个项目');const p={id:uid('project'),document:document?validateDocument(document):emptyProject(title),updatedAt:Date.now()};ws.projects.push(p);ws.activeId=p.id;return p;}
export function renameProject(ws,id,title){const p=ws.projects.find(p=>p.id===id);if(!p)throw Error('项目不存在');p.document.title=titleOf(title);p.updatedAt=Date.now();return p;}
export function softDeleteProject(ws,id){const index=ws.projects.findIndex(p=>p.id===id);if(index<0)throw Error('项目不存在');const [p]=ws.projects.splice(index,1);ws.trash.unshift({...p,deletedAt:Date.now()});if(!ws.projects.length)addProject(ws,'新项目');if(ws.activeId===id)ws.activeId=ws.projects[0].id;return p;}
export function restoreProject(ws,id){if(ws.projects.length>=100)throw Error('项目数量已达上限');const index=ws.trash.findIndex(p=>p.id===id);if(index<0)throw Error('未找到已删除项目');const [p]=ws.trash.splice(index,1);delete p.deletedAt;ws.projects.push(p);return p;}
export function buildFileTree(nodes){
  const root={name:'',path:'',type:'directory',children:[]};
  for(const node of nodes){const path=String(node.file||'').trim().replace(/\\/g,'/').replace(/\/+/g,'/'),parts=(path||'未指定文件').split('/').filter(Boolean);if(!parts.length)parts.push('未指定文件');let current=root,partial='';for(let i=0;i<parts.length;i++){partial+=(partial?'/':'')+parts[i];const type=i===parts.length-1?'file':'directory';let child=current.children.find(c=>c.name===parts[i]&&c.type===type);if(!child){child={name:parts[i],path:partial,type,children:[],nodes:[]};current.children.push(child);}if(type==='file')child.nodes.push(node);else current=child;}}
  const sort=branch=>{branch.children.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name,'zh-CN',{numeric:true}):a.type==='directory'?-1:1);branch.children.forEach(sort);};sort(root);return root.children;
}
