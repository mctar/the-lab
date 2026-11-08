/** Paired movement uses the transition matrix, never unmatched before/after totals. */
export function pairedMovement(transitions:number[][]){
  const before=[0,0,0],after=[0,0,0];let total=0,moved=0;
  for(let from=0;from<3;from++)for(let to=0;to<3;to++){
    const count=transitions[from]?.[to]||0;
    before[from]+=count;after[to]+=count;total+=count;if(from!==to)moved+=count;
  }
  return {before,after,total,moved,stayed:total-moved};
}
