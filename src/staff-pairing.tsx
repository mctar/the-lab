import {useRef,useState,type FormEvent} from 'react';
import {request} from './client';
import {staffUrl,type StaffRole} from './staff-routes';
import {Button,Shell} from './ui';
import './staff-pairing.css';

type PairedBrowser={id:string;token:string;reusable:boolean};
type PairingCode={code:string;expiresAt:string};

export function StaffSignIn({role,onPaired,error}:{role:StaffRole;onPaired:(room:PairedBrowser)=>void;error?:string}){
  const [code,setCode]=useState(''),[notice,setNotice]=useState(error||''),[busy,setBusy]=useState(false);
  const claim=useRef<string>(null);
  const host=role==='host';

  async function pair(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setNotice('');
    try{
      claim.current??=crypto.randomUUID();
      const room=await request<PairedBrowser>('/v1/staff/pair','',{code,role,claim:claim.current});
      onPaired(room);
    }catch(e){setNotice((e as Error).message);}
    finally{setBusy(false);}
  }

  return <Shell><section className="staff-sign-in">
    <h1>{host?'Facilitator':'Big screen'}</h1>
    <p>{host?'Enter a facilitator pairing code from a signed-in dashboard, or open your private facilitator link.':'On the facilitator dashboard, choose Connect a Mac and enter the big-screen code here.'}</p>
    <form onSubmit={pair}>
      <label>Staff pairing code<input className="field" value={code} onChange={event=>setCode(event.target.value.toUpperCase())}
        placeholder="XXXXX-XXXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} required maxLength={32}/></label>
      <button className="pill solid" disabled={busy}>{busy?'Connecting…':'Connect this browser'}</button>
    </form>
    {notice&&<p className="error" role="alert">{notice}</p>}
  </section></Shell>;
}

export function PairingPanel({base,id,token,projectorsOnline}:{base:string;id:string;token:string;projectorsOnline:number}){
  const [role,setRole]=useState<StaffRole>('stage');
  const [pairing,setPairing]=useState<PairingCode|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const pairPage=new URL(staffUrl(base,role));
  pairPage.hash='/pair';

  async function generate(){
    setBusy(true);setPairing(null);setNotice('');
    try{setPairing(await request<PairingCode>(`/v1/sessions/${id}/pairing`,token,{role}));}
    catch(e){setNotice((e as Error).message);}
    finally{setBusy(false);}
  }
  async function copy(){
    if(!pairing)return;
    try{await navigator.clipboard.writeText(pairing.code);setNotice('Code copied.');}
    catch{setNotice('Select and copy the code above.');}
  }

  return <section className="staff-pairing">
    <p>{projectorsOnline? `${projectorsOnline} big-screen ${projectorsOnline===1?'tab connected':'tabs connected'} to this room.`:'No big-screen tab connected to this room.'}</p>
    <fieldset>
      <legend>What will the other Mac do?</legend>
      <div className="row">
        <button type="button" className="pill" aria-pressed={role==='stage'} disabled={busy} onClick={()=>{setRole('stage');setPairing(null);setNotice('');}}>Show the big screen</button>
        <button type="button" className="pill" aria-pressed={role==='host'} disabled={busy} onClick={()=>{setRole('host');setPairing(null);setNotice('');}}>Facilitate</button>
      </div>
    </fieldset>
    <p>On the other Mac, open <a href={pairPage.href} target="_blank" rel="noreferrer">{pairPage.host}{pairPage.pathname}{pairPage.hash}</a> and enter the pairing code. Each code connects one browser and expires after 10 minutes.</p>
    {!pairing&&<div><Button solid disabled={busy} onClick={()=>void generate()}>{busy?'Creating code…':'Create pairing code'}</Button></div>}
    {pairing&&<div className="staff-pairing-code">
      <strong aria-label="Pairing code">{pairing.code}</strong>
      <div className="row"><Button onClick={()=>void copy()}>Copy code</Button><Button onClick={()=>void generate()}>New code</Button></div>
      <p>Expires at {new Date(pairing.expiresAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</p>
    </div>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
