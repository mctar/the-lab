import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import QRCode from 'qrcode';
import {CHANGE_CHOICES,CHANGE_QUESTION,SCALE,hasTimer,revisedFlow,type Snapshot,type Card,type PublicationPhoto} from '../server/model';
import {API,request} from './client';
import {media} from './media';
import {FacilitatorTelemetry} from './telemetry';
import {StageScreen} from './stage';
import {ResetSession} from './reset-session';
import {Join,ParticipantApp} from './participant';
import {Button,Shell,useLive} from './ui';
import {FacilitatorDesk} from './facilitator';
import {IDEA_LIKING_QUESTION,REFLECTION_PROMPTS} from './workshop-flow';
import {staffRoute,staffUrl,type StaffRole} from './staff-routes';
import './prototype.css';
import './style.css';

for(const [name,value] of Object.entries({'plate-l':media.plateL,'plate-d':media.plateD,'pile-l':media.pileL,'pile-d':media.pileD})){
  document.documentElement.style.setProperty(`--${name}`,`url(${value})`);
}

function QR({url}:{url:string}){
  const [src,setSrc]=useState('');
  useEffect(()=>{void QRCode.toDataURL(url,{width:640,margin:2,errorCorrectionLevel:'M'}).then(setSrc);},[url]);
  return src?<img className="qr" src={src} alt="QR code to join this session"/>:null;
}

function ProtectedPhoto({id,token,asset,alt,full=false,lazy=false}:{id:string;token:string;asset:string;alt:string;full?:boolean;lazy?:boolean}){
  const [url,setUrl]=useState(''),[visible,setVisible]=useState(!lazy);
  const placeholder=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(visible||!placeholder.current)return;
    const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting)setVisible(true);},{rootMargin:'200px'});
    observer.observe(placeholder.current);
    return()=>observer.disconnect();
  },[visible]);
  useEffect(()=>{
    if(!visible)return;
    const abort=new AbortController();let object='',timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
    async function load(){
      try{const response=await fetch(API+`/v1/sessions/${id}/assets/${asset}${full?'?full=1':''}`,{headers:{Authorization:'Bearer '+token},signal:abort.signal});
        if(response.status===401||response.status===403||response.status===404){setUrl('');return;}
        if(!response.ok)throw new Error('Image unavailable');
        const blob=await response.blob();if(abort.signal.aborted)return;object=URL.createObjectURL(blob);setUrl(object);
      }catch{if(!abort.signal.aborted&&++attempts<5)timer=setTimeout(()=>void load(),2000+Math.random()*2000);}
    }
    void load();return()=>{abort.abort();clearTimeout(timer);if(object)URL.revokeObjectURL(object);};
  },[id,token,asset,full,visible]);
  return url?<img src={url} alt={alt}/>:<div ref={placeholder} className="image-placeholder">Loading image…</div>;
}
function Distribution({label,counts,total,color}:{label:string;counts:number[];total:number;color:string}){const sum=counts.reduce((a,b)=>a+b,0);return <section className="distribution"><div className="distribution-head"><h2>{label}</h2><span>{sum} / {total} answered</span></div><div className="category-grid">{counts.map((n,i)=><div key={i}><div className="dot-field">{Array.from({length:n},(_,j)=><i key={j} style={{background:color,width:n>200?4:n>80?6:9,height:n>200?4:n>80?6:9}}/>)}</div><strong>{SCALE[i][0]}</strong><span className="category-count">{n}</span></div>)}</div></section>;}
function GalleryCard({card,id,token,hide}:{card:Card;id:string;token:string;hide:()=>void}){return <article className={'gallery-card'+(card.hidden?' hidden-card':'')}>{card.assetId&&<ProtectedPhoto key={card.assetId} id={id} token={token} asset={card.assetId} alt={card.title} lazy/>}<div className="gallery-copy"><p className="small">{card.kind==='first-idea'?'ORIGINAL AI IDEA':card.kind==='build'?'FIRST BUILD':'CONCEPT CARD'}</p><h3>{card.title||'A build from the room'}</h3>{card.description&&<p>{card.description}</p>}{card.mine&&<p className="contribution">{card.mine}</p>}<Button onClick={hide}>{card.hidden?'Restore to wall':'Hide from wall'}</Button></div></article>;}

function PairedResults({snapshot}:{snapshot:Snapshot}){
  return <div className="transitions"><h2>How people moved <small>{snapshot.paired} paired answers</small></h2><table><caption>Rows: opening question. Columns: closing question.</caption><thead><tr><th>From / to</th>{SCALE.map(([label])=><th key={label}>{label}</th>)}</tr></thead><tbody>{snapshot.transitions.map((row,i)=><tr key={i}><th>{SCALE[i][0]}</th>{row.map((n,j)=><td key={j} style={{background:`rgba(230,83,185,${.08+.6*n/snapshot.paired})`}}>{n}</td>)}</tr>)}</tbody></table></div>;
}
const stageViews=[['overview','Instructions'],['results','Closing vote'],['gallery','Photo wall'],['reflections','Reflection responses']] as const;
const phaseActions=['Open build plan','Start build','Capture builds','Start make it yours','Open concept cards','Open final reflection'];

function Staff({id,role,token,base,onAuthorized}:{id:string;role:StaffRole;token:string;base:string;onAuthorized:(reusable:boolean)=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const host=role==='host';
  const refresh=()=>request<Snapshot>(`/v1/sessions/${id}/snapshot`,token).then(next=>{
    if(host!==Boolean(next.telemetry))throw new Error('Open the private link for this staff view.');
    onAuthorized(next.session.reusable===true);
    setSnapshot(previous=>previous&&(previous.session.run>next.session.run||previous.session.run===next.session.run&&previous.capturedAt>next.capturedAt)?previous:next);
    setError('');
  }).catch(e=>setError(e.message));
  const connected=useLive(id,token,()=>void refresh());
  useEffect(()=>{void refresh();},[id,token]);

  async function control(patch:Record<string,unknown>){
    if(!snapshot||busy)return;
    setBusy(true);
    try{await request(`/v1/sessions/${id}/control`,token,{expectedRevision:snapshot.session.revision,...patch},'PATCH');await refresh();}
    catch(e){await refresh();setError((e as Error).message);}
    finally{setBusy(false);}
  }
  async function exportResults(){
    try{
      const data=await request(`/v1/sessions/${id}/export`,token);
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='workshop-results.json';link.click();URL.revokeObjectURL(url);
    }catch(e){setError((e as Error).message);}
  }
  async function downloadPublication(photo:PublicationPhoto){
    try{
      const response=await fetch(API+`/v1/sessions/${id}/assets/${photo.assetId}?full=1&publication=1`,{headers:{Authorization:'Bearer '+token}});
      if(!response.ok)throw new Error('This image is no longer available for the write-up.');
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');link.href=url;link.download=`the-lab-${photo.assetId}.jpg`;link.click();URL.revokeObjectURL(url);
    }catch(e){setError((e as Error).message);}
  }
  async function removePublication(photo:PublicationPhoto){
    try{
      await request(`/v1/sessions/${id}/publication/${photo.assetId}`,token,undefined,'DELETE');
      await refresh();
    }catch(e){setError((e as Error).message);}
  }
  if(!snapshot)return <Shell><h1>{host?'Session controls':'Opening the big screen'}</h1><p role="alert">{error||'Connecting to the session…'}</p><Button onClick={()=>void refresh()}>Reconnect</Button></Shell>;

  const s=snapshot.session,joinUrl=new URL('#/join?code='+s.code,import.meta.env.VITE_PUBLIC_URL||base).href,cards=snapshot.gallery;
  if(!host)return <StageScreen key={s.run} snapshot={snapshot} connected={connected} error={error} joinUrl={joinUrl} qr={<QR url={joinUrl}/>} photo={(card,full)=><ProtectedPhoto key={card.assetId} id={id} token={token} asset={card.assetId!} alt={card.title||'A build from the room'} full={full}/>}/>;

  const capturing=s.phase===2&&!hasTimer(s);
  const revised=revisedFlow(s),firstIdeas=snapshot.ideas?.first||[],collection=snapshot.collection;
  const people=snapshot.telemetry?.participants||[];
  const ready=collection?.instructions??people.filter(person=>person.handedOff&&person.waitingForPhase===1).length;
  const skipping=collection?.noPlan??people.filter(person=>person.handedOff===false&&person.waitingForPhase===1).length;
  const closingVotes=Object.values(snapshot.biggestChange||{}).reduce((sum,n)=>sum+n,0);
  const next=capturing
    ? collection
      ? {label:'Start reflection · 2 min',patch:{timer:'reset',stageView:'first-ideas'}}
      : revised&&!s.firstRevealed
      ? {label:'Reveal first ideas',patch:{stageView:'first-ideas'}}
      : {label:'Start reflection · 2 min',patch:{timer:'reset',stageView:'overview'}}
    : revised&&s.phase===2&&!s.exchange
      ? {label:'Start neighbour exchange · 2 min',patch:{exchange:true}}
      : s.phase<5 ? {label:phaseActions[s.phase+1],patch:{phase:s.phase+1}} : null;
  async function hideCard(card:Card){
    try{await request(`/v1/sessions/${id}/cards/${card.id}`,token,{hidden:!card.hidden},'PATCH');await refresh();}
    catch(e){setError((e as Error).message);}
  }
  let progress='';
  if(revised&&s.phase===0)progress=`${ready} of ${snapshot.total} have instructions · ${skipping} reported no plan`;
  if(revised&&capturing)progress=collection
    ? `${collection.builds} of ${snapshot.total} build photos saved · ${collection.firstIdeas} original ideas saved`
    : `${firstIdeas.filter(card=>!card.hidden).length} first ideas ready to reveal`;
  if(collection&&s.phase===4)progress=`${collection.concepts} of ${snapshot.total} concept cards saved`;
  if(collection&&s.phase===5)progress=`${closingVotes} of ${snapshot.total} closing votes saved`;
  const facilitatorNote=collection&&s.phase===0?'While people wait, explain that AI plans can miscount pieces. Ask everyone to build what they can.':undefined;
  const automaticView=revised&&s.phase===5?'comparison':collection&&s.phase===2&&!capturing&&!s.exchange?'first-ideas':'overview';
  const resetCardCount=collection?collection.firstIdeas+collection.builds+collection.concepts:cards.length+firstIdeas.length+(snapshot.publication?.length||0);

  return <FacilitatorDesk key={s.run} snapshot={snapshot} connected={connected} error={error} busy={busy} next={next} progress={progress} facilitatorNote={facilitatorNote} control={control} panels={{
    join:<div className="join-banner"><QR url={joinUrl}/><div><h2>Join the workshop</h2><a href={joinUrl}>Participant join link</a><p>Room code <strong>{s.code}</strong></p></div></div>,
    participants:<FacilitatorTelemetry key={s.run} snapshot={snapshot}/>,
    screen:<section className="control-panel"><h3>On the big screen</h3>
      <p>The display follows the workshop stages. Use these controls to show a specific view or pause photos.</p>
      <div className="row"><Button solid={s.stageView===automaticView} disabled={busy||s.closed} onClick={()=>void control({stageView:automaticView})}>Follow workshop</Button>
        {stageViews.filter(([value])=>value!==automaticView&&(!collection||value!=='results'||s.phase===5)).map(([value,label])=><Button key={value} disabled={busy} solid={s.stageView===value} onClick={()=>void control({stageView:value})}>{label}</Button>)}
        {revised&&s.firstRevealed&&s.phase>=2&&automaticView!=='first-ideas'&&<Button disabled={busy} solid={s.stageView==='first-ideas'} onClick={()=>void control({stageView:'first-ideas'})}>First ideas</Button>}
        {collection&&s.phase===5&&!s.closed&&<Button disabled={busy} solid={s.stageView==='final-exchange'} onClick={()=>void control({stageView:'final-exchange'})}>Final neighbour exchange · 2 min</Button>}
      </div>
      <div className="row"><Button disabled={busy} onClick={()=>void control({galleryPaused:!s.galleryPaused})}>{s.galleryPaused?'Resume gallery':'Pause gallery'}</Button></div>
    </section>,
    results:<div className="desk-tool-stack">
      {revised?<div className="reflection-results"><section><h2>{CHANGE_QUESTION}</h2>{CHANGE_CHOICES.map(choice=><div className="result-row" key={choice}>
        <span>{choice}</span><meter min={0} max={Math.max(snapshot.total,1)} value={snapshot.biggestChange?.[choice]||0}/><b>{snapshot.biggestChange?.[choice]||0}</b>
      </div>)}</section></div>:<div className="results">{snapshot.before.some(Boolean)&&<Distribution label="Opening question" counts={snapshot.before} total={snapshot.total} color="#26a7eb"/>}<Distribution label="Closing question" counts={snapshot.after} total={snapshot.total} color="#00ce62"/>{snapshot.paired>0&&<PairedResults snapshot={snapshot}/>}</div>}
      <div className="reflection-results">{[[REFLECTION_PROMPTS[1],snapshot.instructionEase||{}],[IDEA_LIKING_QUESTION,snapshot.ideaLiking||{}],['Did the plan work?',snapshot.works],['How did it feel?',snapshot.feel]].filter(([,data])=>Object.keys(data).length).map(([title,data])=><section key={title as string}><h2>{title as string}</h2>{Object.entries(data as Record<string,number>).map(([label,n])=><div className="result-row" key={label}><span>{label}</span><meter min={0} max={Math.max(snapshot.total,1)} value={n}/><b>{n}</b></div>)}</section>)}</div>
      <div className="row"><Button onClick={()=>void exportResults()}>Export results</Button></div>
    </div>,
    media:<div className="desk-tool-stack">
      <section className="wall-section"><div className="distribution-head"><h2>{s.galleryPaused?'The gallery is paused':'On the wall'}</h2><span>{cards.length} shared builds and cards</span></div>
        {cards.length?<div className="gallery">{cards.map(card=><GalleryCard key={card.id} card={card} id={id} token={token} hide={()=>void hideCard(card)}/>)}</div>:<p className="empty-wall">Shared builds and cards will appear here.</p>}
      </section>
      {revised&&firstIdeas.length>0&&<section className="wall-section"><h2>First ideas</h2><div className="gallery">{firstIdeas.map(card=><GalleryCard key={card.id} card={card} id={id} token={token} hide={()=>void hideCard(card)}/>)}</div></section>}
      {revised&&<section className="control-panel"><h2>Images approved for gervilabs.com</h2>
        <p>Use these images only in the public write-up for this experiment. Check permission again before publishing.</p>
        {snapshot.publication?.length?<ul>{snapshot.publication.map(photo=><li key={photo.assetId}>
          <Button onClick={()=>void downloadPublication(photo)}>{`Download ${photo.label.toLowerCase()} · ${photo.assetId.slice(0,8)}`}</Button>
          <Button onClick={()=>void removePublication(photo)}>Remove write-up approval</Button>
        </li>)}</ul>:<p>No images approved for the public write-up yet.</p>}
      </section>}
    </div>,
    session:<div className="desk-tool-stack">
      <section className="control-panel"><h3>Session status</h3><p>Closing stops new joins and submissions. Participants keep their drafts.</p>
        <div className="row"><Button disabled={busy} onClick={()=>void control({closed:!s.closed})}>{s.closed?'Reopen session':'Close session'}</Button><Button onClick={()=>void exportResults()}>Export results</Button></div>
      </section>
      <ResetSession session={s} participants={snapshot.total} cards={resetCardCount} token={token} onReset={refresh}/>
    </div>,
  }}/>;
}
function App(){
  const [href,setHref]=useState(location.href);
  useEffect(()=>{
    const change=()=>setHref(location.href);
    window.addEventListener('hashchange',change);
    window.addEventListener('popstate',change);
    return()=>{
      window.removeEventListener('hashchange',change);
      window.removeEventListener('popstate',change);
    };
  },[]);
  const url=new URL(href),staff=staffRoute(url);
  if(staff){
    const {role,access,base}=staff;
    const reusableKey=`bwt:reusable:${role}`,lastKey=`bwt:last:${role}`;
    const id=staff.id||localStorage.getItem(reusableKey)||localStorage.getItem(lastKey)||'';
    const roomKey=`bwt:${role}:${id}`,token=access||localStorage.getItem(roomKey);
    if(!token||!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)){
      const name=role==='host'?'facilitator':'big screen';
      return <Shell><h1>{role==='host'?'Facilitator':'Big screen'}</h1>
        <p>Open the private {name} link for your room once on this browser. Then use this address to return.</p>
      </Shell>;
    }
    const remember=(reusable:boolean)=>{
      if(location.href!==href)return;
      if(access)localStorage.setItem(roomKey,access);
      if(reusable)localStorage.setItem(reusableKey,id);
      localStorage.setItem(lastKey,id);
      history.replaceState(history.state,'',staffUrl(base,role,id));
    };
    return <Staff key={role+id+token} id={id} role={role} token={token} base={base} onAuthorized={remember}/>;
  }
  const [role,id]=url.hash.replace(/^#\/?/,'').split('?')[0].split('/');
  if(role==='session'&&id)return <ParticipantApp key={id} id={id}/>;
  return <Join key={url.hash}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
