import {useRef,useState,type ReactNode} from 'react';
import {hasTimer,roundMinutes,WORKSHOP_NAME,type Snapshot} from '../server/model';
import {RoundClock} from './round-clock';
import {Button} from './ui';
import {stageCue} from './workshop-flow';
import './facilitator.css';

const stages=['Lobby','AI plan','Build','Reflect','Develop','Concept cards','Debrief'];
const activityGroups=[
  {label:'Joined',steps:[0,1]}, {label:'Getting instructions',steps:[2,3]},
  {label:'Building',steps:[4]}, {label:'Capture & reflect',steps:[5]},
  {label:'Developing',steps:[6]}, {label:'Concept card',steps:[7]},
  {label:'Final reflection',steps:[8]}, {label:'Finished',steps:[9]},
];
const tools=[
  ['join','Join QR'], ['participants','Participants'], ['screen','Big screen'],
  ['results','Results'], ['media','Images'], ['session','Session'],
] as const;
type Tool=typeof tools[number][0];
type Props={
  snapshot:Snapshot;
  connected:boolean;
  error:string;
  busy:boolean;
  next:{label:string;patch:Record<string,unknown>}|null;
  progress:string;
  facilitatorNote?:string;
  control:(patch:Record<string,unknown>)=>Promise<void>;
  panels:Record<Tool,ReactNode>;
};

export function FacilitatorDesk({snapshot,connected,error,busy,next,progress,facilitatorNote,control,panels}:Props){
  const {session,telemetry,total}=snapshot,cue=stageCue(session);
  const [tool,setTool]=useState<Tool>('session'),[toolsOpen,setToolsOpen]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const toolsBody=useRef<HTMLDivElement>(null);
  const counts=telemetry?.steps||snapshot.progress;
  function selectTool(section:Tool){
    setTool(section);
    if(toolsBody.current)toolsBody.current.scrollTop=0;
  }
  function openTools(section:Tool){
    selectTool(section);
    setToolsOpen(true);
    dialog.current?.showModal();
  }
  const status=error||(!connected?'Reconnecting':session.closed?'Session closed':'Live');
  return <div className="host-desk">
    <header className="desk-header">
      <div className="desk-brand"><span aria-hidden="true" className="desk-brand-mark"/><div><p>{session.title===WORKSHOP_NAME?'Facilitator':`${WORKSHOP_NAME} · Facilitator`}</p><h1>{session.title}</h1></div></div>
      <div className="desk-header-actions">
        <p className={`desk-status${error||!connected?' warning':''}`} role="status" title={status}><i aria-hidden="true"/>{status}</p>
        <p className="desk-code"><span>Room code</span><strong>{session.code}</strong></p>
        <Button onClick={()=>openTools('join')}>Join QR</Button>
        <Button onClick={()=>openTools('session')}>Room tools</Button>
      </div>
    </header>
    <nav className="desk-stages" aria-label="Workshop stages">
      {stages.map((label,i)=><button type="button" key={label} aria-current={session.phase===i-1?'step':undefined}
        disabled={busy||session.closed||session.phase===i-1} onClick={()=>void control({phase:i-1})}>{label}</button>)}
    </nav>
    <main className="desk-main">
      <section className="desk-panel desk-current" aria-labelledby="desk-now">
        <div className="desk-current-top">
          <div><p className="desk-label">Now</p><h2 id="desk-now">{cue.title}</h2></div>
          <RoundClock session={session} compact/>
        </div>
        <ol className="desk-cues">{cue.steps.map(line=><li key={line}>{line}</li>)}</ol>
        {progress&&<p className="desk-progress" role="status">{progress}</p>}
        {facilitatorNote&&<p className="desk-note">{facilitatorNote}</p>}
        <div className="desk-current-actions">
          {hasTimer(session)&&!session.closed&&<div className="desk-timer-actions">
            <Button disabled={busy} onClick={()=>void control({timer:session.remainingMs!==null?'resume':'pause'})}>{session.remainingMs!==null?'Resume timer':'Pause timer'}</Button>
            <Button disabled={busy} onClick={()=>void control({timer:'extend'})}>+1 minute</Button>
            {roundMinutes(session)&&<Button disabled={busy} onClick={()=>void control({timer:'reset'})}>Restart timer</Button>}
          </div>}
          {next&&!session.closed&&<div className="desk-next"><span className="desk-label">Next</span><Button solid disabled={busy} onClick={()=>void control(next.patch)}>{next.label}<span aria-hidden="true">→</span></Button></div>}
        </div>
      </section>
      <section className="desk-panel desk-room" aria-labelledby="desk-room">
        <div className="desk-room-heading"><h2 id="desk-room">Room progress</h2><strong>{total} joined</strong></div>
        <dl className="desk-metrics">
          <div><dt>Connected</dt><dd>{telemetry?.connected??0}</dd></div>
          <div><dt>Waiting</dt><dd>{telemetry?.waiting??0}</dd></div>
          <div className={telemetry?.needsAttention?'warning':undefined}><dt>Needs attention</dt><dd>{telemetry?.needsAttention??0}</dd></div>
        </dl>
        {total?<ul className="desk-distribution" aria-label="Where people are in the workshop">
          {activityGroups.map(({label,steps})=>{
            const count=steps.reduce((sum,step)=>sum+(counts[step]||0),0);
            return <li key={label}><span>{label}</span><meter min={0} max={total} value={count} aria-label={label}/><strong>{count}</strong></li>;
          })}
        </ul>:<p className="desk-empty">Waiting for participants to join.</p>}
        <div className="desk-room-actions"><Button onClick={()=>openTools('participants')}>Participant details</Button></div>
      </section>
    </main>
    <dialog ref={dialog} className="desk-tools" aria-labelledby="desk-tools-heading" onClose={event=>{
      if(event.target===event.currentTarget&&!event.currentTarget.open)setToolsOpen(false);
    }}>
      <header><h2 id="desk-tools-heading">Room tools</h2><Button onClick={()=>dialog.current?.close()}>Close</Button></header>
      <nav aria-label="Room tool sections">
        {tools.map(([section,label])=><button key={section} type="button" aria-pressed={section===tool} onClick={()=>selectTool(section)}>{label}</button>)}
      </nav>
      <div className="desk-tools-body" ref={toolsBody}>{toolsOpen&&panels[tool]}</div>
    </dialog>
  </div>;
}
