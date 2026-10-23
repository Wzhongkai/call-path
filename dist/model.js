import {LANGUAGES} from './highlight.js';
export const COLORS = ['#71c9ef','#8aaef0','#b5a1e7','#d9b581','#df9eac','#80cbbd'];
export const uid = (prefix = 'id') => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
export const clone = value => JSON.parse(JSON.stringify(value));
// Keep the v1 JSON shape for existing clients, with one layout in both slots.
export function setBlockPosition(block,position){
  for(const mode of ['logic','code'])Object.assign(block.positions[mode],{x:position.x,y:position.y});
}
export function unifyLayout(doc,preferredMode='logic'){
  for(const block of [...doc.nodes,...(doc.groups||[])])setBlockPosition(block,block.positions[preferredMode==='code'?'code':'logic']);
  return doc;
}
const lines = (id, code) => code.split('\n').map((text, i) => ({id:`${id}_l${i+1}`,text}));
export function createDemo() {
  const nodes = [
    {id:'login',name:'handleLogin',description:'登录流程入口，串联校验与认证',tags:['入口','认证'],note:'先校验输入，再查询用户。只有身份验证通过才签发 token。\n可以沿着青蓝色调用线，追踪一次完整的登录过程。',color:COLORS[0],positions:{logic:{x:50,y:180},code:{x:40,y:170}},code:lines('login',`async function handleLogin(input) {\n  const data = validateInput(input);\n  const user = await findUser(data.email);\n  const ok = verifyPassword(data, user);\n  if (!ok) throw Error('认证失败');\n  const token = createToken(user);\n  return { user, token };\n}`)},
    {id:'validate',name:'validateInput',description:'检查邮箱与密码格式',tags:['校验','认证'],note:'输入不合法时抛出异常，后续调用不再继续。',color:COLORS[1],positions:{logic:{x:440,y:90},code:{x:550,y:70}},code:lines('validate',`function validateInput(input) {\n  if (!input.email || !input.password) {\n    throw Error('请填写邮箱和密码');\n  }\n  return input;\n}`)},
    {id:'find',name:'findUser',description:'通过邮箱查找用户记录',tags:['数据','认证'],note:'未找到用户时，应该返回统一的认证错误，避免泄露账号是否存在。',color:COLORS[2],positions:{logic:{x:440,y:340},code:{x:550,y:410}},code:lines('find',`async function findUser(email) {\n  const user = await db.find(email);\n  if (!user) throw Error('认证失败');\n  return user;\n}`)},
    {id:'verify',name:'verifyPassword',description:'比对输入密码与已存储的哈希',tags:['校验','认证'],note:'这里只是展示调用关系，示例代码不会被执行。真实密码比对应使用经过验证的密码哈希库。',color:COLORS[3],positions:{logic:{x:830,y:90},code:{x:1060,y:70}},code:lines('verify',`function verifyPassword(data, user) {\n  return hash.compare(\n    data.password, user.passwordHash\n  );\n}`)},
    {id:'token',name:'createToken',description:'为认证通过的用户签发凭证',tags:['认证','返回'],note:'只把必要的用户标识放入载荷，并设置过期时间。',color:COLORS[5],positions:{logic:{x:830,y:340},code:{x:1060,y:410}},code:lines('token',`function createToken(user) {\n  return jwt.sign(\n    { sub: user.id }, secret,\n    { expiresIn: '2h' }\n  );\n}`)}
  ];
  const edges=[
    {id:'call1',type:'call',from:'login',to:'validate',fromLine:'login_l2',toLine:null,label:'01 · 校验输入',params:'input',condition:'',note:'检查必填字段和输入格式。'},
    {id:'ret1',type:'return',callId:'call1',from:'validate',to:'login',fromLine:'validate_l5',toLine:'login_l2',label:'data',params:'经过校验的表单数据',condition:'',note:''},
    {id:'call2',type:'call',from:'login',to:'find',fromLine:'login_l3',toLine:null,label:'02 · 查询用户',params:'data.email',condition:'校验通过',note:''},
    {id:'call3',type:'call',from:'login',to:'verify',fromLine:'login_l4',toLine:null,label:'03 · 验证密码',params:'data, user',condition:'用户存在',note:''},
    {id:'call4',type:'call',from:'login',to:'token',fromLine:'login_l6',toLine:null,label:'04 · 签发凭证',params:'user',condition:'ok === true',note:''},
    {id:'ret4',type:'return',callId:'call4',from:'token',to:'login',fromLine:'token_l2',toLine:'login_l6',label:'token',params:'登录凭证',condition:'',note:''}
  ];
  const files={login:'src/auth/login.ts',validate:'src/auth/validators.ts',find:'src/repositories/user.ts',verify:'src/auth/validators.ts',token:'src/auth/token.ts'};
  for(const n of nodes){n.file=files[n.id];n.language='typescript';if(['find','token'].includes(n.id))n.positions.code.y=480;}
  const groups=[
    {id:'zone-check',name:'身份校验',note:'检查输入格式，并验证用户身份。',color:COLORS[1],members:['validate','verify'],positions:{logic:{x:400,y:40},code:{x:510,y:20}}},
    {id:'zone-data',name:'数据与凭证',note:'查找用户记录，生成登录凭证。',color:COLORS[5],members:['find','token'],positions:{logic:{x:400,y:290},code:{x:510,y:430}}}
  ];
  return unifyLayout({schemaVersion:1,title:'用户登录 · 调用分析',nodes,edges,groups},'code');
}
// LCS retains identities of unchanged rows when code is inserted or removed.
// Edited rows within the same gap keep their old identity where possible.
export function reconcileLines(oldLines, text) {
  const next = text.replace(/\r\n/g,'\n').split('\n');
  if (next.length > 400) throw Error('单个函数最多支持 400 行代码');
  const n=oldLines.length,m=next.length;
  const dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) dp[i][j]=oldLines[i].text===next[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  const matches=[];let i=0,j=0;
  while(i<n&&j<m){if(oldLines[i].text===next[j]){matches.push([i,j]);i++;j++;}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}
  const result=[];let oi=0,ni=0;
  for(const [o,k] of [...matches,[n,m]]){
    for(let p=ni;p<k;p++)result.push({id:oi+p-ni<o?oldLines[oi+p-ni].id:uid('line'),text:next[p]});
    if(o<n)result.push({id:oldLines[o].id,text:next[k]});
    oi=o+1;ni=k+1;
  }
  return result;
}
export function repairAnchors(doc) {
  let detached=0;
  for(const node of doc.nodes)if(node.innerFunctions)node.innerFunctions=node.innerFunctions.filter(entry=>node.code.some(line=>line.id===entry.lineId));
  for(const edge of doc.edges)for(const end of ['from','to']){
    const node=doc.nodes.find(n=>n.id===edge[end]);
    if(edge[end+'Line'] && !node?.code.some(l=>l.id===edge[end+'Line'])) {edge[end+'Line']=null;detached++;}
    if(edge[end+'Entry']&&!(node?.innerFunctions||[]).some(entry=>entry.id===edge[end+'Entry']&&entry.lineId===edge[end+'Line'])){edge[end+'Entry']=null;detached++;}
  }
  return detached;
}
export function traceNodes(doc,start,direction) {
  const found=new Set([start]);const queue=[start];
  while(queue.length){const current=queue.shift();for(const e of doc.edges){if(e.type!=='call')continue;const source=direction==='upstream'?e.to:e.from,target=direction==='upstream'?e.from:e.to;if(source===current&&!found.has(target)){found.add(target);queue.push(target);}}}
  return found;
}
export function filterNodes(doc,{search='',tags=[],matchAll=false,trace=null}={}) {
  const query=search.trim().toLowerCase();
  const traced=trace?traceNodes(doc,trace.id,trace.direction):null;
  return new Set(doc.nodes.filter(n=>(!query||[n.name,n.file||'',n.description,n.note,...n.tags].join(' ').toLowerCase().includes(query))&&(!tags.length||(matchAll?tags.every(t=>n.tags.includes(t)):tags.some(t=>n.tags.includes(t))))&&(!traced||traced.has(n.id))).map(n=>n.id));
}
export function deleteNode(doc,id){doc.nodes=doc.nodes.filter(n=>n.id!==id);for(const n of doc.nodes)if(n.parentId===id)n.parentId=null;doc.edges=doc.edges.filter(e=>e.from!==id&&e.to!==id);for(const g of doc.groups||[])g.members=g.members.filter(v=>v!==id);}
export function scopePath(doc,node){const path=[node.name],seen=new Set([node.id]);let parent=node.parentId;while(parent&&!seen.has(parent)){seen.add(parent);const n=doc.nodes.find(n=>n.id===parent);if(!n)break;path.unshift(n.name);parent=n.parentId;}return path.join(' / ');}
export function canParent(doc,childId,parentId){const seen=new Set([childId]);let id=parentId;while(id){if(seen.has(id))return false;seen.add(id);id=doc.nodes.find(n=>n.id===id)?.parentId;}return true;}
export function deleteEdge(doc,id){doc.edges=doc.edges.filter(e=>e.id!==id&&e.callId!==id);}
export function assignNodeTag(doc,nodeId,tag){
  tag=String(tag).trim();if(!tag||tag.length>40)throw Error('标签须为 1–40 个字符');
  const node=doc.nodes.find(node=>node.id===nodeId);if(!node)throw Error('函数不存在');
  if(node.tags.includes(tag))return false;
  if(node.tags.length>=20)throw Error('一个函数最多支持 20 个标签');
  node.tags.push(tag);return true;
}
export function validateDocument(value,preferredMode='logic'){
  const fail=()=>{throw Error('不是有效的 Callpath 项目文件：请检查数据结构、函数及连线引用。');};
  if(!value||value.schemaVersion!==1||!Array.isArray(value.nodes)||!Array.isArray(value.edges)||value.nodes.length>200||value.edges.length>1000)fail();
  const doc=clone(value);if(typeof doc.title!=='string'||doc.title.length>80)fail();
  const ids=new Set();
  for(const n of doc.nodes){
    if(typeof n.id!=='string'||!n.id||n.id.length>100||ids.has(n.id)||typeof n.name!=='string'||!n.name.trim()||n.name.length>100||!Array.isArray(n.tags)||n.tags.length>20||n.tags.some(t=>typeof t!=='string'||t.length>40)||!Array.isArray(n.code)||n.code.length<1||n.code.length>400||!/^#[\da-f]{6}$/i.test(n.color))fail();
    ids.add(n.id);
    for(const key of ['note','description'])if(typeof n[key]!=='string'||n[key].length>50000)fail();
    if(n.file!=null&&(typeof n.file!=='string'||n.file.length>500))fail();
    if(n.language!=null&&!Object.hasOwn(LANGUAGES,n.language))fail();
    if(n.kind!=null&&!['function','struct','macro'].includes(n.kind))fail();
    if(n.indentSize!=null&&![2,4,8].includes(n.indentSize))fail();
    if(n.exposeEmbedded!=null&&typeof n.exposeEmbedded!=='boolean')fail();
    const lineIds=new Set();for(const l of n.code){if(typeof l.id!=='string'||!l.id||lineIds.has(l.id)||typeof l.text!=='string'||l.text.length>10000)fail();lineIds.add(l.id);}
    if(n.innerFunctions!=null){if(!Array.isArray(n.innerFunctions)||n.innerFunctions.length>100)fail();const entryIds=new Set(),entryLines=new Set();for(const entry of n.innerFunctions){if(!entry||typeof entry.id!=='string'||!entry.id||entry.id.length>100||entryIds.has(entry.id)||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>100||!lineIds.has(entry.lineId)||entryLines.has(entry.lineId))fail();entryIds.add(entry.id);entryLines.add(entry.lineId);}}
    for(const mode of ['logic','code'])for(const axis of ['x','y'])if(!Number.isFinite(n.positions?.[mode]?.[axis])||Math.abs(n.positions[mode][axis])>100000)fail();
  }
  const edgeIds=new Set();for(const e of doc.edges){if(typeof e.id!=='string'||!e.id||edgeIds.has(e.id)||!ids.has(e.from)||!ids.has(e.to)||!['call','return'].includes(e.type))fail();edgeIds.add(e.id);for(const key of ['label','params','condition','note'])if(typeof e[key]!=='string'||e[key].length>50000)fail();for(const end of ['from','to']){if(e[end+'Line']!=null&&!doc.nodes.find(n=>n.id===e[end]).code.some(l=>l.id===e[end+'Line']))fail();}}
  for(const edge of doc.edges)for(const end of ['from','to'])if(edge[end+'Entry']!=null&&!(doc.nodes.find(node=>node.id===edge[end]).innerFunctions||[]).some(entry=>entry.id===edge[end+'Entry']&&entry.lineId===edge[end+'Line']))fail();
  for(const n of doc.nodes)if(n.parentId!=null&&(!ids.has(n.parentId)||!canParent(doc,n.id,n.parentId)))fail();
  for(const e of doc.edges)if(e.type==='return'&&e.callId){const call=doc.edges.find(c=>c.id===e.callId);if(!call||call.type!=='call'||call.from!==e.to||call.to!==e.from)fail();}
  if(!doc.groups)doc.groups=[];
  if(!Array.isArray(doc.groups)||doc.groups.length>100)fail();
  const groupIds=new Set(),members=new Set();
  for(const g of doc.groups){
    if(typeof g.id!=='string'||!g.id||groupIds.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.length>100||typeof g.note!=='string'||g.note.length>50000||!/^#[\da-f]{6}$/i.test(g.color)||!Array.isArray(g.members)||g.members.some(id=>!ids.has(id)||members.has(id)))fail();
    groupIds.add(g.id);for(const id of g.members){if(members.has(id))fail();members.add(id);}
    for(const mode of ['logic','code'])for(const axis of ['x','y'])if(!Number.isFinite(g.positions?.[mode]?.[axis])||Math.abs(g.positions[mode][axis])>100000)fail();
  }
  return unifyLayout(doc,preferredMode);
}
