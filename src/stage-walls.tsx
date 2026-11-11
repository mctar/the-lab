import {useEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {CHANGE_CHOICES,type Card,type Snapshot} from '../server/model';
import {groupIdeaTitles,wallPage} from './stage-data';

type Photo=(card:Card)=>ReactNode;
const PAGE_MS=8000;
const FIRST_REVEAL_PAGE_MS=6250;
const RECENT_MS=5000;
const PHOTO_PAGE_SIZE=9;
const PAIR_PAGE_SIZE=8;
const RECENT_LIMIT=3;

function arrivalOrder(a:Card,b:Card){
  return a.updatedAt.localeCompare(b.updatedAt)||a.id.localeCompare(b.id);
}

function useRecentCards(cards:Card[]){
  const newest=cards.slice(-RECENT_LIMIT).reverse();
  const pending=useRef(newest);
  pending.current=newest;
  const [visible,setVisible]=useState(()=>newest.map(card=>card.id));
  useEffect(()=>{
    const timer=setInterval(()=>{
      const next=pending.current.map(card=>card.id);
      setVisible(previous=>previous.length===next.length&&previous.every((id,i)=>id===next[i])?previous:next);
    },RECENT_MS);
    return()=>clearInterval(timer);
  },[]);
  // Take the current cards so removed or hidden submissions disappear immediately.
  const byId=new Map(cards.map(card=>[card.id,card]));
  const recent=visible.flatMap(id=>{const card=byId.get(id);return card?[card]:[];});
  return recent.length?recent:newest;
}

function WallPages<T>({items,size,columns,kind,interval=PAGE_MS,render}:{items:T[];size:number;columns:number;kind:string;interval?:number;render:(item:T)=>ReactNode}){
  const [index,setIndex]=useState(0);
  const {count,current,preload}=wallPage(items.length,size,index);
  const multiple=count>1;
  const latestCount=useRef(count);
  latestCount.current=count;
  useEffect(()=>{
    if(!multiple){setIndex(0);return;}
    const timer=setInterval(()=>setIndex(previous=>(Math.min(previous,latestCount.current-1)+1)%latestCount.current),interval);
    return()=>clearInterval(timer);
  },[multiple,interval]);
  return <div className={`wall-pages wall-pages-${kind}`}>
    <div className="wall-window">
      {preload.map(page=>{
        const group=items.slice(page*size,(page+1)*size);
        const across=Math.max(1,Math.min(columns,group.length));
        const dimensions={'--wall-cols':across,'--wall-rows':Math.max(1,Math.ceil(group.length/across))} as CSSProperties;
        return <div key={page} className="wall-grid" hidden={page!==current} style={dimensions}>{group.map(render)}</div>;
      })}
    </div>
    {multiple&&<span className="wall-page-count">Group {current+1} of {count}</span>}
  </div>;
}

function PhotoTile({card,photo,caption=false}:{card:Card;photo:Photo;caption?:boolean}){
  return <figure className="wall-tile">
    <div className="wall-picture">{photo(card)}</div>
    {caption&&card.kind==='concept'&&<figcaption>{card.title}</figcaption>}
  </figure>;
}

export function PhotoWall({cards,kind,photo,paused}:{cards:Card[];kind:'build'|'concept'|null;photo:Photo;paused:boolean}){
  const ordered=useMemo(()=>cards.filter(card=>card.assetId&&!card.hidden&&(!kind||card.kind===kind)).sort(arrivalOrder),[cards,kind]);
  const recent=useRecentCards(ordered);
  const showRecent=ordered.length>RECENT_LIMIT&&recent.length>0;
  const recentIds=new Set(showRecent?recent.map(card=>card.id):[]);
  const archive=ordered.filter(card=>!recentIds.has(card.id));
  if(paused)return <p className="wall-empty">The photo wall is paused.</p>;
  if(!ordered.length)return <p className="wall-empty">Photos will appear here as they’re saved.</p>;
  const label=kind==='concept'?'concept':kind==='build'?'build':'photo';
  return <section className={`photo-wall${showRecent?' has-arrivals':''}`} aria-label="Live photo wall">
    <div className="wall-main">
      <div className="wall-heading"><strong>{ordered.length} {label}{ordered.length===1?'':'s'} on the wall</strong></div>
      <WallPages items={archive} size={PHOTO_PAGE_SIZE} columns={3} kind="photos"
        render={card=><PhotoTile key={card.id} card={card} photo={photo} caption/>}/>
    </div>
    {showRecent&&<aside className="wall-arrivals">
      <h2>Just in</h2>
      <div>{recent.map(card=><PhotoTile key={card.id} card={card} photo={photo} caption/>)}</div>
    </aside>}
  </section>;
}

type Comparison={first?:Card;outcome:Card};
function ComparisonTile({first,outcome,photo,final}:{first?:Card;outcome:Card;photo:Photo;final:boolean}){
  return <article className="wall-comparison">
    <div className="wall-pair">
      <div className="wall-picture wall-original">{first?.assetId?photo(first):<span>Original unavailable</span>}</div>
      <div className="wall-picture wall-outcome">{photo(outcome)}</div>
    </div>
    <div className="wall-pair-names"><strong>{first?.title||'AI idea'}</strong>{final&&<strong>{outcome.title}</strong>}</div>
    {final&&outcome.mine&&<p className="wall-change">{outcome.mine}</p>}
  </article>;
}

function VoteStrip({snapshot}:{snapshot:Snapshot}){
  const counts=snapshot.biggestChange||{};
  const answered=Object.values(counts).reduce((sum,n)=>sum+n,0);
  if(!answered)return null;
  return <div className="wall-votes" aria-label={`${answered} of ${snapshot.total} answered the closing question`}>
    <strong>{answered} / {snapshot.total} voted</strong>
    <ul>{CHANGE_CHOICES.map(label=>{
      const n=counts[label]||0;
      return <li key={label} style={{'--vote-share':`${n/answered*100}%`} as CSSProperties}><span>{label}</span><b>{n}</b></li>;
    })}</ul>
  </div>;
}

export function ComparisonWall({snapshot,final,photo}:{snapshot:Snapshot;final:boolean;photo:Photo}){
  const {ideas,session}=snapshot;
  const pairs=useMemo(()=>{
    const entries:Comparison[]=final?(ideas?.comparisons||[]).map(({first,final:card})=>({first,outcome:card}))
      :(ideas?.firstBuilds||[]).map(({first,build})=>({first,outcome:build}));
    return entries.sort((a,b)=>arrivalOrder(a.outcome,b.outcome));
  },[ideas,final]);
  const repeated=final?[]:groupIdeaTitles(ideas?.first||[]).filter(item=>item.count>1).slice(0,3);
  if(session.galleryPaused)return <p className="wall-empty">The photo wall is paused.</p>;
  const count=pairs.length;
  return <section className="comparison-wall" aria-label={final?'Original ideas and final concepts':'Original ideas and first builds'}>
    {count>0?<><div className="wall-heading">
      <strong>{count} {final?(count===1?'final concept':'final concepts'):(count===1?'first build':'first builds')}</strong>
      <div className="wall-legend"><span>AI idea</span><span>{final?'Final concept':'Built'}</span></div>
    </div>
    <WallPages items={pairs} size={PAIR_PAGE_SIZE} columns={4} kind="pairs" interval={final?PAGE_MS:FIRST_REVEAL_PAGE_MS}
      render={pair=><ComparisonTile key={pair.outcome.id} {...pair} photo={photo} final={final}/>}/>
    </>:<p className="wall-empty">{final?'Final concepts will appear here as they’re saved.':'First builds will appear here as they’re saved.'}</p>}
    {repeated.length>0&&<div className="wall-patterns"><strong>Repeated AI ideas</strong>{repeated.map(item=><span key={item.title}>{item.title} <b>×{item.count}</b></span>)}</div>}
    {final&&<VoteStrip snapshot={snapshot}/>}
  </section>;
}
