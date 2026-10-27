const pt=(x,y)=>({x,y});
const cubic=(from,c1,c2,to)=>({from,c1,c2,to});
const line=(a,b)=>cubic(a,pt(a.x+(b.x-a.x)/3,a.y+(b.y-a.y)/3),pt(a.x+(b.x-a.x)*2/3,a.y+(b.y-a.y)*2/3),b);
export function routeBetween(s,t,{dir=1,endDir=dir,lane=null,offset=0}={}){
  if(lane!==null){const lead=45+offset,p=pt(s.x+dir*(lead+28),lane),q=pt(t.x-endDir*(lead+28),lane);return [cubic(s,pt(s.x+dir*lead,s.y),pt(s.x+dir*lead,lane),p),line(p,q),cubic(q,pt(t.x-endDir*lead,lane),pt(t.x-endDir*lead,t.y),t)];}
  const curve=Math.max(70,Math.abs(t.x-s.x)*.5)+offset;
  return [cubic(s,pt(s.x+dir*curve,s.y+offset),pt(t.x-endDir*curve,t.y+offset),t)];
}
// Horizontal distance alone never requires a detour around a code block.
export function routeBlocks(s,t,{source,target,dir=1,endDir=dir,offset=0}={}){
  let lane=null;
  if(dir*(t.x-s.x)<=0||endDir*(t.x-s.x)<=0){
    const above=Math.min(source.y,target.y)-40-offset;
    const below=Math.max(source.y+source.h,target.y+target.h)+40+offset;
    const cost=y=>Math.abs(s.y-y)+Math.abs(t.y-y);
    lane=cost(above)<=cost(below)?above:below;
  }
  return routeBetween(s,t,{dir,endDir,lane,offset});
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
