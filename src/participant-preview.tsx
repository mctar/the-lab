import {useEffect,useRef,useState} from 'react';
import {hasTimer,requiredFlow,revisedFlow,type Session} from '../server/model';
import type {Draft} from './client';
import {media} from './media';
import {Join,ParticipantScreen} from './participant';

function previewOptions(session:Session):{label:string;draft?:Partial<Draft>}[]{
  if(session.closed)return [{label:'Workshop complete',draft:{step:0}}];
  switch(session.phase){
    case -1:return [{label:'Join form'},{label:'Waiting in the lobby',draft:{step:0}}];
    case 0:return [
      {label:'Take a photo',draft:{step:2}},
      {label:'Send photo and prompt',draft:{step:3,pilePhoto:media.pileD}},
      ...(requiredFlow(session)?[{label:'Save first AI idea',draft:{step:3,pilePhoto:media.pileD,recordingPlan:true}}]:[]),
      {label:'Waiting to build',draft:{step:3,pilePhoto:media.pileD,handedOff:true,waitingForPhase:1}},
    ];
    case 1:return [{label:'Build',draft:{step:4,handedOff:true}},{label:'Build without instructions',draft:{step:4}}];
    case 2:return [
      ...(session.exchange&&revisedFlow(session)?[{label:'Neighbour exchange',draft:{step:5,buildCaptured:true,reflectionDone:true}}]:[]),
      {label:hasTimer(session)?'Reflection':'Capture build',draft:{step:5,buildCaptured:hasTimer(session),handedOff:true}},
      ...(hasTimer(session)?[{label:'Capture build',draft:{step:5}}]:[{label:'Waiting for reflection',draft:{step:5,buildCaptured:true}}]),
    ];
    case 3:return [{label:'Develop the concept',draft:{step:6,decided:'Make it a game for two people'}}];
    case 4:return [{label:'Concept card',draft:{step:7}}];
    default:return [{label:session.stageView==='final-exchange'?'Final neighbour exchange':'Closing question',draft:{step:8}},
      {label:'Finished',draft:{step:9}}];
  }
}

export function ParticipantPreview({session}:{session:Session}){
  const options=previewOptions(session);
  const [choice,setChoice]=useState(0);
  const option=options[choice]??options[0];
  const viewport=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:0,height:0});
  useEffect(()=>{
    const element=viewport.current!;
    const observer=new ResizeObserver(([{contentRect:{width,height}}])=>setSize({width,height}));
    observer.observe(element);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{viewport.current?.querySelector('.desk-phone-screen')?.scrollTo(0,0);},[choice]);
  const scale=Math.min(size.width/390,1);
  const answers={aiTool:'ChatGPT'} as const;
  const draft:Draft={
    step:0,aiConcept:'',firstIdea:'A bridge for strangers',firstIdeaSent:'',decided:'',
    name:'',what:'',mine:'',pilePhoto:'',originalPhoto:'',buildPhoto:'',conceptPhoto:'',
    handedOff:false,recordingPlan:false,buildCaptured:false,reflectionDone:false,buildSent:false,
    sent:false,buildWriteupSent:false,conceptWriteupSent:false,answers,waitingForPhase:null,...option.draft,
  };
  const noop=()=>{};
  const state={
    identity:{id:session.id,token:'',session,participant:{id:'preview',revision:0,consentVersion:0,data:answers}},
    draft,blocked:false,reset:false,key:'preview',jobs:[],message:'',
    edit:noop,patch:async()=>{},publish:async()=>{},retry:async()=>{},publishing:()=>false,
  };
  return <section className="desk-panel desk-preview" aria-labelledby="desk-phone">
    <div className="desk-preview-heading"><h2 id="desk-phone">Participant view</h2><span>Preview</span></div>
    {options.length>1?<select className="field desk-preview-picker" aria-label="Participant screen" value={choice} onChange={e=>setChoice(Number(e.target.value))}>
      {options.map(({label},i)=><option key={label} value={i}>{label}</option>)}
    </select>:<p className="desk-preview-caption">{option.label}</p>}
    <div className="desk-phone-viewport" ref={viewport}>
      {scale>0&&<div className="desk-phone-frame" style={{width:390*scale,height:size.height}}>
        <div className="desk-phone-screen" tabIndex={0} role="region" aria-label="Scrollable phone preview" style={{transform:`scale(${scale})`,height:size.height/scale}}>
          <div inert>
            {option.draft?<ParticipantScreen key={option.label} w={state} online preview/>:<Join previewCode={session.code}/>}
          </div>
        </div>
      </div>}
    </div>
  </section>;
}
