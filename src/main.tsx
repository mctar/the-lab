import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import QRCode from 'qrcode';
import {PHASES,ROUND_MINUTES,SCALE,WORKSHOP_NAME,hasTimer,type Snapshot,type Card} from '../server/model';
import {API,request} from './client';
import {media} from './media';
import {FacilitatorTelemetry} from './telemetry';
import {StageScreen} from './stage';
import {ResetSession} from './reset-session';
import {Join,ParticipantApp} from './participant';
import {Button,Shell,useLive} from './ui';
import {RoundClock} from './round-clock';
import {stageCue} from './workshop-flow';
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

function ProtectedPhoto({id,token,asset,alt,full=false}:{id:string;token:string;asset:string;alt:string;full?:boolean}){
  const [url,setUrl]=useState('');
  useEffect(()=>{
    const abort=new AbortController();let object='',timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
    async function load(){
      try{const response=await fetch(API+`/v1/sessions/${id}/assets/${asset}${full?'?full=1':''}`,{headers:{Authorization:'Bearer '+token},signal:abort.signal});
        if(response.status===401||response.status===403||response.status===404){setUrl('');return;}
        if(!response.ok)throw new Error('Image unavailable');
        const blob=await response.blob();if(abort.signal.aborted)return;object=URL.createObjectURL(blob);setUrl(object);
      }catch{if(!abort.signal.aborted&&++attempts<5)timer=setTimeout(()=>void load(),2000+Math.random()*2000);}
    }
    void load();return()=>{abort.abort();clearTimeout(timer);if(object)URL.revokeObjectURL(object);};
  },[id,token,asset,full]);
  return url?<img src={url} alt={alt}/>:<div className="image-placeholder">Your idea, made real.</div>;
}
function Distribution({label,counts,total,color}:{label:string;counts:number[];total:number;color:string}){const sum=counts.reduce((a,b)=>a+b,0);return <section className="distribution"><div className="distribution-head"><h2>{label}</h2><span>{sum} / {total} answered</span></div><div className="category-grid">{counts.map((n,i)=><div key={i}><div className="dot-field">{Array.from({length:n},(_,j)=><i key={j} style={{background:color,width:n>200?4:n>80?6:9,height:n>200?4:n>80?6:9}}/>)}</div><strong>{SCALE[i][0]}</strong><span className="category-count">{n}</span></div>)}</div></section>;}
function GalleryCard({card,id,token,hide}:{card:Card;id:string;token:string;hide:()=>void}){return <article className={'gallery-card'+(card.hidden?' hidden-card':'')}>{card.assetId&&<ProtectedPhoto id={id} token={token} asset={card.assetId} alt={card.title}/>}<div className="gallery-copy"><p className="small">{card.kind==='build'?'FIRST BUILD':'CONCEPT CARD'}</p><h3>{card.title||'A build from the room'}</h3>{card.description&&<p>{card.description}</p>}{card.mine&&<p className="contribution">{card.mine}</p>}<Button onClick={hide}>{card.hidden?'Restore to wall':'Hide from wall'}</Button></div></article>;}

function PairedResults({snapshot}:{snapshot:Snapshot}){
  return <div className="transitions"><h2>How people moved <small>{snapshot.paired} paired answers</small></h2><table><caption>Rows: opening question. Columns: closing question.</caption><thead><tr><th>From / to</th>{SCALE.map(([label])=><th key={label}>{label}</th>)}</tr></thead><tbody>{snapshot.transitions.map((row,i)=><tr key={i}><th>{SCALE[i][0]}</th>{row.map((n,j)=><td key={j} style={{background:`rgba(230,83,185,${.08+.6*n/snapshot.paired})`}}>{n}</td>)}</tr>)}</tbody></table></div>;
}
const stageViews=[['overview','Instructions'],['results','Results'],['gallery','Gallery'],['reflections','Responses']] as const;
const phaseActions=['Open build plan','Start build','Capture builds','Start make it yours','Open concept cards','Open final reflection'];

function Staff({id,role,token}:{id:string;role:'host'|'stage';token:string}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const host=role==='host';
  const refresh=()=>request<Snapshot>(`/v1/sessions/${id}/snapshot`,token).then(next=>{
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
  if(!snapshot)return <Shell><h1>{host?'Session controls':'Opening the big screen'}</h1><p role="alert">{error||'Connecting to the session…'}</p><Button onClick={()=>void refresh()}>Reconnect</Button></Shell>;

  const s=snapshot.session,cue=stageCue(s),joinUrl=new URL('#/join?code='+s.code,import.meta.env.VITE_PUBLIC_URL||location.href).href,cards=snapshot.gallery;
  if(!host)return <StageScreen key={s.run} snapshot={snapshot} connected={connected} error={error} joinUrl={joinUrl} qr={<QR url={joinUrl}/>} photo={(card,full)=><ProtectedPhoto key={card.assetId} id={id} token={token} asset={card.assetId!} alt={card.title||'A build from the room'} full={full}/>}/>;

  const capturing=s.phase===2&&!hasTimer(s);
  const next= capturing ? {label:'Start reflection · 2 min',patch:{timer:'reset',stageView:'overview'}} : s.phase<5 ? {label:phaseActions[s.phase+1],patch:{phase:s.phase+1}} : null;
  return <div className="host-screen">
    <header className="screen-header"><div><p className="eyebrow">{WORKSHOP_NAME} · Facilitator</p><h1>{s.title}</h1></div><div className="room-code"><span>Room code</span><b>{s.code}</b><span>{snapshot.total} joined</span></div></header>
    <div className="screen-status" role="status">{error||(!connected?'Live connection interrupted · refreshing automatically':`Live · ${new Date(snapshot.capturedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`)}</div>
    <div className="host-controls">
      <section className="control-panel host-round">
        <p className="eyebrow">Current audience instruction</p><h2>{cue.title}</h2>
        <ol>{cue.steps.map(line=><li key={line}>{line}</li>)}</ol>
        <RoundClock session={s} compact/>
        {hasTimer(s)&&!s.closed&&<div className="row"><Button disabled={busy} onClick={()=>void control({timer:s.remainingMs!==null?'resume':'pause'})}>{s.remainingMs!==null?'Resume timer':'Pause timer'}</Button><Button disabled={busy} onClick={()=>void control({timer:'extend'})}>+1 minute</Button>{ROUND_MINUTES[s.phase]&&<Button disabled={busy} onClick={()=>void control({timer:'reset'})}>Restart timer</Button>}</div>}
        {next&&!s.closed&&<Button solid disabled={busy} onClick={()=>void control(next.patch)}>{next.label}</Button>}
        <details><summary>Jump to a phase</summary><div className="phase-buttons">{PHASES.map((label,i)=><button type="button" key={label} disabled={busy||s.closed} className={s.phase===i?'active':''} onClick={()=>void control({phase:i})}><span>{i+1}</span>{label}</button>)}</div></details>
      </section>
      <section className="control-panel"><h2>On the big screen</h2>
        <p>Use Instructions to guide the room. Every phase opens with its instructions.</p>
        <div className="row">{stageViews.map(([value,label])=><Button key={value} disabled={busy} solid={s.stageView===value} onClick={()=>void control({stageView:value})}>{label}</Button>)}</div>
        <div className="row"><Button disabled={busy} onClick={()=>void control({galleryPaused:!s.galleryPaused})}>{s.galleryPaused?'Resume gallery':'Pause gallery'}</Button><Button onClick={()=>void exportResults()}>Export results</Button></div>
        <details><summary>Session status</summary><p>Closing stops new joins and submissions. Participants keep their drafts.</p><Button disabled={busy} onClick={()=>void control({closed:!s.closed})}>{s.closed?'Reopen session':'Close session'}</Button></details>
      </section>
    </div>
    <ResetSession session={s} participants={snapshot.total} cards={cards.length} token={token} onReset={refresh}/>
    <FacilitatorTelemetry key={s.run} snapshot={snapshot}/>
    <div className="join-banner"><QR url={joinUrl}/><div><h2>Join the workshop</h2><a href={joinUrl}>{joinUrl}</a><p>Share this link or show the QR on the big screen.</p></div></div>
    <div className="results">{snapshot.before.some(Boolean)&&<Distribution label="Opening question" counts={snapshot.before} total={snapshot.total} color="#26a7eb"/>}<Distribution label="Closing question" counts={snapshot.after} total={snapshot.total} color="#00ce62"/>{snapshot.paired>0&&<PairedResults snapshot={snapshot}/>}</div>
    <div className="reflection-results">{[['How easy was it to follow the AI’s instructions?',snapshot.instructionEase||{}],['Did the plan work?',snapshot.works],['How did it feel?',snapshot.feel]].filter(([,data])=>Object.keys(data).length).map(([title,data])=><section key={title as string}><h2>{title as string}</h2>{Object.entries(data as Record<string,number>).map(([label,n])=><div className="result-row" key={label}><span>{label}</span><meter min={0} max={Math.max(snapshot.total,1)} value={n}/><b>{n}</b></div>)}</section>)}</div>
    <section className="wall-section"><div className="distribution-head"><h2>{s.galleryPaused?'The gallery is paused':'On the wall'}</h2><span>{cards.length} shared builds and cards</span></div>
      {cards.length?<div className="gallery">{cards.map(card=><GalleryCard key={card.id} card={card} id={id} token={token} hide={async()=>{try{await request(`/v1/sessions/${id}/cards/${card.id}`,token,{hidden:!card.hidden},'PATCH');await refresh();}catch(e){setError((e as Error).message);}}}/>)}</div>:<p className="empty-wall">Shared builds and cards will appear here.</p>}
    </section>
  </div>;
}
function App(){const [route,setRoute]=useState(location.hash);useEffect(()=>{const change=()=>setRoute(location.hash);addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);const [path,query]=route.replace(/^#\/?/,'').split('?'),[role,id]=path.split('/');if((role==='host'||role==='stage')&&id){const access=new URLSearchParams(query).get('access');if(access){localStorage.setItem(`bwt:${role}:${id}`,access);history.replaceState(null,'',location.pathname+location.search+`#/${role}/${id}`);}const token=access||localStorage.getItem(`bwt:${role}:${id}`);return token?<Staff key={id+role} id={id} role={role} token={token}/>:<Shell><h1>Your private link.</h1><p>Open the facilitator or screen link supplied with this session.</p></Shell>;}if(role==='session'&&id)return <ParticipantApp key={id} id={id}/>;return <Join key={route}/>;}
createRoot(document.getElementById('root')!).render(<App/>);
