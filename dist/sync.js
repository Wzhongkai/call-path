// A single writer per tab. Every write uses the last acknowledged server revision.
export class WorkspaceSync {
  constructor({revision=0,workspace=null,send,storage,key,onState=()=>{},delay=700}) {
    Object.assign(this,{revision,send,storage,key,onState,delay});
    this.ack=JSON.stringify(workspace);this.pending=null;this.inflight=null;this.blocked=null;this.timer=null;this.retryDelay=1000;
  }
  get dirty(){return this.pending!==null||this.inflight!==null;}
  state(kind,message){this.onState({kind,message,dirty:this.dirty});}
  cache(){try{if(this.pending!==null||this.inflight!==null)this.storage?.setItem(this.key,JSON.stringify({revision:this.revision,workspace:JSON.parse(this.pending??this.inflight)}));else this.storage?.removeItem(this.key);}catch{this.state('warning','本机草稿写入失败，请保持页面打开并导出备份');}}
  queue(workspace){if(this.disposed)return;const raw=JSON.stringify(workspace);if(raw===this.pending||(this.pending===null&&raw===(this.inflight??this.ack)))return;this.pending=raw;this.cache();this.state(this.blocked||'pending',this.blocked?'同步已暂停，请点击查看':'等待同步…');clearTimeout(this.timer);if(!this.blocked)this.timer=setTimeout(()=>this.pump(),this.delay);}
  recover(draft){if(!draft)return;this.pending=JSON.stringify(draft.workspace);if(draft.revision!==this.revision)this.blocked='conflict';this.cache();this.state(this.blocked||'pending',this.blocked?'存在未同步草稿，服务器已更新':'恢复未同步草稿');if(!this.blocked)this.timer=setTimeout(()=>this.pump(),this.delay);}
  async pump(){
    clearTimeout(this.timer);this.timer=null;if(this.running)return this.running;if(this.pending===null||this.blocked)return;
    const raw=this.pending;this.pending=null;this.inflight=raw;this.state('saving','正在保存到服务器…');
    this.running=(async()=>{try{
      const result=await this.send({revision:this.revision,workspace:JSON.parse(raw)});
      this.revision=result.revision;this.ack=raw;this.inflight=null;this.retryDelay=1000;this.cache();this.state(this.pending===null?'saved':'pending',this.pending===null?'已保存到服务器':'等待同步…');
    }catch(error){
      this.inflight=null;if(this.pending===null)this.pending=raw;
      this.blocked=error.status===409?'conflict':error.status===401?'auth':[400,403,413,422].includes(error.status)?'invalid':null;
      this.cache();this.state(this.blocked||'offline',error.message||'网络中断，保留草稿并自动重试');
      if(!this.blocked){this.timer=setTimeout(()=>this.pump(),this.retryDelay);this.retryDelay=Math.min(30_000,this.retryDelay*2);}
    }finally{this.running=null;}})();
    await this.running;if(this.pending!==null&&!this.blocked&&!this.timer)this.timer=setTimeout(()=>this.pump(),this.delay);
  }
  async flush(){clearTimeout(this.timer);this.timer=null;await this.pump();if(this.pending!==null&&!this.blocked){clearTimeout(this.timer);this.timer=null;await this.pump();}return !this.dirty;}
  retry(){this.blocked=null;clearTimeout(this.timer);this.timer=null;return this.pump();}
  dispose(){clearTimeout(this.timer);this.disposed=true;}
}
