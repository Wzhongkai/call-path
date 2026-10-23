// A click retargeted to <dialog> after a drag must not dismiss the editor.
export function dismissOnBackdrop(dialog,dismiss){
  let startedOutside=false;
  const outside=event=>{
    const rect=dialog.getBoundingClientRect();
    return event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);
  };
  dialog.addEventListener('pointerdown',event=>{startedOutside=event.button===0&&outside(event);},{capture:true});
  dialog.addEventListener('pointercancel',()=>{startedOutside=false;});
  dialog.addEventListener('close',()=>{startedOutside=false;});
  dialog.addEventListener('click',event=>{
    const shouldDismiss=startedOutside&&outside(event);startedOutside=false;
    if(shouldDismiss)dismiss();
  });
}
