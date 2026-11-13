import React,{useEffect,useRef,useState,type CSSProperties} from 'react';
import {CHANGE_CHOICES,CHANGE_QUESTION,IDEA_LIKING,INSTRUCTION_EASE,INSTRUCTION_EASE_CHOICES,SCALE,WORKSHOP_NAME,buildFirstFlow,hasTimer,requiredFlow,revisedFlow,type Card,type Snapshot} from '../server/model';
import {groupIdeaTitles,pairedMovement} from './stage-data';
import {ComparisonWall,PhotoWall} from './stage-walls';
import {RoundClock} from './round-clock';
import {StageMusic} from './stage-music';
import {IDEA_LIKING_QUESTION,REFLECTION_PROMPTS,stageCue,STAGE_STEPS,WORKSHOP_BRIEF,WORKSHOP_PROMPT_LABEL} from './workshop-flow';
import './stage.css';

const COLORS=['#f48bce','#83c9ff','#b4ee6b'];
const PALE=['#f9c8e7','#c9e7ff','#d5f7ad'];
type StageProps={snapshot:Snapshot;connected:boolean;error:string;qr:React.ReactNode;joinUrl:string;photo:(card:Card,full?:boolean)=>React.ReactNode};
const styleVars=(values:Record<string,string|number>)=>values as CSSProperties;

function Brick({className='',color,style}:{className?:string;color?:string;style?:CSSProperties}){
  return <span aria-hidden="true" className={'toy-brick '+className} style={{...style,...color?styleVars({'--brick-color':color}):{}}}><i/><i/><i/><i/></span>;
}
function useMotion(){
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),[paused,setPaused]=useState(false);
  useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
  return {enabled:!reduced&&!paused,paused:reduced||paused,forced:reduced,toggle:()=>setPaused(v=>!v)};
}
function Count({value}:{value:number}){return <span className="play-count" key={value}>{value}</span>;}

function VoteBoard({counts,total,label,compact=false}:{counts:number[];total:number;label:string;compact?:boolean}){
  const answers=counts.reduce((a,b)=>a+b,0);
  const maximum=Math.max(0,...counts),columns=maximum>120?20:maximum>40?12:maximum>12?8:4;
  const rows=Math.max(1,Math.ceil(maximum/columns)),step=`min(${compact?32:42}px, calc((100% - 16px) / ${rows}))`;
  return <section className={'vote-board'+(compact?' compact':'')} aria-label={`${label}: ${answers} of ${total} answers`}>
    <div className="play-section-heading"><h2>{label}</h2><span><b>{answers}</b> / {total} answered</span></div>
    <div className="vote-stacks">{counts.map((n,category)=>{
      return <div className="vote-category" key={category} style={styleVars({'--vote-color':COLORS[category],'--vote-pale':PALE[category]})}>
        <div className="vote-stack-field" aria-hidden="true"><div className="vote-base"/>
          {Array.from({length:n},(_,i)=><Brick key={i} className="vote-unit" color={COLORS[category]} style={{left:`${i%columns/columns*100}%`,bottom:`calc(${step} * ${Math.floor(i/columns)} + 10px)`,width:`calc(${100/columns}% - 3px)`,height:`calc(${step} - 3px)`,animationDelay:`${Math.min(i,16)*.035}s`,...styleVars({'--tilt':`${((i*7+category)%5-2)*1.2}deg`})}}/>)}
          {n===0&&<div className="empty-stack"><span>your<br/>move</span></div>}
        </div>
        <div className="vote-label"><strong><Count value={n}/></strong><h3>{SCALE[category][0]}</h3><p>{SCALE[category][1]}</p></div>
      </div>;
    })}</div>
    <p className="vote-key"><span/>Each brick in a stack is one answer.</p>
  </section>;
}

function Movement({snapshot,motion}:{snapshot:Snapshot;motion:boolean}){
  const {before,after,total,moved,stayed}=pairedMovement(snapshot.transitions);
  if(!total){
    const hasBefore=snapshot.before.some(Boolean),hasAfter=snapshot.after.some(Boolean);
    return <div className="unpaired-results">
      {hasBefore&&<VoteBoard counts={snapshot.before} total={snapshot.total} label="Opening question"/>}
      {hasAfter?<VoteBoard counts={snapshot.after} total={snapshot.total} label="Closing question"/>:<div className="waiting-reveal"><Brick color={COLORS[2]}/><h2>Closing votes will appear here</h2><p>Participants can vote during the final reflection.</p></div>}
    </div>;
  }
  const ys=[75,235,395];
  return <section className="movement-view" aria-label={`${total} paired answers; ${moved} changed category and ${stayed} stayed in the same category`}>
    <div className="movement-top"><span>AT THE START</span><div><b>{moved}</b> moved <span>·</span> <b>{stayed}</b> stayed</div><span>JUST NOW</span></div>
    <svg viewBox="0 0 1400 470" className="movement-map" role="img" aria-label="Ribbons connect the categories people chose before and after. Ribbon width represents the number of paired answers.">
      <defs>{COLORS.map((color,i)=>COLORS.map((target,j)=><linearGradient id={`ribbon-${i}-${j}`} key={`${i}-${j}`} gradientUnits="userSpaceOnUse" x1="340" y1="0" x2="1060" y2="0"><stop offset="0%" stopColor={color}/><stop offset="100%" stopColor={target}/></linearGradient>))}</defs>
      {snapshot.transitions.map((row,from)=>row.map((n,to)=>{
        if(!n)return null;const path=`M 340 ${ys[from]} C 570 ${ys[from]}, 830 ${ys[to]}, 1060 ${ys[to]}`;
        return <g key={`${from}-${to}`}><path className="ribbon-glow" d={path} stroke={`url(#ribbon-${from}-${to})`} strokeWidth={9+70*n/total}/><path d={path} fill="none" stroke={`url(#ribbon-${from}-${to})`} strokeWidth={4+45*n/total} opacity=".65"/>
          {motion&&Array.from({length:Math.min(4,Math.max(1,Math.ceil(n/total*8)))},(_,i)=><g className="ribbon-traveller" key={i}><rect x="-15" y="-9" width="30" height="18" rx="4" fill={PALE[to]}/><circle cx="-6" cy="-5" r="4" fill={COLORS[to]}/><circle cx="6" cy="-5" r="4" fill={COLORS[to]}/><animateMotion dur={`${5+from+to}s`} repeatCount="indefinite" begin={`${-i*2.2}s`} path={path}/></g>)}
        </g>;
      }))}
      {COLORS.map((color,i)=><React.Fragment key={color}><g className="movement-node"><rect x="0" y={ys[i]-61} width="330" height="122" rx="14" fill={color}/><text x="24" y={ys[i]-7} className="movement-category">{SCALE[i][0]}</text><text x="24" y={ys[i]+34} className="movement-caption">{SCALE[i][1]}</text><text x="302" y={ys[i]+13} textAnchor="end" className="movement-number">{before[i]}</text></g><g className="movement-node"><rect x="1070" y={ys[i]-61} width="330" height="122" rx="14" fill={color}/><text x="1094" y={ys[i]-7} className="movement-category">{SCALE[i][0]}</text><text x="1094" y={ys[i]+34} className="movement-caption">{SCALE[i][1]}</text><text x="1372" y={ys[i]+13} textAnchor="end" className="movement-number">{after[i]}</text></g></React.Fragment>)}
    </svg>
    <div className="movement-key"><b>{total} people answered both questions.</b><span>Ribbon widths show how many took each path.</span></div>
  </section>;
}

function Spotlight({cards,paused,photo,large=false}:{cards:Card[];paused:boolean;photo:StageProps['photo'];large?:boolean}){
  const [index,setIndex]=useState(0),[arrival,setArrival]=useState<string|null>(null),seen=useRef<Set<string>|null>(null),arrivalTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{const timer=setInterval(()=>setIndex(i=>i+1),11000);return()=>clearInterval(timer);},[cards.length]);
  useEffect(()=>{
    const next=new Set(cards.map(c=>c.id));
    if(seen.current){const incoming=cards.find(c=>!seen.current!.has(c.id));if(incoming){setIndex(cards.indexOf(incoming));setArrival(incoming.id);clearTimeout(arrivalTimer.current);arrivalTimer.current=setTimeout(()=>setArrival(null),6000);}}
    seen.current=new Set([...(seen.current||[]),...next]);
  },[cards]);
  useEffect(()=>()=>clearTimeout(arrivalTimer.current),[]);
  const ordered=cards.filter(c=>!c.hidden),card=ordered.length?ordered[index%ordered.length]:null;
  if(paused||!card)return <section className="empty-spotlight"><div className="empty-bricks" aria-hidden="true"><Brick color={COLORS[0]}/><Brick color={COLORS[1]}/><Brick color={COLORS[2]}/></div><p className="play-eyebrow">{paused?'GALLERY PAUSED':'THIS SPACE HAS YOUR NAME ON IT'}</p><h2>{paused?<>Eyes up.<br/>A moment together.</>:<>Something good<br/>is taking shape.</>}</h2><p>{paused?'The facilitator will bring the builds back.':'Share your build from your phone. It’ll land right here.'}</p></section>;
  const selected=arrival===card.id;
  return <section className={'spotlight'+(large?' spotlight-large':'')}>
    <div className="play-section-heading"><h2>{selected?'Just landed!':'Fresh off the table'}</h2><span>{index%ordered.length+1} / {ordered.length}</span></div>
    <article className={'spotlight-card'+(selected?' just-landed':'')} key={card.id+card.updatedAt}>
      <div className="spotlight-photo">{card.assetId?photo(card,true):<div className="idea-without-photo"><Brick color={COLORS[0]}/><Brick color={COLORS[1]}/><Brick color={COLORS[2]}/><span>AN IDEA WORTH<br/>BUILDING ON.</span></div>}<span className="photo-sticker">{card.kind==='build'?'FIRST BUILD':'MADE IT MINE'}</span></div>
      <div className="spotlight-copy"><h3>{card.kind==='build'?'A little build. A big beginning.':card.title}</h3>{card.description&&<p>{card.description}</p>}{card.mine&&<div className="spotlight-mine"><span>THE HUMAN TOUCH</span><p>{card.mine}</p></div>}</div>
    </article>
    <div className="spotlight-progress" aria-hidden="true" key={card.id}><i/></div>
  </section>;
}

function Gallery({snapshot,photo}:{snapshot:Snapshot;photo:StageProps['photo']}){
  const cards=snapshot.gallery;
  return <div className="play-gallery"><Spotlight cards={cards} paused={snapshot.session.galleryPaused} photo={photo} large/>{!snapshot.session.galleryPaused&&cards.length>1&&<aside className="gallery-shelf"><p className="play-eyebrow">MORE FROM THIS ROOM</p><div>{cards.slice(0,4).map((card,i)=><article key={card.id} className="shelf-card" style={styleVars({'--shelf-angle':`${i%2===0?-3:3}deg`,'--shelf-color':COLORS[i%3]})}>{card.assetId?photo(card):<Brick color={COLORS[i%3]}/>}<span>{card.kind==='build'?'First build':card.title}</span></article>)}</div><p className="shelf-count"><b>{cards.length}</b> shared builds & ideas.<br/>All from this room.</p></aside>}</div>;
}

function Reflections({snapshot}:{snapshot:Snapshot}){
  const ease=snapshot.instructionEase||{};
  const legacy=[{title:'Did the plan work?',counts:snapshot.works,labels:['Yes','Partly','No']},{title:'How did following it feel?',counts:snapshot.feel,labels:['Easy','Mixed','Uncomfortable']}];
  const required=requiredFlow(snapshot.session);
  const ratings:{title:string;counts:Record<string,number>;labels:readonly string[]}[]=[{title:REFLECTION_PROMPTS[1],counts:ease,labels:required?INSTRUCTION_EASE_CHOICES:INSTRUCTION_EASE}];
  if(required)ratings.push({title:IDEA_LIKING_QUESTION,counts:snapshot.ideaLiking||{},labels:IDEA_LIKING});
  const groups=required||Object.keys(ease).length||legacy.every(group=>!Object.keys(group.counts).length)?ratings:legacy;
  return <div className="play-reflections">{groups.map((group,g)=><section key={group.title}><p className="play-eyebrow">{g===0?'THE PLAN MET THE BRICKS':'THE HUMAN PART'}</p><h2>{group.title}</h2><div className="reflection-stacks" style={styleVars({'--rating-options':group.labels.length})}>{group.labels.map((label,i)=>{const n=group.counts[label]||0,maximum=Math.max(1,...Object.values(group.counts));return <div className="reflection-choice" key={label} style={styleVars({'--reflection-color':COLORS[i%COLORS.length]})}><div className="reflection-bar"><i style={{height:`${n/maximum*100}%`}}>{Array.from({length:4},(_,j)=><span key={j}/>)}</i><strong><Count value={n}/></strong></div><h3>{label}</h3></div>;})}</div><p className="reflection-total">{Object.values(group.counts).reduce((a,b)=>a+b,0)} / {snapshot.total} answered</p></section>)}</div>;
}

function IdeaTiles({title,cards,index,limit}:{title:string;cards:Card[];index:number;limit:number}){
  const ideas=groupIdeaTitles(cards);
  const pages=Math.max(1,Math.ceil(ideas.length/limit)),page=index%pages;
  return <section className="idea-tiles">
    <div className="play-section-heading"><h2>{title}</h2><span>{cards.length} shared{pages>1?` · ${page+1}/${pages}`:''}</span></div>
    {ideas.length?<ul>{ideas.slice(page*limit,(page+1)*limit).map(idea=><li key={idea.title}>
      <span>{idea.title}</span>{idea.count>1&&<b aria-label={`${idea.count} submissions`}>×{idea.count}</b>}
    </li>)}</ul>:<p className="idea-empty">Nothing shared here yet.</p>}
  </section>;
}

function IdeaWall({snapshot,compare}:{snapshot:Snapshot;compare:boolean}){
  const [index,setIndex]=useState(0);
  const {first=[],final=[],pairs=[]}=snapshot.ideas||{};
  useEffect(()=>{
    const timer=setInterval(()=>setIndex(i=>i+1),12000);
    return()=>clearInterval(timer);
  },[]);
  if(snapshot.session.galleryPaused)return <p className="idea-empty">The reveal is paused.</p>;
  const pair=pairs[index%pairs.length];
  return <div className={`idea-wall${compare?' comparing':''}`}>
    <div className="idea-columns">
      <IdeaTiles title="AI’s first suggestions" cards={first} index={index} limit={compare?6:12}/>
      {compare&&<IdeaTiles title="Final concept cards" cards={final} index={index} limit={6}/>}
    </div>
    {compare&&<div className="idea-pair">
      <p className="play-eyebrow">{pairs.length} {pairs.length===1?'person shared':'people shared'} both</p>
      {pair&&<div key={pair.id}><strong>{pair.first}</strong><span aria-hidden="true">→</span><strong>{pair.final}</strong></div>}
      {pair&&<p className="idea-pair-description">{pair.description}</p>}
    </div>}
  </div>;
}

function ClosingChanges({snapshot}:{snapshot:Snapshot}){
  const counts=snapshot.biggestChange||{}, maximum=Math.max(1,...Object.values(counts));
  const answered=Object.values(counts).reduce((sum,n)=>sum+n,0);
  return <section className="change-results">
    <div className="play-section-heading"><h2>{CHANGE_QUESTION}</h2><span>{answered} / {snapshot.total} answered</span></div>
    <ul>{CHANGE_CHOICES.map((label,i)=><li key={label}>
      <span>{label}</span><div aria-hidden="true"><i style={{width:`${(counts[label]||0)/maximum*100}%`,background:COLORS[i%COLORS.length]}}/></div><strong>{counts[label]||0}</strong>
    </li>)}</ul>
  </section>;
}

export function StageScreen({snapshot,connected,error,qr,joinUrl,photo}:StageProps){
  const s=snapshot.session,cue=stageCue(s),view=s.stageView,lobby=s.phase<0&&!s.closed,required=requiredFlow(s);
  const buildFirst=buildFirstFlow(s);
  const {enabled:motion,paused:motionPaused,forced:reducedMotion,toggle}=useMotion();
  const [joinOpen,setJoinOpen]=useState(false);
  const previousTotal=useRef(snapshot.total),[joinBurst,setJoinBurst]=useState(false);
  useEffect(()=>{if(snapshot.total>previousTotal.current){setJoinBurst(true);const timer=setTimeout(()=>setJoinBurst(false),4000);previousTotal.current=snapshot.total;return()=>clearTimeout(timer);}previousTotal.current=snapshot.total;},[snapshot.total]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.ctrlKey||e.metaKey||e.altKey||e.repeat||e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;if(e.key.toLowerCase()==='m')toggle();if(e.key.toLowerCase()==='j')setJoinOpen(v=>!v);if(e.key==='Escape')setJoinOpen(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const rehearsal=/dry run|rehearsal|visual qa|load test/i.test(s.title);
  const showSpotlight=!required&&!s.galleryPaused&&snapshot.gallery.length>0;
  const timed=hasTimer(s)&&!s.closed;
  const gettingPlan=s.phase===0&&!s.closed;
  const instructions=view==='overview'||view==='final-exchange';
  const sideClock=timed&&!gettingPlan&&instructions;
  const uploadKind=s.phase===2&&!timed?'build':s.phase===4?'concept':null;
  const liveWall=required&&!s.closed&&(view==='gallery'||view==='overview'&&uploadKind!==null);
  const compare=view==='first-ideas'||view==='comparison';
  const wall=liveWall||required&&compare;
  const firstReflection=view==='first-ideas'&&s.phase===2&&timed&&!s.exchange;
  const title=firstReflection?'Reflect on the first build':view==='first-ideas'?'What did the AI suggest?':view==='comparison'?'What did we change?':cue.title;
  const reminder=firstReflection?'Answer the reflection questions on your phone. Look for ideas that repeat.':
    view==='first-ideas'?'Compare the AI ideas with what people built.':
    view==='comparison'?(buildFirst?CHANGE_QUESTION+' Tap one answer on your phone.':required?'Compare the ideas. Answer the closing question on your phone.':'What changed, and what prompted that decision?'):
    liveWall?(uploadKind==='concept'?(buildFirst?'Name it, describe it, add an image or a quick sketch, and say what changed.':'Name your idea, add an image and say what changed.'):uploadKind==='build'?(buildFirst?'Photograph your build. Then save the first AI idea if you got one.':'Photograph what you built. Unfinished builds count.'):cue.steps[0]):cue.steps[0];
  const joinPage=new URL(joinUrl);
  joinPage.hash='';
  const manualJoin=<div className="stage-manual-join">
    <p>Or go to <a href={joinPage.href}>{joinPage.href.replace(/\/$/,'')}</a></p>
    <p>Enter room code <strong>{s.code}</strong></p>
  </div>;
  return <div className={`play-stage stage-scene-${lobby?'lobby':view}${wall?' stage-with-wall':''}`} data-motion={motion?'on':'off'}>
    <div className="play-background" aria-hidden="true"><Brick color={COLORS[0]}/><Brick color={COLORS[1]}/><Brick color={COLORS[2]}/></div>
    <header className="play-header"><div className="play-brand"><span className="brand-brick"><i/><i/></span><b>{WORKSHOP_NAME}</b>{rehearsal&&<span className="rehearsal-tag">DRY RUN</span>}</div><div className={'play-live'+(!connected||error?' reconnecting':'')} role="status"><i/>{connected&&!error?'LIVE':'RECONNECTING'}</div></header>
    <div className="play-title-row cue-title-row">
      <div><p className="cue-kicker">{s.closed?'Workshop complete':`${cue.step+1} / ${STAGE_STEPS.length} · ${STAGE_STEPS[cue.step]}`}</p><h1>{title}</h1>{!lobby&&(!instructions||liveWall)&&<p className="cue-reminder">{reminder}</p>}</div>
      {!lobby&&(!instructions||gettingPlan||liveWall)&&<RoundClock session={s} compact/>}
    </div>
    <main className="play-content">
      {lobby?<div className="stage-join">
        <div className="stage-join-copy"><h2>Scan with your phone</h2><p>Have your loose bricks and your AI app ready.</p><div className={'room-counter'+(joinBurst?' new-builder':'')}><strong><Count value={snapshot.total}/></strong><span>JOINED THE WORKSHOP</span></div></div>
        <div className="welcome-join"><a href={joinUrl} className="large-join-qr">{qr}</a>{manualJoin}</div>
      </div>:compare?(
        required?<ComparisonWall key={view} snapshot={snapshot} final={view==='comparison'} photo={photo}/>:<IdeaWall key={view} snapshot={snapshot} compare={view==='comparison'}/>
      ):
        liveWall?<PhotoWall key={uploadKind||view} cards={snapshot.gallery} kind={uploadKind} photo={photo} paused={s.galleryPaused}/>:
        view==='results'?(revisedFlow(s)?<ClosingChanges snapshot={snapshot}/>:<Movement snapshot={snapshot} motion={motion}/>):
        view==='gallery'?<Gallery snapshot={snapshot} photo={photo}/>:
        view==='reflections'?<Reflections snapshot={snapshot}/>:
        <div className={'cue-board'+(sideClock||showSpotlight?' has-side':'')}>
          <div className="cue-main"><ol>{cue.steps.map((line,index)=><li key={line} className={gettingPlan&&index===2?'cue-explanation':undefined}>{line}</li>)}</ol>{gettingPlan&&<div className="cue-brief"><span>{WORKSHOP_PROMPT_LABEL}</span><strong>{WORKSHOP_BRIEF}</strong></div>}</div>
          {(sideClock||showSpotlight)&&<div className="cue-side">{sideClock&&<RoundClock session={s}/>} {showSpotlight&&<Spotlight cards={snapshot.gallery} paused={false} photo={photo}/>}</div>}
        </div>}
    </main>
    <footer className="play-footer">
      <div className="phase-trail" aria-label="Session progress">{STAGE_STEPS.map((label,i)=><span key={label} className={cue.step===i?'current':cue.step>i?'past':''}><i>{i+1}</i><b>{label}</b></span>)}</div>
      <div className="play-footer-actions">
        <button onClick={toggle} aria-pressed={motionPaused} disabled={reducedMotion}>{reducedMotion?'Reduced motion':motionPaused?'▶ Motion':'Ⅱ Motion'}</button>
        <button onClick={()=>document.documentElement.requestFullscreen?.()}>⛶ Full screen</button>
        <StageMusic session={s} connected={connected&&!error}/>
      </div>
    </footer>
    {!lobby&&!s.closed&&<button className="play-join-tab" onClick={()=>setJoinOpen(true)} aria-label="Show the join QR code">{qr}<span>JOIN<strong>{s.code}</strong></span></button>}
    {error&&<p className="play-connection-note" role="status">{error} · Showing the last saved room picture.</p>}
    {joinOpen&&!s.closed&&<div className="play-join-overlay" role="dialog" aria-modal="true" aria-label="Join the session"><button className="join-overlay-close" onClick={()=>setJoinOpen(false)} aria-label="Close join code">×</button><p className="play-eyebrow">Scan with your phone</p><h2>Join the workshop</h2><a href={joinUrl}>{qr}</a>{manualJoin}</div>}
  </div>;
}
