import {api} from './account.js';
import {validateWorkspace} from './workspace.js';
import {dismissOnBackdrop} from './dialog.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const shareTokenFromUrl=url=>{const params=new URL(url).searchParams;return params.has('share')?params.get('share'):null;};
export function sharedWorkspace(data){
  if(!data?.project?.document||!Number.isFinite(data.updatedAt))throw Error('分享数据格式错误');
  return validateWorkspace({schemaVersion:1,activeId:'shared-project',projects:[{id:'shared-project',document:data.project.document,view:data.project.view||undefined,updatedAt:data.updatedAt*1000}],trash:[]});
}
export async function connectShared(token){
  document.querySelector('.app').inert=true;
  try{
    if(!/^[a-f0-9]{64}$/.test(token))throw Error('分享链接无效或已撤销');
    const endpoint=new URL('./api/shared/'+token,import.meta.url);
    const response=await fetch(endpoint,{credentials:'omit',signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw Error(response.status===404?'分享不存在或已撤销':'暂时无法加载分享，请稍后重试');
    const data=await response.json(),workspace=sharedWorkspace(data);
    document.querySelector('.app').inert=false;
    return {remote:true,readonly:true,snapshot:{workspace},sharedAt:data.updatedAt};
  }catch(error){
    const dialog=$('share-dialog');dialog.innerHTML=`<h2>无法打开分享</h2><p>${esc(error.message)}</p><div class="share-actions"><button id="retry-share" class="button secondary">重新加载</button><a class="button primary" href="./">进入我的工作台</a></div>`;
    dialog.oncancel=event=>event.preventDefault();dialog.showModal();$('retry-share').onclick=()=>location.reload();
    return new Promise(()=>{});
  }
}
export function mountSharedView(account){
  document.querySelector('.app').classList.add('readonly-view');$('project-title').readOnly=true;
  $('save-status').textContent='只读快照 · '+new Date(account.sharedAt*1000).toLocaleString('zh-CN');
  $('account-btn').textContent='进入我的工作台';$('account-btn').onclick=()=>{location.href=new URL('./',import.meta.url).href;};
  document.querySelector('.local-badge').textContent='只读';document.querySelector('.demo-badge').textContent='SHARED';
  $('edit-selection').textContent='查看详情';
  $('edit-selection').title='查看选中的函数或分区 (Enter)';$('inspector').setAttribute('aria-label','只读详情');
  document.querySelector('.canvas-instructions').textContent='只读项目 · 拖动空白处平移 · 双击查看详情';
  return null;
}
export function mountSharing(account,{getProject,prepare}){
  if(!account.remote||account.readonly)return;
  const button=$('share-btn'),dialog=$('share-dialog');button.hidden=false;let generation=0;
  dismissOnBackdrop(dialog,()=>dialog.close());
  button.onclick=async()=>{
    const session=++generation,project=getProject();let shares=[],busy=false,status='';
    const draw=()=>{
      if(session!==generation)return;
      const current=shares.find(item=>item.projectId===project.id),others=shares.filter(item=>item.projectId!==project.id);
      dialog.innerHTML=`<div class="dialog-heading"><span class="eyebrow">项目分享</span><button id="close-share" class="icon-btn" aria-label="关闭分享">×</button></div><h2>${esc(project.title)}</h2><p>拥有链接的人可免登录查看此项目的全部代码、备注和调用链。分享为只读快照，后续编辑需点击「更新分享」才会公开。</p>${current?`<label class="share-link-label">只读链接<input id="share-url" aria-label="只读分享链接" readonly value="${esc(current.url)}"></label><small>快照更新于 ${esc(new Date(current.updatedAt*1000).toLocaleString('zh-CN'))}</small><div class="share-actions"><button id="copy-share" class="button primary">复制链接</button><a class="button secondary" href="${esc(current.url)}" target="_blank" rel="noreferrer">预览分享 ↗</a><button id="publish-share" class="button secondary">更新分享</button><button data-revoke-share="${esc(current.token)}" class="button delete-btn">撤销链接</button></div>`:`<div class="share-actions"><button id="publish-share" class="button primary">创建只读链接</button></div>`}${others.length?`<details class="other-shares"><summary>其他项目的分享 · ${others.length}</summary>${others.map(item=>`<div class="other-share"><span>${esc(item.title)}</span><a href="${esc(item.url)}" target="_blank" rel="noreferrer">查看</a><button class="text-btn" data-revoke-share="${esc(item.token)}">撤销链接</button></div>`).join('')}</details>`:''}<p id="share-status" role="status">${esc(status)}</p>`;
      $('close-share').onclick=()=>dialog.close();
      $('copy-share')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(current.url);$('share-status').textContent='链接已复制';}catch{$('share-url').focus();$('share-url').select();$('share-status').textContent='请按 Ctrl+C 复制链接';}});
      $('publish-share').onclick=async()=>{
        if(busy)return;busy=true;draw();
        try{const revision=await prepare();const result=await api('/shares'+(current?'/'+current.token:''),{projectId:project.id,revision},current?'PUT':'POST');shares=[result.share,...shares.filter(item=>item.projectId!==project.id)];status=current?'分享已更新，链接保持不变':'链接已创建，可复制给别人查看';}
        catch(error){status=error.message;}finally{busy=false;draw();}
      };
      dialog.querySelectorAll('[data-revoke-share]').forEach(item=>item.onclick=async()=>{
        if(busy)return;busy=true;draw();
        try{await api('/shares/'+item.dataset.revokeShare,undefined,'DELETE');shares=shares.filter(share=>share.token!==item.dataset.revokeShare);status='链接已撤销，原链接无法再次访问';}
        catch(error){status=error.message;}finally{busy=false;draw();}
      });
      dialog.querySelectorAll('#publish-share,[data-revoke-share]').forEach(item=>item.disabled=busy);
    };
    dialog.innerHTML='<h2>加载项目分享…</h2>';dialog.showModal();
    try{shares=(await api('/shares')).shares;draw();}catch(error){status=error.message;draw();}
  };
}
