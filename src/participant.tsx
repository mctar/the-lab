import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CARD_PHASE, CHANGE_CHOICES, CHANGE_QUESTION, FIRST_IDEA_LIMIT, IDEA_LIKING, INSTRUCTION_EASE, INSTRUCTION_EASE_CHOICES, PHASES, SCALE, WORKSHOP_NAME, buildFirstFlow, hasTimer, participantLabel, requiredFlow, revisedFlow, type Answers, type CardKind, type Participant, type Session } from '../server/model';
import { request, Workshop, photograph, type Draft, type Identity } from './client';
import { AIChoice } from './ai-choice';
import { Button, Shell, useLive } from './ui';
import { RoundClock } from './round-clock';
import { IDEA_LIKING_QUESTION, REFLECTION_PROMPTS, STAGE_STEPS, WORKSHOP_BRIEF, WORKSHOP_PROMPT_LABEL } from './workshop-flow';
import { useActivityReport } from './telemetry';
import './participant.css';

const buildPrompt=`${WORKSHOP_BRIEF}

Use the loose LEGO bricks in the attached photo to propose one playful concept. Give it a name and explain it in one sentence.

Create a step-by-step visual build plan using the pieces in the photo. Include one numbered illustration or diagram per step. Show which pieces to add and exactly where they connect. End with a view of the finished build. If you’re unsure about a piece, say so and suggest a substitute from the photo.`;

function Poll({value,onChange,label}:{value:number|undefined;onChange:(value:number)=>void;label:string}){
  return <div className="brick-poll" role="group" aria-label={label}>{SCALE.map(([name,description],i)=><button type="button" key={name} aria-pressed={value===i} onClick={()=>onChange(i)}><strong>{description}</strong><span>{name}</span></button>)}</div>;
}

function PrivacyNotice(){
  return <details className="brick-details">
    <summary>Privacy and publication</summary>
    <p>Gervi Labs stores what you submit to The Lab on its own server, Hugin. We use workshop activity and answers to run and document the session. Raw submissions are kept for up to 90 days after you join.</p>
    <p>We use uploaded media only to document this experiment. You can take part with either or both sharing choices off.</p>
    <p>Approved images can appear while the write-up is online. To withdraw permission or ask about your data, contact <a href="mailto:human@gervi.ai">human@gervi.ai</a>.</p>
  </details>;
}

export function Join({previewCode}:{previewCode?:string}={}){
  const params=new URLSearchParams(location.hash.split('?')[1]||'');
  const initialCode=previewCode??params.get('code')??'';
  const [code,setCode]=useState(initialCode);
  const showCode=initialCode.length<6;
  const [aiTool,setAiTool]=useState<Answers['aiTool']>(),[share,setShare]=useState(false),[writeup,setWriteup]=useState(false);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const previous=previewCode?null:localStorage.getItem('bwt:last');
  const Pane=previewCode?'div':'main';

  async function join(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||previewCode)return;
    if(!aiTool){setError('Choose the AI app you’ll use.');return;}
    setError('');setBusy(true);
    try{
      const room=code.trim().toUpperCase(),key='bwt:join:'+room;
      let joinKey=localStorage.getItem(key);
      if(!joinKey){joinKey=crypto.randomUUID();localStorage.setItem(key,joinKey);}
      const result=await request<{session:Session;participant:Participant;token:string}>('/v1/join','',{code:room,joinKey,aiTool,share,writeup});
      const identity={id:result.session.id,...result};
      localStorage.setItem('bwt:identity:'+identity.id,JSON.stringify(identity));
      localStorage.setItem('bwt:last',identity.id);
      location.hash='/session/'+identity.id;
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }

  return <div className="brick-mobile brick-join"><Pane className="brick-pane">
    <p className="brick-kicker">{WORKSHOP_NAME}</p>
    <h1>Join the workshop</h1>
    <p className="brick-lede">Have your LEGO bricks and your AI app ready.</p>
    {params.get('reset')==='1'&&<p className="brick-note" role="status">The facilitator started a fresh round. Join again to begin.</p>}
    <form onSubmit={join}>
      {showCode?<label className="brick-field">Room code<input className="field" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" minLength={6} maxLength={12} required/></label>:<p className="brick-room-code">Room <strong>{code}</strong></p>}
      <AIChoice value={aiTool} onChange={setAiTool} disabled={busy}/>
      <label className="brick-consent"><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)}/><span>I give permission to show my submitted ideas and images on the big screen.</span></label>
      <label className="brick-consent"><input type="checkbox" checked={writeup} onChange={e=>setWriteup(e.target.checked)}/><span>I give permission to publish my uploaded images in the experiment write-up on gervilabs.com.</span></label>
      <p className="brick-lede">We store workshop submissions on our own server for up to 90 days. We use uploaded media only to document this experiment.</p>
      <PrivacyNotice/>
      {error&&<p className="brick-error" role="alert">{error}</p>}
      <button className="pill solid brick-primary" disabled={busy}>{busy?'Joining…':'Join the workshop'}</button>
    </form>
    {previous&&<a className="brick-return" href={'#/session/'+previous}>Return to my workshop</a>}
  </Pane></div>;
}

function Photo({value,label,onChange,onUsePhoto,disabled=false}:{value:string;label:string;onChange:(value:string)=>void;onUsePhoto?:()=>void;disabled?:boolean}){
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
    {value&&onUsePhoto&&<Button solid onClick={onUsePhoto} disabled={busy||disabled}>Use this photo</Button>}
    <div className="photo-actions">
      <label className={onUsePhoto&&!value?'pill solid':'pill'} aria-disabled={busy||disabled}>{value?'Take another photo':'Take a photo'}<input type="file" data-source="camera" aria-label={`Take a photo: ${label}`} accept="image/*" capture="environment" disabled={busy||disabled} onChange={e=>void choose(e.currentTarget)}/></label>
      <label className="pill" aria-disabled={busy||disabled}>Choose from camera roll<input type="file" data-source="library" aria-label={`Choose from camera roll: ${label}`} accept="image/*" disabled={busy||disabled} onChange={e=>void choose(e.currentTarget)}/></label>
    </div>
    {busy&&<p className="brick-note" role="status">Preparing your photo…</p>}
    {error&&<p className="brick-error" role="alert">{error}</p>}
  </div>;
}

function CopyPrompt({text,concise=false}:{text:string;concise?:boolean}){
  const [status,setStatus]=useState(''),[manual,setManual]=useState(false),field=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{
    if(manual){field.current?.focus();field.current?.select();}
  },[manual]);
  async function copy(){
    try{await navigator.clipboard.writeText(text);setStatus('Prompt copied. Paste it in your AI chat.');}
    catch{setManual(true);field.current?.focus();field.current?.select();setStatus('Copy the selected prompt, then paste it in your AI chat.');}
  }
  return <div className="brick-copy">{(!concise||manual)&&<textarea ref={field} className="field" aria-label="Prompt to copy" readOnly value={text} rows={3}/>}<Button onClick={()=>void copy()}>{concise?'Copy my next prompt':'Copy prompt'}</Button>{status&&<p role="status">{status}</p>}</div>;
}

function Handoff({photo,aiName,onReady,onIdeaOnly}:{photo:string;aiName:string;onReady:(hasPlan:boolean)=>void;onIdeaOnly?:()=>void}){
  const [helpOpen,setHelpOpen]=useState(false),[notice,setNotice]=useState('');
  async function share(){
    try{
      // Build the file synchronously so mobile browsers keep the tap that opens the share sheet.
      const contents=Uint8Array.from(atob(photo.split(',')[1]),char=>char.charCodeAt(0));
      const file=new File([contents],'my-loose-bricks.jpg',{type:'image/jpeg'});
      const data={files:[file],text:buildPrompt};
      if(navigator.canShare?.(data)){
        await navigator.share(data);
        setNotice('Check that the photo and prompt are both in your AI chat, then send.');
      }else setHelpOpen(true);
    }catch(e){if((e as Error).name!=='AbortError')setHelpOpen(true);}
  }
  return <>
    <div className="brick-brief"><span>{WORKSHOP_PROMPT_LABEL}</span><strong>{WORKSHOP_BRIEF}</strong></div>
    <Button solid onClick={()=>void share()}>Click here to send photo + prompt</Button>
    {notice&&<p className="brick-note" role="status">{notice}</p>}
    <div className="brick-next"><p>Back from {aiName}?</p><Button onClick={()=>onReady(true)}>I have my instructions</Button>
      {onIdeaOnly&&<div className="brick-handoff-outcomes">
        <button className="brick-text-button" type="button" onClick={onIdeaOnly}>I got an idea but no instructions</button>
        <button className="brick-text-button" type="button" onClick={()=>onReady(false)}>My AI didn’t return an idea</button>
      </div>}
    </div>
    <details className="brick-details brick-handoff-help" open={helpOpen} onToggle={event=>setHelpOpen(event.currentTarget.open)}>
      <summary>Send manually</summary>
      <p>To send manually, copy the prompt and save the photo. Open {aiName}, paste the prompt and attach the photo.</p>
      <CopyPrompt text={buildPrompt}/>
      <a className="pill" href={photo} download="my-loose-bricks.jpg">Save photo</a>
      {!onIdeaOnly&&<div><button className="brick-text-button" type="button" onClick={()=>onReady(false)}>Continue without a plan</button></div>}
    </details>
  </>;
}

type FlowState=Pick<Workshop,'identity'|'draft'|'reset'|'blocked'|'key'|'jobs'|'message'|'patch'|'edit'|'publish'|'publishing'|'retry'>;

function ShareButton({w,kind,disabled,onError}:{w:FlowState;kind:'build'|'concept';disabled?:boolean;onError:(message:string)=>void}){
  const pending=w.publishing(kind),sent=kind==='build'?w.draft.buildSent:w.draft.sent;
  return <div className="brick-share">
    <Button disabled={disabled||pending||sent||w.blocked} onClick={()=>void w.publish(kind,true).catch(e=>onError(e.message))}>{pending?'Sending to the big screen…':sent?'Shared on the big screen':'Share on the big screen'}</Button>
    {(pending||sent)&&<p role="status">{pending?'You can continue while it sends.':'Your facilitator can show it on the wall.'}</p>}
  </div>;
}

function WriteupChoice({w,kind,onError}:{w:FlowState;kind:'writeup-build'|'writeup-concept';onError:(message:string)=>void}){
  const sent=kind==='writeup-build'?w.draft.buildWriteupSent:w.draft.conceptWriteupSent;
  const pending=w.publishing(kind);
  return <details className="brick-details">
    <summary>{sent?'Photo approved for the public write-up':'Public write-up (optional)'}</summary>
    <p>Give Gervi Labs permission to publish this image in the experiment write-up on gervilabs.com. This choice is separate from sharing in the room.</p>
    <Button disabled={pending||sent||w.blocked} onClick={()=>void w.publish(kind,true).catch(e=>onError(e.message))}>
      {pending?'Saving permission…':sent?'Permission saved':'Allow this image in the public write-up'}
    </Button>
    <p>To withdraw, use Session settings or email <a href="mailto:human@gervi.ai">human@gervi.ai</a>.</p>
  </details>;
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

const nextAfterWaiting:Partial<Record<number,number>>={2:4,3:4,5:6,6:7,7:8};

function ParticipantFlow({w}:{w:Workshop}){
  const online=useLive(w.identity.id,w.identity.token,()=>{void w.refresh().catch(()=>{});void w.flush();});
  useActivityReport(w);
  useEffect(()=>{
    const timer=setInterval(()=>void w.flush(),2500+Math.random()*4000);
    return()=>clearInterval(timer);
  },[w]);
  return <ParticipantScreen w={w} online={online}/>;
}

export function ParticipantScreen({w,online,preview=false}:{w:FlowState;online:boolean;preview?:boolean}){
  const [notice,setNotice]=useState(''),[submitting,setSubmitting]=useState(false);
  const {draft:d,identity:{session:s,participant}}=w,a=d.answers;
  const revised=revisedFlow(s),required=requiredFlow(s),buildFirst=buildFirstFlow(s);
  // Older drafts that were on the opening question can start by photographing their bricks.
  const step=d.step===1?2:d.step===3&&!d.pilePhoto?2:d.step;
  const next=nextAfterWaiting[step];
  const waitingFor=next!==undefined&&d.waitingForPhase===CARD_PHASE[next]?d.waitingForPhase:null;
  const aiName=a.aiTool&&a.aiTool!=='Something else'?a.aiTool:'your AI app';
  const reflectionOpen=s.phase>2||s.phase===2&&hasTimer(s);
  const phaseForStep=CARD_PHASE[step];
  const blockedPhase=phaseForStep>s.phase?phaseForStep:waitingFor!==null&&waitingFor>s.phase?waitingFor:null;
  const capture=step===5&&!d.buildCaptured;
  const captureIdea=buildFirst&&step===5&&d.buildCaptured&&!d.firstIdeaCaptured;
  const exchange=revised&&step===5&&d.buildCaptured&&s.phase===2&&s.exchange===true&&(!required||d.reflectionDone);
  const finalExchange=required&&s.phase===5&&s.stageView==='final-exchange'&&step>=8;
  const reflectWaiting=step===5&&d.buildCaptured&&!captureIdea&&!reflectionOpen;
  const ready=!!(d.name.trim()&&d.what.trim()&&(!required||d.conceptPhoto&&d.mine.trim()));
  const pageRef=useRef<HTMLElement>(null);
  const Pane=preview?'div':'main';

  function save(patch:Answers,draftPatch?:Omit<Partial<Draft>,'answers'>){void w.patch(patch,draftPatch).catch(e=>setNotice(e.message));}
  async function submit(kind:CardKind,done:()=>void){
    if(submitting||w.blocked)return;
    setSubmitting(true);
    try{await w.publish(kind);if(!w.reset)done();}
    catch(e){setNotice((e as Error).message);}
    finally{setSubmitting(false);}
  }
  function move(target:number,patch:Answers={}){
    setNotice('');save({...patch,progress:target},{step:target,waitingForPhase:null});
  }
  function recordHandoff(handoff:NonNullable<Answers['handoff']>){
    save({handoff},{handedOff:handoff==='ready'});
  }
  function openHandoff(){
    history.replaceState({workshop:w.key,photoStep:2},'');
    history.pushState({workshop:w.key,photoStep:3},'');
    move(3);
  }
  function changePilePhoto(){
    if(history.state?.workshop===w.key&&history.state.photoStep===3)history.back();
    else move(2);
  }
  function advance(target:number){
    if(CARD_PHASE[target]>s.phase){w.edit({waitingForPhase:CARD_PHASE[target]});return;}
    move(target);
  }
  useEffect(()=>{
    if(preview)return;
    function restorePhotoStep({state}:PopStateEvent){
      // History is only for the photo and handoff, and only within this participant's run.
      if(w.reset||w.identity.session.closed||w.identity.session.phase<CARD_PHASE[2])return;
      if(state?.workshop!==w.key)return;
      if(requiredFlow(w.identity.session)&&w.draft.waitingForPhase===1)return;
      if(state.photoStep===2&&w.draft.step===3)move(2);
      else if(state.photoStep===3&&w.draft.step===2&&w.draft.pilePhoto)move(3);
    }
    window.addEventListener('popstate',restorePhotoStep);
    return()=>window.removeEventListener('popstate',restorePhotoStep);
  },[w,preview]);
  useEffect(()=>{
    if(preview||s.closed||w.reset)return;
    if(buildFirst&&step<4&&s.phase>=1&&a.aiTool)move(s.phase>=2?5:4);
    else if(buildFirst&&step===6&&s.phase>=4)move(7);
    else if(step===0&&a.aiTool&&s.phase>=0)move(2);
    else if(step===4&&s.phase>=2)move(5);
    else if(exchange&&d.waitingForPhase!==3)w.edit({waitingForPhase:3});
    else if(next!==undefined&&waitingFor!==null&&waitingFor<=s.phase)move(next);
  },[w,preview,buildFirst,step,s.phase,s.closed,a.aiTool,next,waitingFor,exchange,d.waitingForPhase]);
  useEffect(()=>{
    if(preview)return;
    window.scrollTo(0,0);
    pageRef.current?.querySelector('h1')?.focus({preventScroll:true});
  },[preview,step,blockedPhase,capture,captureIdea,reflectWaiting,exchange,d.recordingPlan,finalExchange]);

  const conceptCard=<article className="brick-concept-print"><h2>{d.name}</h2>{d.conceptPhoto&&<img src={d.conceptPhoto} alt={d.name}/>}<p>{d.what}</p>{d.mine&&<p>{d.mine}</p>}</article>;
  const changeField=<label className="brick-field">{buildFirst?'I want to change…':'What would you change first?'}<input className="field" placeholder="A few words are enough" value={d.decided} maxLength={1000} onChange={e=>w.edit({decided:e.target.value})}/></label>;

  let title:string,content:ReactNode;
  if(s.closed&&step!==9){title='Workshop complete';content=<p className="brick-lede">The session is closed. Your photos and draft are still on this phone.</p>;}
  else if(finalExchange){
    title='Compare with your neighbour';
    content=<><p className="brick-lede">Show your final concept. Take one minute each to explain what changed and why.</p>{ready&&conceptCard}<p className="brick-note">Look at the big screen when time is up.</p></>;
  }
  else if(exchange){
    title='Show your neighbour';
    content=<><p className="brick-lede">Show the person next to you what you built. Take one minute each to say what you would change and hear their idea.</p>
      {buildFirst?changeField:d.decided&&<div className="brick-brief"><span>Your first change</span><strong>{d.decided}</strong></div>}
      <p className="brick-note">When the facilitator opens the next round, take the idea you want to try back to your AI chat.</p></>;
  }
  else if(blockedPhase!==null||reflectWaiting||step===0&&s.phase<0){
    const label=reflectWaiting?'Reflection':blockedPhase===null?'Get a build plan':PHASES[blockedPhase];
    title=step===0?'You’re in':required&&waitingFor===1?(d.handedOff?'Instructions received':'Ready to build'):'Your work is saved';
    content=<><p className="brick-lede">Look at the big screen. Your facilitator will open the next step.</p><p className="brick-wait" role="status">Next: {label}</p>{step===0&&!a.aiTool&&<AIChoice value={a.aiTool} onChange={aiTool=>save({aiTool})}/>}</>;
  }else if(step===0){
    title='Choose your AI app';content=<AIChoice value={a.aiTool} onChange={aiTool=>save({aiTool})}/>;
  }else if(step===2){
    title='Photograph your loose bricks';
    content=<>{!d.pilePhoto&&<p className="brick-lede">Spread the pieces out. Take one photo from above.</p>}<Photo value={d.pilePhoto} label="Your loose bricks" onChange={pilePhoto=>w.edit({pilePhoto,handedOff:false,recordingPlan:false})} onUsePhoto={openHandoff}/></>;
  }else if(step===3){
    if(required&&!buildFirst&&d.recordingPlan){
      title='Save the first AI idea';
      content=<><label className="brick-field">What did your AI suggest first?<input className="field" placeholder="A few words, e.g. A bridge for strangers" value={d.firstIdea} maxLength={FIRST_IDEA_LIMIT} disabled={submitting} onChange={e=>w.edit({firstIdea:e.target.value})}/></label>
        <p className="brick-lede">Save the AI’s image or take a screenshot of the response. Crop it to the idea or instructions.</p>
        <Photo value={d.originalPhoto} label="Image of the first AI idea" onChange={originalPhoto=>w.edit({originalPhoto})} disabled={submitting||w.publishing('first-idea')}/>
        <Button solid disabled={!d.firstIdea.trim()||!d.originalPhoto||submitting||w.blocked} onClick={()=>void submit('first-idea',()=>{
          w.edit({recordingPlan:false});save({handoff:d.handedOff?'ready':'idea-only'});advance(4);
        })}>Save idea and continue</Button>
        <button className="brick-text-button" type="button" disabled={submitting} onClick={()=>w.edit({recordingPlan:false})}>Back to instructions</button></>;
    }else{
      title=`Send to ${aiName}`;
      content=<Handoff photo={d.pilePhoto} aiName={aiName} onIdeaOnly={required?()=>{
        if(buildFirst){recordHandoff('idea-only');advance(4);}
        else w.edit({handedOff:false,recordingPlan:true});
      }:undefined} onReady={handedOff=>{
        if(buildFirst){recordHandoff(handedOff?'ready':'no-plan');advance(4);return;}
        if(required&&handedOff){w.edit({handedOff:true,recordingPlan:true});return;}
        w.edit({handedOff});
        if(required)save({handoff:'no-plan'});
        advance(4);
      }}/>;
    }
  }else if(step===4){
    title=d.handedOff?'Build what the AI suggests':'Try a build';
    content=<><p className="brick-lede">{buildFirst?'Use whatever came back from your AI. If you’re still waiting, start with the pieces you have.':d.handedOff?'Follow the plan as far as you can. If a piece is missing, use the closest one.':a.handoff==='idea-only'?`Use “${d.firstIdea}” as a starting point. Build what you can with the bricks you have.`:WORKSHOP_BRIEF}</p>{buildFirst&&<div className="brick-brief"><span>{WORKSHOP_PROMPT_LABEL}</span><strong>{WORKSHOP_BRIEF}</strong></div>}<p className="brick-note">When the round ends, come back here to photograph what you built.</p></>;
  }else if(capture){
    title='Photograph your build';
    content=<><p className="brick-lede">Take a photo of what you actually built. Unfinished builds count.</p>
      <Photo value={d.buildPhoto} label="Your first build" onChange={buildPhoto=>w.edit({buildPhoto,buildSent:false,buildWriteupSent:false})} disabled={w.publishing('build')||w.publishing('writeup-build')}/>
      {!required&&d.buildPhoto&&<ShareButton w={w} kind="build" onError={setNotice}/>}
      {revised&&!required&&d.buildPhoto&&<WriteupChoice w={w} kind="writeup-build" onError={setNotice}/>}
      {revised&&!required&&d.handedOff&&!s.firstRevealed&&<div className="brick-first-idea">
        <label className="brick-field">What did your AI suggest first? (optional)<input className="field" placeholder="A few words, e.g. A bridge for strangers" value={d.firstIdea} maxLength={FIRST_IDEA_LIMIT} onChange={e=>w.edit({firstIdea:e.target.value})}/></label>
        <Button disabled={!d.firstIdea.trim()||d.firstIdea.trim()===d.firstIdeaSent||w.publishing('first-idea')||w.blocked} onClick={()=>void w.publish('first-idea',true).catch(e=>setNotice(e.message))}>
          {w.publishing('first-idea')?'Saving first idea…':d.firstIdeaSent&&d.firstIdeaSent===d.firstIdea.trim()?'Shared for the reveal':'Share on the first-idea wall'}
        </Button>
      </div>}
      <Button solid disabled={required&&(!d.buildPhoto||submitting||w.blocked)} onClick={()=>{
        if(required)void submit('build',()=>w.edit({buildCaptured:true}));
        else w.edit({buildCaptured:true});
      }}>{required?'Save build photo and continue':d.buildPhoto?'Keep photo and continue':'Continue without a photo'}</Button></>;
  }else if(captureIdea){
    title='Save the first AI idea';
    const hasIdea=a.handoff==='ready'||a.handoff==='idea-only';
    content=<><fieldset className="brick-options"><legend>What did you get back?</legend><div>
      {([['ready','Instructions'],['idea-only','An idea only'],['no-plan','No idea']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={a.handoff===value} disabled={submitting} onClick={()=>recordHandoff(value)}>{label}</button>)}
    </div></fieldset>
      {hasIdea&&<><label className="brick-field">What did your AI suggest first?<input className="field" placeholder="A few words, e.g. A bridge for strangers" value={d.firstIdea} maxLength={FIRST_IDEA_LIMIT} disabled={submitting} onChange={e=>w.edit({firstIdea:e.target.value})}/></label>
        <p className="brick-lede">Add the AI’s image or a screenshot of its response.</p>
        <Photo value={d.originalPhoto} label="Image of the first AI idea" onChange={originalPhoto=>w.edit({originalPhoto})} disabled={submitting||w.publishing('first-idea')}/>
      </>}
      <Button solid disabled={!a.handoff||hasIdea&&(!d.firstIdea.trim()||!d.originalPhoto)||submitting||w.blocked} onClick={()=>{
        const done=()=>w.edit({firstIdeaCaptured:true});
        if(hasIdea)void submit('first-idea',done);
        else done();
      }}>{hasIdea?'Save first idea and continue':'Continue to reflection'}</Button></>;
  }else if(step===5){
    title='Reflect on the first build';
    content=<>{revised&&changeField}
      {!revised&&<label className="brick-field">{REFLECTION_PROMPTS[0]}<input className="field" placeholder="One sentence is enough" value={d.aiConcept} maxLength={240} onChange={e=>w.edit({aiConcept:e.target.value})}/></label>}
      <fieldset className="brick-options"><legend>{REFLECTION_PROMPTS[1]}</legend><div>{(required&&!d.handedOff?INSTRUCTION_EASE_CHOICES:INSTRUCTION_EASE).map(option=><button type="button" key={option} aria-pressed={a.instructionEase===option} onClick={()=>save({instructionEase:option})}>{option}</button>)}</div></fieldset>
      {required&&<fieldset className="brick-options"><legend>{IDEA_LIKING_QUESTION}</legend><div>{IDEA_LIKING.filter(option=>a.handoff==='no-plan'||option!=='I got no idea').map(option=><button type="button" key={option} aria-pressed={a.ideaLiking===option} onClick={()=>save({ideaLiking:option})}>{option}</button>)}</div></fieldset>}
      {!revised&&<label className="brick-field">{REFLECTION_PROMPTS[2]}<textarea className="field" rows={2} value={d.decided} maxLength={1000} onChange={e=>w.edit({decided:e.target.value})}/></label>}
      <Button solid disabled={required&&(!a.instructionEase||!a.ideaLiking||!d.decided.trim()||w.blocked)} onClick={()=>{w.edit({reflectionDone:true});advance(6);}}>Finish this reflection</Button>
      <button type="button" className="brick-text-button" onClick={()=>w.edit({buildCaptured:false,reflectionDone:false,waitingForPhase:null})}>Review my build photo</button></>;
  }else if(step===6){
    title='Make it yours';
    const firstIdea=(revised?d.firstIdea:d.aiConcept).trim();
    const prompt=`${a.handoff==='no-plan'?`Help me develop a concept for this brief: ${WORKSHOP_BRIEF}`:'Help me take the concept from our earlier chat in a direction I choose.'}${firstIdea?' The starting idea: '+firstIdea+'.':''}${d.decided.trim()?' The first thing I want to change: '+d.decided.trim()+'.':''} Ask me who it should help and what experience I want to create. It could be a game, a ritual, an experience, or something else. Suggest options and let me choose.`;
    content=<><p className="brick-lede">{`Take one change back to the same chat in ${aiName}. Develop it into a game, a ritual, a service, or an experience.`}</p>
      {d.decided&&<div className="brick-brief"><span>Your first change</span><strong>{d.decided}</strong></div>}
      {buildFirst&&<CopyPrompt text={prompt} concise/>}
      <Button solid onClick={()=>advance(7)}>Make my concept card</Button>
      {!buildFirst&&<details className="brick-details"><summary>Get a prompt for this round</summary><CopyPrompt text={prompt}/></details>}</>;
  }else if(step===7){
    title=buildFirst?'Save your final card':'Make a concept card';
    const imageAndChange=<><p className="brick-lede">{required?'Add a screenshot, an AI image, or a photo of a sketch.':'You can save an image from your AI chat and choose it from your camera roll.'}</p><Photo value={d.conceptPhoto} label="Concept image" onChange={conceptPhoto=>w.edit({conceptPhoto,sent:false,conceptWriteupSent:false})} disabled={submitting||w.publishing('concept')||w.publishing('writeup-concept')}/>
      <label className="brick-field">What changed?<input className="field" placeholder={required?'A short note, e.g. I kept the original idea':undefined} value={d.mine} maxLength={240} onChange={e=>w.edit({mine:e.target.value,sent:false})}/></label></>;
    content=<><label className="brick-field">Concept name<input className="field" value={d.name} maxLength={100} onChange={e=>w.edit({name:e.target.value,sent:false})}/></label>
      <label className="brick-field">Describe it in one sentence<textarea className="field" rows={2} value={d.what} maxLength={600} onChange={e=>w.edit({what:e.target.value,sent:false})}/></label>
      {required?imageAndChange:<details className="brick-details" open={d.conceptPhoto||d.mine?true:undefined}><summary>Add an image or a detail (optional)</summary>{imageAndChange}</details>}
      {!required&&ready&&<ShareButton w={w} kind="concept" onError={setNotice}/>}
      {revised&&!required&&d.conceptPhoto&&<WriteupChoice w={w} kind="writeup-concept" onError={setNotice}/>}
      <Button solid disabled={required&&(!ready||submitting||w.blocked)} onClick={()=>{
        if(required)void submit('concept',()=>advance(8));
        else advance(8);
      }}>{submitting?'Saving card…':required||ready?'Save card and continue':'Continue to final reflection'}</Button></>;
  }else if(step===8){
    title='Final reflection';
    const vote=<><p>{revised?CHANGE_QUESTION:'How did you work with AI in this exercise?'}</p>
      {revised?<div className="brick-poll" role="group" aria-label={CHANGE_QUESTION}>{CHANGE_CHOICES.map(choice=><button type="button" key={choice} aria-pressed={a.biggestChange===choice} disabled={buildFirst&&w.blocked} onClick={()=>buildFirst?move(9,{biggestChange:choice}):save({biggestChange:choice})}>{choice}</button>)}</div>
        :<Poll label="How did you work with AI in this exercise?" value={a.after} onChange={after=>save({after})}/>}</>;
    content=<><p className="brick-lede">{buildFirst?'Compare the ideas on the big screen, then tap one answer to finish.':revised?'Look at the first ideas and final cards on the big screen. What prompted a change?':'When did you follow the AI? When did you make the decisions? Share one thing you noticed with the room.'}</p>
      {required?vote:<details className="brick-details"><summary>Optional closing question</summary>{vote}</details>}
      {!buildFirst&&<Button solid disabled={required&&(!a.biggestChange||w.blocked)} onClick={()=>move(9)}>Finish workshop</Button>}</>;
  }else{
    title='You made it yours';
    content=<><p className="brick-lede">Thanks for building.</p>{w.publishing('concept')&&<p className="brick-note" role="status">Your concept card is waiting to send.</p>}{ready&&<>{conceptCard}<Button onClick={()=>window.print()}>Print or save my card as PDF</Button></>}</>;
  }

  const milestone=step===0?0:step<=3?1:step===4?2:step===5?3:step<=7?4:5;
  const showClock=finalExchange||step!==9&&s.phase>=(revised?0:1)&&s.phase<=(buildFirst?4:3);
  return <div className="brick-mobile">
    <header className="brick-top"><strong>{WORKSHOP_NAME}</strong><span>{milestone+1} / {STAGE_STEPS.length} · {STAGE_STEPS[milestone]}</span><details className="session-menu"><summary aria-label="Session settings">•••</summary><div className="session-menu-panel"><p className="participant-reference">{participantLabel(participant.id)}</p><AIChoice value={a.aiTool} onChange={aiTool=>save({aiTool})} disabled={s.closed}/>
      {!required&&<><label className="brick-consent"><input type="checkbox" checked={!!a.share} onChange={e=>save({share:e.target.checked})} disabled={s.closed&&!a.share}/><span>Allow sharing on the big screen</span></label><p className="small">Turning this off removes your contributions from the walls.</p>
        {revised&&a.writeup&&<button className="brick-text-button" type="button" onClick={()=>save({writeup:false})}>Withdraw public write-up permission</button>}{revised&&<PrivacyNotice/>}</>}
    </div></details></header>
    <Pane className="brick-pane" ref={node=>{pageRef.current=node;}}>
      <h1 tabIndex={-1}>{title}</h1>
      {showClock&&<RoundClock session={s} compact={step!==4&&!exchange&&!finalExchange}/>}
      {content}
      {revised&&!required&&!s.closed&&step===2&&blockedPhase===null&&<button className="brick-text-button" type="button" onClick={()=>{w.edit({handedOff:false});advance(4);}}>Continue without a plan</button>}
      {!s.closed&&step===3&&phaseForStep<=s.phase&&(!required||waitingFor===null&&!d.recordingPlan)&&<button className="brick-text-button" type="button" onClick={changePilePhoto}>Change photo</button>}
      {notice&&<p className="brick-error" role="alert">{notice}</p>}
      <div className="brick-save" role="status">{w.message||(w.jobs.length?(online?'Sending…':'Saved on this phone · will send when connected'):online?'Saved':'Saved on this phone')}{w.message&&<Button onClick={()=>void w.retry()}>{w.blocked?'Reconnect':'Retry now'}</Button>}</div>
    </Pane>
  </div>;
}
