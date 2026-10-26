// Keep the graph point under the gesture midpoint fixed while fingers move.
export function pinchCamera(start,a,b){
  const midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  const distance=Math.hypot(a.x-b.x,a.y-b.y);
  const z=Math.max(.2,Math.min(2,start.camera.z*distance/start.distance));
  return {x:midpoint.x-start.world.x*z,y:midpoint.y-start.world.y*z,z};
}

export function installPinchNavigation(viewport,{getCamera,paint,save,beforePinch,suppressClick}){
  const points=new Map();let gesture=null,blocked=false;
  const local=event=>{const rect=viewport.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
  const block=event=>{event.preventDefault();event.stopImmediatePropagation();};
  viewport.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch'||event.target.closest('.canvas-tools,.zoom-controls,.connection-hint,.filter-indicator,.canvas-empty'))return;
    points.set(event.pointerId,local(event));
    if(points.size===2&&!blocked){
      beforePinch();blocked=true;
      const [a,b]=[...points.values()],camera={...getCamera()};
      const midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      gesture={camera,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),world:{x:(midpoint.x-camera.x)/camera.z,y:(midpoint.y-camera.y)/camera.z}};
    }
    if(blocked){block(event);for(const id of points.keys())viewport.setPointerCapture(id);}
  },{capture:true});
  viewport.addEventListener('pointermove',event=>{
    if(!points.has(event.pointerId))return;
    points.set(event.pointerId,local(event));
    if(!blocked)return;
    block(event);
    if(gesture&&points.size===2){Object.assign(getCamera(),pinchCamera(gesture,...points.values()));paint();}
  },{capture:true});
  const end=event=>{
    if(!points.has(event.pointerId))return;
    points.delete(event.pointerId);
    if(!blocked)return;
    block(event);gesture=null;suppressClick();
    if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
    if(!points.size){blocked=false;save();}
  };
  viewport.addEventListener('pointerup',end,{capture:true});
  viewport.addEventListener('pointercancel',end,{capture:true});
}
