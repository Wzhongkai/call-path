import {WorkspaceSync} from './sync.js';
import {validateWorkspace} from './workspace.js';
const $=id=>document.getElementById(id);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let expectedUserId=null;
const API_BASE=new URL('./api',import.meta.url).pathname;
export async function api(path,body,method=body===undefined?'GET':'POST'){
  const response=await fetch(API_BASE+path,{method,credentials:'same-origin',headers:{'X-Callpath-Request':'1',...(expectedUserId?{'X-Callpath-User':expectedUserId}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30_000)});
  const data=await response.json().catch(()=>({error:'服务器响应格式错误'}));
  if(!response.ok){const error=Error(data.error||`请求失败 (${response.status})`);error.status=response.status;throw error;}return data;
}
function dialogContent(html){const dialog=$('account-dialog');dialog.innerHTML=html;if(!dialog.open)dialog.showModal();return dialog;}
const heading=(title,close=false)=>`<div class="dialog-heading"><span class="eyebrow">CALLPATH · 账号</span>${close?'<button id="close-account" class="icon-btn" aria-label="关闭账号">×</button>':''}</div><h2>${title}</h2>`;
function errorText(error){return error.name==='TimeoutError'?'连接超时，请检查服务器后重试':error.message||'连接失败，请检查网络';}
function loginDialog(config,{expectedUser=null}={}){
  return new Promise(resolve=>{
    let register=false;
    const draw=()=>{
      const dialog=dialogContent(heading(expectedUser?'登录已过期，请重新登录':register?'创建账号':'登录 Callpath')+`<p>每个账号独立保存项目、文件和调用链。</p><form id="auth-form" class="account-form"><label>用户名<input name="username" autocomplete="username" pattern="[A-Za-z0-9_-]{3,32}" minlength="3" maxlength="32" placeholder="3–32 位字母、数字、_ 或 -" required ${expectedUser?`value="${escape(expectedUser.username)}" readonly`:''}></label><label>密码<input name="password" type="password" autocomplete="${register?'new-password':'current-password'}" minlength="8" maxlength="128" required></label>${register?'<label>确认密码<input name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>':''}<p id="auth-error" class="account-error" role="alert"></p><button class="button primary" type="submit">${register?'创建账号并进入':'登录'}</button></form>${config.registration&&!expectedUser?`<button id="auth-switch" class="text-btn">${register?'已有账号？去登录':'没有账号？创建账号'}</button>`:!expectedUser?'<p class="account-muted">注册已关闭，请联系站点管理员创建账号。</p>':''}`);
      dialog.oncancel=e=>e.preventDefault();
      dialog.querySelector('#auth-switch')?.addEventListener('click',()=>{register=!register;draw();});
      dialog.querySelector('#auth-form').addEventListener('submit',async event=>{
        event.preventDefault();const form=event.currentTarget,values=new FormData(form),button=form.querySelector('button');
        if(register&&values.get('password')!==values.get('confirm')){form.querySelector('#auth-error').textContent='两次密码不一致';return;}
        button.disabled=true;form.querySelector('#auth-error').textContent='';
        try{const data=await api('/auth/'+(register?'register':'login'),{username:values.get('username'),password:values.get('password')});
          if(expectedUser&&data.user.id!==expectedUser.id)throw Error('账号不匹配，请使用原账号');
          expectedUserId=data.user.id;dialog.oncancel=null;dialog.close();resolve(data.user);
        }catch(error){form.querySelector('#auth-error').textContent=errorText(error);}finally{button.disabled=false;}
      });
    };draw();
  });
}
export async function connectAccount(){
  document.querySelector('.app').inert=true;
  let config;
  while(!config){try{const response=await fetch(API_BASE+'/config',{credentials:'same-origin',signal:AbortSignal.timeout(10_000)});
    if(response.status===404){document.querySelector('.app').inert=false;return {remote:false};}
    if(!response.ok)throw Error('服务器暂时无法连接');config=await response.json();if(config.backend!==true)throw Error('服务器配置响应无效');
  }catch(error){config=null;await new Promise(resolve=>{const dialog=dialogContent(heading('暂时无法连接服务器')+`<p>${escape(errorText(error))}</p><button id="retry-server" class="button primary">重新连接</button>`);dialog.oncancel=e=>e.preventDefault();dialog.querySelector('#retry-server').onclick=()=>{dialog.close();resolve();};});}}
  let user,snapshot;
  while(!snapshot){try{user=(await api('/auth/me')).user;expectedUserId=user.id;snapshot=await api('/workspace');if(snapshot.workspace)snapshot.workspace=validateWorkspace(snapshot.workspace);}
    catch(error){if(error.status===401){user=await loginDialog(config);continue;}
      await new Promise(resolve=>{const dialog=dialogContent(heading('工作空间读取失败')+`<p>${escape(errorText(error))}</p><button id="retry-workspace" class="button primary">重新读取</button>`);dialog.oncancel=e=>e.preventDefault();dialog.querySelector('#retry-workspace').onclick=()=>{dialog.close();resolve();};});}}
  let draft=null,tabId;
  try{tabId=sessionStorage.getItem('callpath.tab-id');if(!tabId){tabId=crypto.randomUUID();sessionStorage.setItem('callpath.tab-id',tabId);}}catch{tabId=crypto.randomUUID();}
  const draftKey='callpath.cloud-draft.'+user.id+'.'+tabId;
  try{const value=JSON.parse(localStorage.getItem(draftKey)||'null');if(value&&Number.isSafeInteger(value.revision)&&value.workspace){draft={revision:value.revision,workspace:validateWorkspace(value.workspace)};}}
  catch{ /* Never overwrite unreadable recovery data during startup. */ }
  $('account-dialog').close();document.querySelector('.app').inert=false;
  return {remote:true,config,user,snapshot,draft,draftKey};
}
export function downloadWorkspace(workspace){const url=URL.createObjectURL(new Blob([JSON.stringify(workspace,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='callpath-workspace-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function mountAccount(account,{getWorkspace,importWorkspace,importLocal}){
  const button=$('account-btn');
  if(!account.remote){button.textContent='本地模式';button.onclick=()=>{const dialog=dialogContent(heading('本地模式',true)+'<p>当前使用静态演示，内容保存在此浏览器。启动 Rust 服务后可使用账号和跨设备保存。</p>');dialog.oncancel=null;dialog.querySelector('#close-account').onclick=()=>dialog.close();};return null;}
  let storage;try{storage=localStorage;}catch{}
  const sync=new WorkspaceSync({revision:account.snapshot.revision,workspace:account.snapshot.workspace,send:body=>api('/workspace',body,'PUT'),storage,key:account.draftKey,onState:state=>{
    $('save-status').textContent=state.message;$('save-status').dataset.sync=state.kind;
    button.classList.toggle('sync-warning',['conflict','auth','invalid','offline'].includes(state.kind));
  }});
  button.textContent=account.user.username;
  document.querySelector('.local-badge').textContent='云端';
  document.querySelector('.demo-badge').textContent='SERVER';
  $('save-status').textContent='已连接服务器';$('save-status').tabIndex=0;$('save-status').setAttribute('role','button');$('save-status').title='查看账号与同步状态';
  const open=()=>{
    const dialog=dialogContent(heading(escape(account.user.username),true)+`<p>项目保存在服务器，各账号相互独立。</p><div class="account-sync-status">${escape($('save-status').textContent)}</div>${sync.blocked==='conflict'?'<p class="account-error">其他设备已更新工作空间。下载当前副本后，再加载服务器版本；需要保留的项目可从副本导入。</p>':''}<div class="account-actions"><button id="account-flush" class="button secondary">立即同步 / 重试</button><button id="account-backup" class="button secondary">下载完整工作空间</button><button id="account-upload" class="button secondary">从备份添加项目</button><input id="workspace-upload" type="file" accept=".json,application/json" hidden><button id="account-local" class="button secondary">导入此浏览器原有项目</button>${sync.blocked==='conflict'?'<button id="account-reload" class="button secondary">已下载副本，加载服务器版本</button>':''}</div><details class="password-details"><summary>修改密码</summary><form id="password-form" class="account-form"><label>当前密码<input name="current" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></label><label>新密码<input name="next" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label>再次输入新密码<input name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><button class="button secondary">修改密码并重新登录</button></form></details><p id="account-error" class="account-error" role="alert"></p><button id="account-logout" class="button primary">保存并退出登录</button>`);
    dialog.oncancel=null;dialog.querySelector('#close-account').onclick=()=>dialog.close();
    const showError=error=>dialog.querySelector('#account-error').textContent=errorText(error);
    dialog.querySelector('#account-backup').onclick=()=>downloadWorkspace(getWorkspace());
    dialog.querySelector('#account-flush').onclick=async()=>{try{
      if(sync.blocked==='conflict')throw Error('请先下载当前副本，再加载服务器版本');
      if(sync.blocked==='auth'){dialog.close();await loginDialog(account.config,{expectedUser:account.user});}
      getWorkspace();await sync.retry();open();
    }catch(error){showError(error);}};
    dialog.querySelector('#account-reload')?.addEventListener('click',()=>{sync.dispose();storage?.removeItem(sync.key);sync.pending=null;sync.inflight=null;location.reload();});
    dialog.querySelector('#account-local').onclick=()=>{try{importLocal();dialog.close();}catch(error){showError(error);}};
    dialog.querySelector('#account-upload').onclick=()=>dialog.querySelector('#workspace-upload').click();
    dialog.querySelector('#workspace-upload').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('备份不能超过 20 MiB');importWorkspace(validateWorkspace(JSON.parse(await file.text())));dialog.close();}catch(error){showError(error);}};
    dialog.querySelector('#password-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form),submit=form.querySelector('button');submit.disabled=true;try{
      if(data.get('next')!==data.get('confirm'))throw Error('两次新密码不一致');
      getWorkspace();if(!await sync.flush())throw Error('还有未同步内容，请先同步或下载备份');
      await api('/auth/password',{current_password:data.get('current'),new_password:data.get('next')});location.reload();
    }catch(error){showError(error);}finally{submit.disabled=false;}};
    dialog.querySelector('#account-logout').onclick=async event=>{event.currentTarget.disabled=true;try{
      getWorkspace();if(!await sync.flush())throw Error('退出前需要同步成功；可先下载完整工作空间以备份');
      await api('/auth/logout',{});storage?.removeItem(sync.key);location.reload();
    }catch(error){showError(error);event.currentTarget.disabled=false;}};
  };
  button.onclick=open;$('save-status').onclick=open;$('save-status').onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}};
  window.addEventListener('online',()=>{if(!sync.blocked)sync.retry();});
  window.addEventListener('beforeunload',event=>{if(sync.dirty){event.preventDefault();event.returnValue='';}});
  if(account.draft){sync.recover(account.draft);if(sync.blocked)queueMicrotask(open);}
  return sync;
}
