import React, {useEffect,useRef,useState} from 'react';
import {AI_TOOLS,FLOW_STEPS,PHASES,type ActivityReport,type ParticipantActivity,type Snapshot} from '../server/model';
import {request,type Workshop} from './client';

export function useActivityReport(w:Workshop){
  const d=w.draft;
  const report:Omit<ActivityReport,'visibility'>={step:d.step,pendingSaves:Math.min(1000,w.jobs.length),
    syncStatus:w.blocked?'error':w.busy?'sending':w.jobs.length?'queued':'saved',
    waitingForPhase:d.waitingForPhase!=null&&d.waitingForPhase>w.identity.session.phase?d.waitingForPhase:null,
    photos:{pile:!!d.pilePhoto,build:!!d.buildPhoto,concept:!!d.conceptPhoto},handedOff:d.handedOff,
    cardReady:!!(d.name.trim()&&d.what.trim())};
  const current=useRef(report);current.current=report;
  const send=()=>{void request(`/v1/sessions/${w.identity.id}/telemetry`,w.identity.token,{...current.current,visibility:document.visibilityState==='hidden'?'hidden':'visible'}).catch(()=>{});};
  const callback=useRef(send);callback.current=send;
  const signature=JSON.stringify(report);
  useEffect(()=>{const timer=setTimeout(()=>callback.current(),600);return()=>clearTimeout(timer);},[w,signature]);
  useEffect(()=>{
    const send=()=>callback.current(),timer=setInterval(send,25000+Math.random()*5000);
    document.addEventListener('visibilitychange',send);window.addEventListener('online',send);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',send);window.removeEventListener('online',send);};
  },[w]);
}

function duration(time:string|null,now:number){
  if(!time)return '—';const seconds=Math.max(0,Math.floor((now-Date.parse(time))/1000));
  if(seconds<60)return `${seconds}s`;if(seconds<3600)return `${Math.floor(seconds/60)}m ${seconds%60}s`;return `${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;
}
function presence(p:ParticipantActivity){return p.connected?(p.visibility==='hidden'?'In background':'Connected'):p.recent?'Seen recently':'Away';}
function saveStatus(p:ParticipantActivity){return p.syncStatus==='error'?'Save needs attention':p.pendingSaves?`${p.syncStatus==='sending'?'Sending':'Queued'} · ${p.pendingSaves}`:p.syncStatus==='saved'?'All saved':'Not reported';}

export function FacilitatorTelemetry({snapshot}:{snapshot:Snapshot}){
  const telemetry=snapshot.telemetry;
  const [filter,setFilter]=useState('all'),[step,setStep]=useState<number|null>(null),[search,setSearch]=useState(''),[sort,setSort]=useState('flow'),[clock,setClock]=useState(Date.now());
  const received=useRef({captured:snapshot.capturedAt,at:Date.now()});
  if(received.current.captured!==snapshot.capturedAt)received.current={captured:snapshot.capturedAt,at:Date.now()};
  const now=Date.parse(snapshot.capturedAt)+Math.max(0,clock-received.current.at);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),5000);return()=>clearInterval(timer);},[]);
  if(!telemetry)return <section className="telemetry-panel"><h2>Participant progress</h2><p>Waiting for progress reports from the server…</p></section>;
  const rows=telemetry.participants.filter(p=>(step===null||p.step===step)&&p.label.toLowerCase().includes(search.trim().toLowerCase())&&
    (filter==='all'||filter==='attention'&&p.needsAttention||filter==='waiting'&&p.waitingForPhase!==null||filter==='finished'&&p.finished||filter==='away'&&!p.connected));
  rows.sort((a,b)=>sort==='recent'?Date.parse(b.lastSeenAt||b.joinedAt)-Date.parse(a.lastSeenAt||a.joinedAt):sort==='attention'?Number(b.needsAttention)-Number(a.needsAttention)||a.step-b.step:sort==='joined'?Date.parse(a.joinedAt)-Date.parse(b.joinedAt):a.step-b.step||Date.parse(a.joinedAt)-Date.parse(b.joinedAt));
  return <section className="telemetry-panel" aria-labelledby="progress-title">
    <div className="telemetry-heading"><div><p className="eyebrow">Live facilitation</p><h2 id="progress-title">Where is everyone?</h2></div><p>{telemetry.recent} seen in the last 90 seconds</p></div>
    <div className="telemetry-stats">{[['Joined',snapshot.total],['Connected',telemetry.connected],['Waiting for a phase',telemetry.waiting],['Finished',telemetry.finished],['Needs attention',telemetry.needsAttention]].map(([label,value])=><div key={label} className={label==='Needs attention'&&Number(value)>0?'attention':''}><strong>{value}</strong><span>{label}</span></div>)}</div>
    <div className="ai-room" aria-label="AI choices in the room"><h3>AI in the room</h3><div>{[...AI_TOOLS,'Not chosen yet'].map(tool=><div key={tool}><strong>{telemetry.participants.filter(p=>tool==='Not chosen yet'?!p.aiTool:p.aiTool===tool).length}</strong><span>{tool}</span></div>)}</div></div>
    <div className="flow-grid" aria-label="Participants by current screen">{FLOW_STEPS.map((label,i)=><button key={label} aria-label={`Show participants: ${label}`} aria-pressed={step===i} className={step===i?'selected':''} onClick={()=>setStep(step===i?null:i)}><span>{label}</span><strong>{telemetry.steps[i]}</strong><span className="flow-track"><i style={{width:`${100*telemetry.steps[i]/Math.max(1,snapshot.total)}%`}}/></span></button>)}</div>
    <div className="telemetry-toolbar"><label>Find a participant<input className="field" placeholder="Builder reference" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Status<select className="field" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Everyone</option><option value="attention">Needs attention</option><option value="waiting">Waiting for a phase</option><option value="finished">Finished</option><option value="away">Away / disconnected</option></select></label><label>Sort by<select className="field" value={sort} onChange={e=>setSort(e.target.value)}><option value="flow">Position in flow</option><option value="attention">Needs attention first</option><option value="recent">Recently active</option><option value="joined">Join order</option></select></label>{step!==null&&<button className="clear-filter" onClick={()=>setStep(null)}>Clear {FLOW_STEPS[step]} filter ×</button>}</div>
    <div className="telemetry-table-wrap"><table className="telemetry-table"><caption>{rows.length} of {snapshot.total} participants{step!==null?` · ${FLOW_STEPS[step]}`:''}</caption><thead><tr><th>Participant</th><th>Current screen</th><th>Connection & activity</th><th>Saves</th><th>Checkpoints</th></tr></thead><tbody>{rows.map(p=><tr key={p.id} className={p.needsAttention?'needs-attention':''}><th scope="row">{p.label}<small>{p.aiTool||'AI not chosen yet'}</small><small>{p.sharing?'Sharing enabled':'Private builds'}</small></th><td><b>{FLOW_STEPS[p.step]}</b><small>{p.reported?`${duration(p.stepStartedAt,now)} on this screen`:'Last saved screen · refresh phone for live detail'}</small>{p.waitingForPhase!==null&&<span className="telemetry-badge waiting">Waiting for {PHASES[p.waitingForPhase]}</span>}</td><td><span className={`telemetry-badge ${p.connected?'connected':'away'}`}>{presence(p)}</span><small>{p.lastSeenAt?`Seen ${duration(p.lastSeenAt,now)} ago`:'No activity report yet'}</small></td><td><span className={p.syncStatus==='error'?'save-error':''}>{saveStatus(p)}</span>{p.pendingSaves>0&&<small>Pending for {duration(p.pendingSince,now)}</small>}{p.syncStatus&&<small>{p.recent?'':'Last reported status'}</small>}</td><td><div className="checkpoints">{[['Before',p.answeredBefore],['Brick photo',p.photos?.pile??null],['AI handoff',p.handedOff],['Build photo',p.photos?.build??null],['Concept photo',p.photos?.concept??null],['Concept ready',p.cardReady],['Card submitted',p.cardSubmitted],['After',p.answeredAfter]].map(([label,done])=><span key={String(label)} className={done?'done':''}>{done?'✓':done===null?'?':'—'} {label}</span>)}</div></td></tr>)}</tbody></table>{rows.length===0&&<p className="telemetry-empty">{snapshot.total===0?'People will appear here as they join.':'No participants match these filters.'}</p>}</div>
    <p className="telemetry-note">Screen and photo readiness are reported by each phone; photo contents and private notes stay private. “In background” may mean someone is using their AI app. A long build or development step alone is not marked as a problem.</p>
  </section>;
}
