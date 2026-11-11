/** Paired movement uses the transition matrix, never unmatched before/after totals. */
export function pairedMovement(transitions:number[][]){
  const before=[0,0,0],after=[0,0,0];let total=0,moved=0;
  for(let from=0;from<3;from++)for(let to=0;to<3;to++){
    const count=transitions[from]?.[to]||0;
    before[from]+=count;after[to]+=count;total+=count;if(from!==to)moved+=count;
  }
  return {before,after,total,moved,stayed:total-moved};
}

export function groupIdeaTitles(cards:readonly {title:string}[]){
  const ideas=new Map<string,{title:string;count:number}>();
  for(const card of cards){
    const key=card.title.trim().replace(/\s+/g,' ').toLowerCase();
    const previous=ideas.get(key);
    if(previous)previous.count++;
    else ideas.set(key,{title:card.title,count:1});
  }
  return [...ideas.values()].sort((a,b)=>b.count-a.count);
}

export function wallPage(total:number,size:number,index:number){
  const count=Math.max(1,Math.ceil(total/size));
  const current=Math.min(index,count-1);
  const next=(current+1)%count;
  return {count,current,preload:next===current?[current]:[current,next]};
}
