import { useEffect, useRef, useState } from 'react';
import { requiredFlow, revisedFlow, type Session } from '../server/model';

export function RoundClock({session,compact=false}:{session:Session;compact?:boolean}){
  const [now,setNow]=useState(Date.now);
  const anchor=useRef({time:session.serverTime,received:Date.now()});
  if(anchor.current.time!==session.serverTime)anchor.current={time:session.serverTime,received:Date.now()};
  const running=session.endsAt!==null&&!session.closed;
  useEffect(()=>{
    if(!running)return;
    const tick=()=>setNow(Date.now());
    tick();
    const timer=setInterval(tick,250);
    document.addEventListener('visibilitychange',tick);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
  },[running]);
  if(session.closed)return null;
  const paused=session.remainingMs!==null;
  const serverNow=Date.parse(anchor.current.time)+Math.max(0,now-anchor.current.received);
  const remaining=paused?session.remainingMs:session.endsAt?Date.parse(session.endsAt)-serverNow:null;
  if(remaining===null)return null;
  const seconds=Math.max(0,Math.ceil(remaining/1000));
  const round:Partial<Record<number,string>>={0:requiredFlow(session)?'Get your AI instructions':'Get a plan',1:'Build',2:session.exchange?'Neighbour exchange':'Reflection',3:'Make it yours',5:'Final neighbour exchange'};
  const label=`${round[session.phase]||'Round'} · ${paused?'paused':seconds===0?'time is up':'time remaining'}`;
  const handoffCue=revisedFlow(session)&&session.phase===0&&seconds<=60&&!paused;
  return <div className={`round-clock${compact?' compact':''}${seconds<=30?' ending':''}`}>
    <span aria-live="polite">{label}</span>
    <strong role="timer" aria-label={label}>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</strong>
    {handoffCue&&<small className="round-clock-cue" role="status">If your AI is still working, you can build from today’s prompt.</small>}
  </div>;
}
