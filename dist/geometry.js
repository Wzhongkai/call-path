const pt=(x,y)=>({x,y});
const cubic=(from,c1,c2,to)=>({from,c1,c2,to});
const line=(a,b)=>cubic(a,pt(a.x+(b.x-a.x)/3,a.y+(b.y-a.y)/3),pt(a.x+(b.x-a.x)*2/3,a.y+(b.y-a.y)*2/3),b);
export function routeBetween(s,t,{dir=1,endDir=dir,lane=null,offset=0}={}){
  if(lane!==null){const lead=45+offset,p=pt(s.x+dir*(lead+28),lane),q=pt(t.x-endDir*(lead+28),lane);return [cubic(s,pt(s.x+dir*lead,s.y),pt(s.x+dir*lead,lane),p),line(p,q),cubic(q,pt(t.x-endDir*lead,lane),pt(t.x-endDir*lead,t.y),t)];}
  const curve=Math.max(70,Math.abs(t.x-s.x)*.5)+offset;
  return [cubic(s,pt(s.x+dir*curve,s.y+offset),pt(t.x-endDir*curve,t.y+offset),t)];
}
const EPS=1e-7;
const blockGap=16;
const overlap=(a,b,c,d,gap)=>a<d+gap-EPS&&b>c-gap+EPS;

// Leave saved coordinates intact so temporarily taller previews can shrink back in place.
export function separateBlocks(rects,gap=blockGap){
  const placed=[];
  for(const rect of [...rects].sort((a,b)=>a.y-b.y)){
    const next={...rect};
    for(const other of placed){
      if(overlap(next.x,next.x+next.w,other.x,other.x+other.w,gap)
        &&overlap(next.y,next.y+next.h,other.y,other.y+other.h,gap)){
        next.y=other.y+other.h+gap;
      }
    }
    const index=placed.findIndex(other=>other.y>next.y);
    placed.splice(index<0?placed.length:index,0,next);
  }
  return placed;
}

// Sweep each axis separately so a moving block can slide along a neighbour.
export function slideBlocks(moving,stationary,{x,y},gap=blockGap){
  function limit(delta,axis,cross,extent,crossExtent,shift){
    for(const rect of moving)for(const other of stationary){
      if(!overlap(rect[cross]+shift,rect[cross]+shift+rect[crossExtent],other[cross],other[cross]+other[crossExtent],gap))continue;
      const before=other[axis]-rect[axis]-rect[extent]-gap;
      const after=other[axis]+other[extent]+gap-rect[axis];
      if(delta>0&&before>=-EPS)delta=Math.min(delta,Math.max(0,before));
      if(delta<0&&after<=EPS)delta=Math.max(delta,Math.min(0,after));
    }
    return delta;
  }
  x=limit(x,'x','y','w','h',0);
  y=limit(y,'y','x','h','w',x);
  return {x,y};
}
const inside=(p,r)=>p.x>r.x+EPS&&p.x<r.x+r.w-EPS&&p.y>r.y+EPS&&p.y<r.y+r.h-EPS;
const clearSegment=(a,b,rects)=>!rects.some(r=>Math.abs(a.y-b.y)<EPS
  ?a.y>r.y+EPS&&a.y<r.y+r.h-EPS&&Math.max(a.x,b.x)>r.x+EPS&&Math.min(a.x,b.x)<r.x+r.w-EPS
  :a.x>r.x+EPS&&a.x<r.x+r.w-EPS&&Math.max(a.y,b.y)>r.y+EPS&&Math.min(a.y,b.y)<r.y+r.h-EPS);
function roundedPath(points,radius){
  const simple=[];
  for(const p of points){
    if(simple.length&&Math.hypot(p.x-simple.at(-1).x,p.y-simple.at(-1).y)<EPS)continue;
    while(simple.length>1){const a=simple.at(-2),b=simple.at(-1);if(Math.abs((b.x-a.x)*(p.y-b.y)-(b.y-a.y)*(p.x-b.x))>EPS||(b.x-a.x)*(p.x-b.x)+(b.y-a.y)*(p.y-b.y)<0)break;simple.pop();}
    simple.push(p);
  }
  const segments=[];let current=simple[0];
  for(let i=1;i<simple.length-1;i++){
    const a=simple[i-1],b=simple[i],c=simple[i+1],before=Math.hypot(b.x-a.x,b.y-a.y),after=Math.hypot(c.x-b.x,c.y-b.y),r=Math.min(radius,before/2,after/2);
    const entry=pt(b.x+(a.x-b.x)*r/before,b.y+(a.y-b.y)*r/before),exit=pt(b.x+(c.x-b.x)*r/after,b.y+(c.y-b.y)*r/after);
    if(Math.hypot(entry.x-current.x,entry.y-current.y)>EPS)segments.push(line(current,entry));
    if(r>EPS)segments.push(cubic(entry,pt(entry.x+(b.x-entry.x)*2/3,entry.y+(b.y-entry.y)*2/3),pt(exit.x+(b.x-exit.x)*2/3,exit.y+(b.y-exit.y)*2/3),exit));
    current=exit;
  }
  if(simple.length>1&&Math.hypot(simple.at(-1).x-current.x,simple.at(-1).y-current.y)>EPS)segments.push(line(current,simple.at(-1)));
  return segments;
}
function curveHits(segment,rect,depth=0){
  const {from,c1,c2,to}=segment;
  const xs=[from.x,c1.x,c2.x,to.x],ys=[from.y,c1.y,c2.y,to.y];
  if(!overlap(Math.min(...xs),Math.max(...xs),rect.x,rect.x+rect.w,0)
    ||!overlap(Math.min(...ys),Math.max(...ys),rect.y,rect.y+rect.h,0))return false;
  if(inside(from,rect)||inside(to,rect)||depth===9)return true;
  const mid=(a,b)=>pt((a.x+b.x)/2,(a.y+b.y)/2);
  const a=mid(from,c1),b=mid(c1,c2),c=mid(c2,to),d=mid(a,b),e=mid(b,c),m=mid(d,e);
  return curveHits(cubic(from,a,d,m),rect,depth+1)||curveHits(cubic(m,e,c,to),rect,depth+1);
}
const hits=(segments,rect)=>segments.some(segment=>curveHits(segment,rect));
// Route between outward port stubs on a small visibility grid around the two blocks.
// Individual block boundaries leave the gap between stacked blocks available.
export function routeBlocks(s,t,{source,target,dir=1,endDir=dir,offset=0,obstacles=[]}={}){
  offset=Math.min(offset,60);
  const gapX=Math.max(target.x-source.x-source.w,source.x-target.x-target.w);
  let direct;
  if(dir===endDir&&dir*(t.x-s.x)>0&&gapX>0){
    const bend=Math.abs(t.x-s.x)/2;
    direct=[cubic(s,pt(s.x+dir*bend,s.y+offset),pt(t.x-endDir*bend,t.y+offset),t)];
  }else if(dir!==endDir&&Math.abs(s.x-t.x)<=24&&Math.abs(s.y-t.y)>=16){
    const bend=(dir>0?Math.max(s.x,t.x):Math.min(s.x,t.x))+dir*(Math.min(54,Math.max(22,Math.abs(t.y-s.y)*.14))+offset);
    const arc=[cubic(s,pt(bend,s.y),pt(bend,t.y),t)];
    if(!hits(arc,source)&&!hits(arc,target))direct=arc;
  }else if(s.x===t.x&&s.y===t.y&&dir!==endDir){
    const bend=pt(s.x+dir*(42+offset),s.y);
    return [cubic(s,pt(bend.x,s.y-26),pt(bend.x,s.y-26),bend),cubic(bend,pt(bend.x,s.y+26),pt(bend.x,s.y+26),t)];
  }
  let route=direct||gridRoute(s,t,{source,target,dir,endDir,offset});
  const blockers=[];
  // Grow the grid only for blocks on the current route.
  for(let pass=0;pass<3;pass++){
    const crossed=obstacles.filter(rect=>!blockers.includes(rect)&&hits(route,rect));
    if(!crossed.length)return route;
    blockers.push(...crossed.slice(0,8-blockers.length));
    const alternate=gridRoute(s,t,{source,target,dir,endDir,offset,blockers});
    if(blockers.some(rect=>hits(alternate,rect)))break;
    route=alternate;
  }
  return route;
}
function gridRoute(s,t,{source,target,dir,endDir,offset,blockers=[]}){
  const gapX=Math.max(target.x-source.x-source.w,source.x-target.x-target.w);
  const gapY=Math.max(target.y-source.y-source.h,source.y-target.y-target.h);
  let margin=18+Math.min(offset,60)/4;
  for(const gap of [gapX,gapY])if(gap>=0)margin=Math.min(margin,gap/4);
  if(blockers.length)margin=Math.min(margin,4);
  const rects=[...new Set([source,target]),...blockers].map(r=>({x:r.x-margin,y:r.y-margin,w:r.w+2*margin,h:r.h+2*margin}));
  const stub=(p,d,others)=>{
    let lead=28+Math.min(offset,60);
    for(const other of others){
      const room=d>0?other.x-p.x:p.x-other.x-other.w;
      if(p.y>other.y-margin&&p.y<other.y+other.h+margin&&room>0)lead=Math.min(lead,room/2);
    }
    return pt(p.x+d*lead,p.y);
  };
  const start=stub(s,dir,[target,...blockers]),end=stub(t,-endDir,[source,...blockers]);
  const unique=values=>[...new Set(values)].sort((a,b)=>a-b);
  const xs=unique([start.x,end.x,...rects.flatMap(r=>[r.x,r.x+r.w])]),ys=unique([start.y,end.y,...rects.flatMap(r=>[r.y,r.y+r.h])]);
  const grid=ys.map(y=>xs.map(x=>rects.some(r=>inside(pt(x,y),r))?null:pt(x,y)));
  const startIndex=ys.indexOf(start.y)*xs.length+xs.indexOf(start.x),endIndex=ys.indexOf(end.y)*xs.length+xs.indexOf(end.x);
  const distance=new Map([[startIndex*2,0]]),previous=new Map(),open=new Set([startIndex*2]);let found=null;
  while(open.size){
    let state;for(const candidate of open)if(state===undefined||distance.get(candidate)<distance.get(state))state=candidate;
    open.delete(state);const index=Math.floor(state/2),axis=state%2,x=index%xs.length,y=Math.floor(index/xs.length),p=grid[y][x];
    if(!p)continue;
    if(index===endIndex){found=state;break;}
    for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
      const q=grid[ny]?.[nx];if(!q||!clearSegment(p,q,rects))continue;
      const nextIndex=ny*xs.length+nx,nextAxis=ny===y?0:1;
      if(index===startIndex&&nextAxis===0&&dir*(q.x-p.x)<0)continue;
      if(nextIndex===endIndex&&nextAxis===0&&endDir*(q.x-p.x)<0)continue;
      const next=nextIndex*2+nextAxis,cost=distance.get(state)+Math.abs(q.x-p.x)+Math.abs(q.y-p.y)+(axis===nextAxis?0:12)+(nextIndex===endIndex&&nextAxis!==0?12:0);
      if(cost<(distance.get(next)??Infinity)){distance.set(next,cost);previous.set(next,state);open.add(next);}
    }
  }
  // Overlapping blocks can cover a port completely; retain a finite path in that case.
  if(found===null)return routeBetween(s,t,{dir,endDir,offset});
  const points=[];for(let state=found;state!==undefined;state=previous.get(state)){const index=Math.floor(state/2);points.push(grid[Math.floor(index/xs.length)][index%xs.length]);}
  return roundedPath([s,...points.reverse(),t],Math.min(12,margin*.8));
}
export function routeConnection(source,target,{fromY,toY,fromLeft=false,toLeft=false,offset=0,obstacles=[]}){
  const preferred=target.x>=source.x?1:-1;
  function route(startDir,endDir){
    const start=pt(source.x+(startDir>0?source.w:0),fromY),end=pt(target.x+(endDir<0?target.w:0),toY);
    const segments=routeBlocks(start,end,{source,target,dir:startDir,endDir,offset,obstacles});
    return {segments,startDir,endDir};
  }
  if(source===target)return route(fromLeft?-1:1,toLeft||fromLeft?1:-1);
  const primary=route(fromLeft?-1:preferred,toLeft?1:preferred);
  const stacked=overlap(source.x,source.x+source.w,target.x,target.x+target.w,0)
    &&(source.y+source.h<=target.y||target.y+target.h<=source.y);
  if(!stacked&&!obstacles.some(rect=>hits(primary.segments,rect)))return primary;
  let best=primary,bestCost=routeCost(primary);
  for(const start of fromLeft?[-1]:[preferred,-preferred]){
    for(const end of toLeft?[1]:[preferred,-preferred]){
      if(start===primary.startDir&&end===primary.endDir)continue;
      const candidate=route(start,end),cost=routeCost(candidate)+24;
      if(cost<bestCost){best=candidate;bestCost=cost;}
    }
  }
  return best;
  function routeCost({segments}){
    let cost=segments.length*4;
    for(const {from,c1,c2,to} of segments)cost+=Math.hypot(c1.x-from.x,c1.y-from.y)+Math.hypot(c2.x-c1.x,c2.y-c1.y)+Math.hypot(to.x-c2.x,to.y-c2.y);
    if(obstacles.some(rect=>hits(segments,rect)))return Infinity;
    return cost;
  }
}
export function returnAlong(segments,{offset=14,start=null,end=null,dir=1}={}){
  const shift=p=>pt(p.x,p.y+offset);
  const reversed=segments.toReversed().map(s=>cubic(shift(s.to),shift(s.c2),shift(s.c1),shift(s.from)));
  if(start&&end){
    const first=reversed[0],last=reversed[reversed.length-1];
    first.from=start;first.c1=pt(first.c1.x,start.y);
    last.to=end;last.c2=pt(last.c2.x,end.y);
  }
  return reversed;
}
export function pathFor(segments){if(!segments.length)return '';return `M ${segments[0].from.x} ${segments[0].from.y} `+segments.map(s=>`C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.to.x} ${s.to.y}`).join(' ');}
