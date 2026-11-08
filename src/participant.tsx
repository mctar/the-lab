import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CARD_PHASE, INSTRUCTION_EASE, PHASES, SCALE, hasTimer, participantLabel, type Answers, type Participant, type Session } from '../server/model';
import { request, Workshop, photograph, type Identity } from './client';
import { AIChoice } from './ai-choice';
import { Button, Shell, useLive } from './ui';
import { RoundClock } from './round-clock';
import { REFLECTION_PROMPTS, STAGE_STEPS, WORKSHOP_BRIEF } from './workshop-flow';
import { useActivityReport } from './telemetry';
import './participant.css';

const buildPrompt=`${WORKSHOP_BRIEF}\n\nUse the loose LEGO bricks in the attached photo to propose one playful concept. Give it a name and explain it in one sentence. Then give me a short, numbered build plan using the pieces you can see. Say when you are unsure about a piece and suggest a substitution. If you can, show what the build could look like.`;

function Poll({value,onChange,label}:{value:number|undefined;onChange:(value:number)=>void;label:string}){
  return <div className="brick-poll" role="group" aria-label={label}>{SCALE.map(([name,description],i)=><button type="button" key={name} aria-pressed={value===i} onClick={()=>onChange(i)}><strong>{description}</strong><span>{name}</span></button>)}</div>;
}

export function Join(){
  const params=new URLSearchParams(location.hash.split('?')[1]||'');
  const initialCode=params.get('code')||'';
  const [code,setCode]=useState(initialCode);
  const showCode=initialCode.length<6;
  const [aiTool,setAiTool]=useState<Answers['aiTool']>(),[share,setShare]=useState(false),[before,setBefore]=useState<number>();
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const previous=localStorage.getItem('bwt:last');

  async function join(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy)return;
    if(!aiTool){setError('Choose the AI app you’ll use.');return;}
    setError('');setBusy(true);
    try{
      const room=code.trim().toUpperCase(),key='bwt:join:'+room;
      let joinKey=localStorage.getItem(key);
      if(!joinKey){joinKey=crypto.randomUUID();localStorage.setItem(key,joinKey);}
      const result=await request<{session:Session;participant:Participant;token:string}>('/v1/join','',{code:room,joinKey,aiTool,share,before});
      const identity={id:result.session.id,...result};
      localStorage.setItem('bwt:identity:'+identity.id,JSON.stringify(identity));
      localStorage.setItem('bwt:last',identity.id);
      location.hash='/session/'+identity.id;
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }

  return <div className="brick-mobile brick-join"><main className="brick-pane">
    <p className="brick-kicker">Brick · Builders with Taste</p>
    <h1>Join the workshop</h1>
    <p className="brick-lede">Have your LEGO bricks and your AI app ready.</p>
    {params.get('reset')==='1'&&<p className="brick-note" role="status">The facilitator started a fresh round. Join again to begin.</p>}
    <form onSubmit={join}>
      {showCode?<label className="brick-field">Room code<input className="field" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" minLength={6} maxLength={12} required/></label>:<p className="brick-room-code">Room <strong>{code}</strong></p>}
      <AIChoice value={aiTool} onChange={setAiTool} disabled={busy}/>
      <label className="brick-consent"><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)}/><span>Allow me to share my builds on the big screen. <small>You choose what to send.</small></span></label>
      <details className="brick-details"><summary>Optional opening question</summary><p>How do you usually work with AI?</p><Poll label="How do you usually work with AI?" value={before} onChange={setBefore}/></details>
      {error&&<p className="brick-error" role="alert">{error}</p>}
      <button className="pill solid brick-primary" disabled={busy}>{busy?'Joining…':'Join the workshop'}</button>
    </form>
    {previous&&<a className="brick-return" href={'#/session/'+previous}>Return to my workshop</a>}
  </main></div>;
}

function Photo({value,label,onChange,disabled=false}:{value:string;label:string;onChange:(value:string)=>void;disabled?:boolean}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function choose(input:HTMLInputElement){
    const file=input.files?.[0];if(!file)return;
    setBusy(true);setError('');
    try{onChange(await photograph(file));}
    catch(e){setError((e as Error).message);}
    finally{input.value='';setBusy(false);}
  }
  return <div className="photo capture brick-photo" role="group" aria-label={label}>
    {value&&<img src={value} alt={label}/>}
    <div className="photo-actions">
      <label className="pill" aria-disabled={busy||disabled}>{value?'Take another photo':'Take a photo'}<input type="file" data-source="camera" aria-label={`Take a photo: ${label}`} accept="image/*" capture="environment" disabled={busy||disabled} onChange={e=>void choose(e.currentTarget)}/></label>
      <label className="pill" aria-disabled={busy||disabled}>Choose from camera roll<input type="file" data-source="library" aria-label={`Choose from camera roll: ${label}`} accept="image/*" disabled={busy||disabled} onChange={e=>void choose(e.currentTarget)}/></label>
    </div>
    {busy&&<p className="brick-note" role="status">Preparing your photo…</p>}
    {error&&<p className="brick-error" role="alert">{error}</p>}
  </div>;
}

function CopyPrompt({text}:{text:string}){
  const [status,setStatus]=useState(''),field=useRef<HTMLTextAreaElement>(null);
  async function copy(){
    try{await navigator.clipboard.writeText(text);setStatus('Prompt copied. Paste it in your AI chat.');}
    catch{field.current?.focus();field.current?.select();setStatus('Copy the selected prompt, then paste it in your AI chat.');}
  }
  return <div className="brick-copy"><textarea ref={field} className="field" aria-label="Prompt to copy" readOnly value={text} rows={3}/><Button onClick={()=>void copy()}>Copy prompt</Button>{status&&<p role="status">{status}</p>}</div>;
}

function Handoff({photo,aiName,onBack,onReady}:{photo:string;aiName:string;onBack:()=>void;onReady:(hasPlan:boolean)=>void}){
  const [manual,setManual]=useState(false),[notice,setNotice]=useState('');
  async function share(){
    try{
      // Build the file synchronously so mobile browsers keep the tap that opens the share sheet.
      const contents=Uint8Array.from(atob(photo.split(',')[1]),char=>char.charCodeAt(0));
      const file=new File([contents],'my-loose-bricks.jpg',{type:'image/jpeg'});
      const data={files:[file],text:buildPrompt};
      if(navigator.canShare?.(data)){
        await navigator.share(data);
        setNotice('In your AI chat, check that both the photo and prompt came through. Send them, then come back with your plan.');
      }else setManual(true);
    }catch(e){if((e as Error).name!=='AbortError')setManual(true);}
  }
  return <>
    <p className="brick-lede">Send your loose-brick photo and the brief to {aiName}. Ask it for an idea and instructions you can build.</p>
    <div className="brick-brief"><span>Today’s brief</span><strong>{WORKSHOP_BRIEF}</strong></div>
    <Button solid onClick={()=>void share()}>Send photo and prompt</Button>
    {notice&&<p className="brick-note" role="status">{notice}</p>}
    <details className="brick-details" open={manual} onToggle={event=>setManual(event.currentTarget.open)}>
      <summary>Send manually</summary>
      <p>Copy the prompt and save your loose-brick photo. In {aiName}, paste the prompt and attach the photo from Photos or Downloads.</p>
      <CopyPrompt text={buildPrompt}/>
      <a className="pill" href={photo} download="my-loose-bricks.jpg">Save loose-brick photo</a>
    </details>
    <div className="brick-next"><p>Come back here when your AI gives you a plan.</p><Button onClick={()=>onReady(true)}>I have my plan</Button></div>
    <details className="brick-details"><summary>Can’t get a plan?</summary><p>You can still try a quick build using today’s brief.</p><Button onClick={()=>onReady(false)}>Continue without a plan</Button></details>
    <button className="brick-text-button" type="button" onClick={onBack}>Change my loose-brick photo</button>
  </>;
}

function ShareButton({w,kind,disabled,onError}:{w:Workshop;kind:'build'|'concept';disabled?:boolean;onError:(message:string)=>void}){
  const pending=w.publishing(kind),sent=kind==='build'?w.draft.buildSent:w.draft.sent;
  return <div className="brick-share">
    <Button disabled={disabled||pending||sent||w.blocked} onClick={()=>void w.publish(kind,true).catch(e=>onError(e.message))}>{pending?'Sending to the big screen…':sent?'Shared on the big screen':'Share on the big screen'}</Button>
    {(pending||sent)&&<p role="status">{pending?'You can continue while Brick sends it.':'Your facilitator can show it on the wall.'}</p>}
  </div>;
}

export function ParticipantApp({id}:{id:string}){
  const [workshop,setWorkshop]=useState<Workshop|null>(null),[,redraw]=useState(0),[error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    try{
      const identity=JSON.parse(localStorage.getItem('bwt:identity:'+id)||'null') as Identity|null;
      if(!identity){setError('Join the session on this phone first.');return;}
      const w=new Workshop(identity);
      w.onReset=()=>{
        const key='bwt:identity:'+id,current=JSON.parse(localStorage.getItem(key)||'null');
        if(current?.participant?.id===identity.participant.id){localStorage.removeItem(key);if(localStorage.getItem('bwt:last')===id)localStorage.removeItem('bwt:last');}
        if(!cancelled)location.hash='/join?code='+encodeURIComponent(identity.session.code)+'&reset=1';
      };
      w.onChange=()=>{if(!cancelled)redraw(n=>n+1);};
      void w.init().then(()=>{if(!cancelled&&!w.reset)setWorkshop(w);}).catch(()=>{if(!cancelled)setError('Your workshop draft could not be opened.');});
    }catch{setError('This session could not be restored. Join again.');}
    return()=>{cancelled=true;};
  },[id]);
  return error?<Shell><h1>Find your room</h1><p>{error}</p><a className="pill solid" href="#/join">Join a session</a></Shell>:workshop?<ParticipantFlow w={workshop}/>:<Shell><p>Opening your workshop…</p></Shell>;
}

const nextAfterWaiting:Partial<Record<number,number>>={3:4,5:6,6:7,7:8};

function ParticipantFlow({w}:{w:Workshop}){
  const [notice,setNotice]=useState('');
  const online=useLive(w.identity.id,w.identity.token,()=>{void w.refresh().catch(()=>{});void w.flush();});
  const {draft:d,identity:{session:s,participant}}=w,a=d.answers;
  // Older drafts that were on the opening question can start by photographing their bricks.
  const step=d.step===1?2:d.step===3&&!d.pilePhoto?2:d.step;
  const next=nextAfterWaiting[step];
  const waitingFor=next!==undefined&&d.waitingForPhase===CARD_PHASE[next]?d.waitingForPhase:null;
  const aiName=a.aiTool&&a.aiTool!=='Something else'?a.aiTool:'your AI app';
  const reflectionOpen=s.phase>2||s.phase===2&&hasTimer(s);
  const phaseForStep=CARD_PHASE[step];
  const blockedPhase=phaseForStep>s.phase?phaseForStep:waitingFor!==null&&waitingFor>s.phase?waitingFor:null;
  const capture=step===5&&!d.buildCaptured;
  const reflectWaiting=step===5&&d.buildCaptured&&!reflectionOpen;
  const ready=d.name.trim()!==''&&d.what.trim()!=='';
  const pageRef=useRef<HTMLElement>(null);
  useActivityReport(w);

  function save(patch:Answers){void w.patch(patch).catch(e=>setNotice(e.message));}
  function move(target:number){
    setNotice('');w.edit({step:target,waitingForPhase:null});save({progress:target});
  }
  function advance(target:number){
    if(CARD_PHASE[target]>s.phase){w.edit({waitingForPhase:CARD_PHASE[target]});return;}
    move(target);
  }
  useEffect(()=>{
    const timer=setInterval(()=>void w.flush(),2500+Math.random()*4000);
    return()=>clearInterval(timer);
  },[w]);
  useEffect(()=>{
    if(s.closed||w.reset)return;
    if(step===0&&a.aiTool&&s.phase>=0)move(2);
    else if(step===4&&s.phase>=2)move(5);
    else if(next!==undefined&&waitingFor!==null&&waitingFor<=s.phase)move(next);
  },[w,step,s.phase,s.closed,a.aiTool,next,waitingFor]);
  useEffect(()=>{
    window.scrollTo(0,0);
    pageRef.current?.querySelector('h1')?.focus({preventScroll:true});
  },[step,blockedPhase,capture,reflectWaiting]);

  let title:string,content:ReactNode;
  if(s.closed&&step!==9){title='Workshop complete';content=<p className="brick-lede">The session is closed. Your photos and draft are still on this phone.</p>;}
  else if(blockedPhase!==null||reflectWaiting||step===0&&s.phase<0){
    const label=reflectWaiting?'Reflection':blockedPhase===null?'Get a build plan':PHASES[blockedPhase];
    title=step===0?'You’re in':'Your work is saved';
    content=<><p className="brick-lede">Look at the big screen. Your facilitator will open the next step.</p><p className="brick-wait" role="status">Next: {label}</p>{step===0&&!a.aiTool&&<AIChoice value={a.aiTool} onChange={aiTool=>save({aiTool})}/>}</>;
  }else if(step===0){
    title='Choose your AI app';content=<AIChoice value={a.aiTool} onChange={aiTool=>save({aiTool})}/>;
  }else if(step===2){
    title='Photograph your loose bricks';
    content=<><p className="brick-lede">Spread the pieces out and take one photo from above. You’ll send this photo to {aiName} for a build plan.</p><Photo value={d.pilePhoto} label="Your loose bricks" onChange={pilePhoto=>w.edit({pilePhoto,handedOff:false})}/>{d.pilePhoto&&<Button solid onClick={()=>move(3)}>Use this photo</Button>}</>;
  }else if(step===3){
    title='Get an AI build plan';
    content=<Handoff photo={d.pilePhoto} aiName={aiName} onBack={()=>move(2)} onReady={handedOff=>{w.edit({handedOff});advance(4);}}/>;
  }else if(step===4){
    title=d.handedOff?'Build what the AI suggests':'Try a build';
    content=<><p className="brick-lede">{d.handedOff?'Follow the plan as far as you can. If a piece is missing, use the closest one.':WORKSHOP_BRIEF}</p><p className="brick-note">When the round ends, come back here to photograph what you built.</p></>;
  }else if(capture){
    title='Photograph your build';
    content=<><p className="brick-lede">Take a photo of what you actually built. Unfinished builds count.</p><Photo value={d.buildPhoto} label="Your first build" onChange={buildPhoto=>w.edit({buildPhoto,buildSent:false})} disabled={w.publishing('build')}/>{d.buildPhoto&&<ShareButton w={w} kind="build" onError={setNotice}/>}<Button solid onClick={()=>w.edit({buildCaptured:true})}>{d.buildPhoto?'Keep photo and continue':'Continue without a photo'}</Button></>;
  }else if(step===5){
    title='Reflect on the first build';
    content=<><p className="brick-lede">Think about the idea you got and what happened when you tried it.</p>
      <label className="brick-field">{REFLECTION_PROMPTS[0]}<input className="field" placeholder="One sentence is enough" value={d.aiConcept} maxLength={240} onChange={e=>w.edit({aiConcept:e.target.value})}/></label>
      <fieldset className="brick-options"><legend>{REFLECTION_PROMPTS[1]}</legend><div>{INSTRUCTION_EASE.map(option=><button type="button" key={option} aria-pressed={a.instructionEase===option} onClick={()=>save({instructionEase:option})}>{option}</button>)}</div></fieldset>
      <label className="brick-field">{REFLECTION_PROMPTS[2]}<textarea className="field" rows={2} value={d.decided} maxLength={1000} onChange={e=>w.edit({decided:e.target.value})}/></label>
      <p className="brick-note">Your written notes stay on this phone.</p><Button solid onClick={()=>advance(6)}>Finish this reflection</Button>
      <button type="button" className="brick-text-button" onClick={()=>w.edit({buildCaptured:false})}>Review my build photo</button></>;
  }else if(step===6){
    title='Make it yours';
    const prompt=`Help me take the concept from our earlier chat in a direction I choose.${d.aiConcept.trim()?' The starting idea: '+d.aiConcept.trim()+'.':''}${d.decided.trim()?' The first thing I want to change: '+d.decided.trim()+'.':''} Ask me who it should help and what experience I want to create. It could be a game, a ritual, an experience, or something else. Suggest options and let me choose.`;
    content=<><p className="brick-lede">Return to the same chat in {aiName}. Tell it what you want to change and develop the idea in your own direction.</p><p>You can turn it into a game, an experience, or anything else. You can leave your bricks as they are.</p>{d.decided&&<div className="brick-brief"><span>Your first change</span><strong>{d.decided}</strong></div>}<details className="brick-details"><summary>Stuck?</summary><p>Try this prompt in the same AI chat.</p><CopyPrompt text={prompt}/></details><Button solid onClick={()=>advance(7)}>My concept is ready</Button></>;
  }else if(step===7){
    title='Make a concept card';
    content=<><p className="brick-lede">Give your developed idea a name and describe it in one sentence.</p>
      <label className="brick-field">Concept name<input className="field" value={d.name} maxLength={100} onChange={e=>w.edit({name:e.target.value,sent:false})}/></label>
      <label className="brick-field">What is it?<textarea className="field" rows={2} value={d.what} maxLength={600} onChange={e=>w.edit({what:e.target.value,sent:false})}/></label>
      <details className="brick-details" open={d.conceptPhoto||d.mine?true:undefined}><summary>Add an image or a detail (optional)</summary>
        <p>You can save an image from your AI chat and choose it from your camera roll.</p><Photo value={d.conceptPhoto} label="Concept image" onChange={conceptPhoto=>w.edit({conceptPhoto,sent:false})} disabled={w.publishing('concept')}/>
        <label className="brick-field">What did you change?<input className="field" value={d.mine} maxLength={240} onChange={e=>w.edit({mine:e.target.value,sent:false})}/></label>
      </details>
      {ready&&<ShareButton w={w} kind="concept" onError={setNotice}/>}
      <Button solid onClick={()=>advance(8)}>{ready?'Save card and continue':'Continue to final reflection'}</Button></>;
  }else if(step===8){
    title='Final reflection';
    content=<><p className="brick-lede">When did you follow the AI? When did you make the decisions? Share one thing you noticed with the room.</p><details className="brick-details"><summary>Optional closing question</summary><p>How did you work with AI in this exercise?</p><Poll label="How did you work with AI in this exercise?" value={a.after} onChange={after=>save({after})}/></details><Button solid onClick={()=>move(9)}>Finish workshop</Button></>;
  }else{
    title='You made it yours';
    content=<><p className="brick-lede">Thanks for building.</p>{w.publishing('concept')&&<p className="brick-note" role="status">Your concept card is waiting to send.</p>}{ready&&<><article className="brick-concept-print"><h2>{d.name}</h2>{d.conceptPhoto&&<img src={d.conceptPhoto} alt={d.name}/>}<p>{d.what}</p>{d.mine&&<p>{d.mine}</p>}</article><Button onClick={()=>window.print()}>Print or save my card as PDF</Button></>}</>;
  }

  const milestone=step===0?0:step<=3?1:step===4?2:step===5?3:step<=7?4:5;
  const showClock=step!==9&&s.phase>=1&&s.phase<=3;
  return <div className="brick-mobile">
    <header className="brick-top"><strong>Brick</strong><span>{milestone+1} / {STAGE_STEPS.length} · {STAGE_STEPS[milestone]}</span><details className="session-menu"><summary aria-label="Session settings">•••</summary><div className="session-menu-panel"><p className="participant-reference">{participantLabel(participant.id)}</p><AIChoice value={a.aiTool} onChange={aiTool=>save({aiTool})} disabled={s.closed}/><label className="brick-consent"><input type="checkbox" checked={!!a.share} onChange={e=>save({share:e.target.checked})} disabled={s.closed&&!a.share}/><span>Allow sharing on the big screen</span></label><p className="small">Turning this off removes your builds and cards from the wall.</p></div></details></header>
    <main className="brick-pane" ref={pageRef}>
      <h1 tabIndex={-1}>{title}</h1>
      {showClock&&<RoundClock session={s}/>}
      {content}
      {notice&&<p className="brick-error" role="alert">{notice}</p>}
      <div className="brick-save" role="status">{w.message||(w.jobs.length?'Saved on this phone · sending when connected':online?'Saved':'Saved on this phone')}{w.message&&<Button onClick={()=>void w.retry()}>{w.blocked?'Reconnect':'Retry now'}</Button>}</div>
    </main>
  </div>;
}
