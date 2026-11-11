import { get, set, del } from 'idb-keyval';
import { isWriteupKind, requiredFlow, type Answers, type CardKind, type Participant, type Session } from '../server/model';
export const API=(import.meta.env?.VITE_API_URL || '').replace(/\/$/,'');
export class ApiError extends Error { constructor(public status:number,message:string){super(message);} }
export async function request<T>(path:string,token='',body?:unknown,method=body?'POST':'GET',signal?:AbortSignal):Promise<T> {
  const response=await fetch(API+path,{method,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  if(!response.ok) {const data=await response.json().catch(()=>({}));throw new ApiError(response.status,data.error || 'Unable to connect. Please try again.');}return response.json();
}
export async function live(id:string,token:string,signal:AbortSignal,onChange:()=>void,onConnection:(online:boolean)=>void) {
  while(!signal.aborted) {
    try {
      const res=await fetch(API+`/v1/sessions/${id}/events`,{headers:{Authorization:'Bearer '+token},signal});
      if(res.status===410)onChange();
      if(!res.ok || !res.body) throw new Error('Live connection unavailable');
      onConnection(true);onChange();const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
      while(!signal.aborted) {const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(event.includes('data:')) onChange();}}
    } catch { /* The HTTP snapshot remains the source of truth. */ }
    onConnection(false);if(signal.aborted)break;
    await new Promise<void>(resolve=>{const t=setTimeout(resolve,2500+Math.random()*2000);signal.addEventListener('abort',()=>{clearTimeout(t);resolve();},{once:true});});
  }
}
export type Draft={step:number; aiConcept:string; firstIdea:string; firstIdeaSent:string; decided:string; name:string; what:string; mine:string; pilePhoto:string; originalPhoto:string; buildPhoto:string; conceptPhoto:string; handedOff:boolean; recordingPlan:boolean; buildCaptured:boolean; reflectionDone:boolean; buildSent:boolean; sent:boolean; buildWriteupSent:boolean; conceptWriteupSent:boolean; answers:Answers;waitingForPhase:number|null};
const blank=():Draft=>({step:0,aiConcept:'',firstIdea:'',firstIdeaSent:'',decided:'',name:'',what:'',mine:'',pilePhoto:'',originalPhoto:'',buildPhoto:'',conceptPhoto:'',handedOff:false,recordingPlan:false,buildCaptured:false,reflectionDone:false,buildSent:false,sent:false,buildWriteupSent:false,conceptWriteupSent:false,answers:{},waitingForPhase:null});
type DraftStore={get:<T>(key:string)=>Promise<T|undefined>;set:(key:string,value:unknown)=>Promise<void>;del:(key:string)=>Promise<void>};
type Job={id:string; kind:'patch'|'publish'; patch?:Answers; card?:{kind:CardKind; title:string; description:string; mine:string; photo:string}; body?:any; assetId?:string; consentVersion?:number};
export type Identity={id:string;token:string;participant:Participant;session:Session};
export class Workshop {
  draft=blank(); jobs:Job[]=[]; message=''; busy=false; blocked=false; reset=false; onChange=()=>{}; onReset=()=>{}; private persisting=Promise.resolve();private abort=new AbortController();
  constructor(public identity:Identity,private store:DraftStore={get,set,del}){}
  get key(){return `bwt:${this.identity.id}:${this.identity.participant.id}`;}
  async init(){const saved=await this.store.get<{draft:Draft;jobs:Job[]}>(this.key);if(saved){this.draft={...blank(),...saved.draft};this.jobs=saved.jobs;}else{this.draft.answers=this.identity.participant.data;this.draft.step=this.identity.participant.data.progress||0;}try{await this.refresh();}catch{/* Keep the local draft available while offline. */}this.onChange();}
  async persist(){if(this.reset)return;const snapshot=structuredClone({draft:this.draft,jobs:this.jobs});const save=()=>this.store.set(this.key,snapshot);this.persisting=this.persisting.then(save,save).catch(()=>{this.message='Phone storage is full. Keep this page open and free some space.';this.onChange();throw new Error(this.message);});await this.persisting;}
  edit(patch:Partial<Draft>){if(this.reset)return;Object.assign(this.draft,patch);this.onChange();void this.persist().catch(()=>{});}
  async patch(patch:Answers){
    if(this.reset)return;Object.assign(this.draft.answers,patch);
    if(patch.share===false&&!requiredFlow(this.identity.session)){
      this.jobs=this.jobs.filter(j=>!j.card||isWriteupKind(j.card.kind));
      this.draft.sent=false;this.draft.buildSent=false;this.draft.firstIdeaSent='';
    }
    if(patch.writeup===false){
      this.jobs=this.jobs.filter(j=>!j.card||!isWriteupKind(j.card.kind));
      this.draft.buildWriteupSent=false;this.draft.conceptWriteupSent=false;
    }
    this.jobs.push({id:crypto.randomUUID(),kind:'patch',patch});this.onChange();await this.persist();void this.flush();
  }
  publishing(kind:CardKind){return this.jobs.some(job=>job.card?.kind===kind);}
  async publish(kind:CardKind,allowSharing=false){
    if(this.reset||this.publishing(kind))return;
    const draft=this.draft;
    const required=requiredFlow(this.identity.session);
    const permission=isWriteupKind(kind)?'writeup':'share';
    if(!required&&!draft.answers[permission]){
      if(!allowSharing)return;
      draft.answers[permission]=true;
      this.jobs.push({id:crypto.randomUUID(),kind:'patch',patch:{[permission]:true}});
    }
    const title=kind==='first-idea'?draft.firstIdea.trim():kind==='concept'?draft.name.trim():kind==='build'?'First build':'';
    const photo=kind==='first-idea'?(required?draft.originalPhoto:''):kind==='build'||kind==='writeup-build'?draft.buildPhoto:draft.conceptPhoto;
    this.jobs.push({id:crypto.randomUUID(),kind:'publish',card:{kind,title,description:kind==='concept'?draft.what.trim():'',mine:kind==='concept'?draft.mine.trim():'',photo}});
    if(kind==='concept')draft.sent=false;
    if(kind==='build')draft.buildSent=false;
    this.onChange();await this.persist();void this.flush();
  }
  async flush(){
    if(this.reset || this.busy || this.blocked || !this.jobs.length)return;
    this.busy=true;this.onChange();
    try {
      while(this.jobs.length&&!this.reset){
        const job=this.jobs[0],{id,token}=this.identity;
        if(job.kind==='patch') {
          job.body ||= {operationId:job.id,expectedRevision:this.identity.participant.revision,patch:job.patch};await this.persist();
          const participant=await request<Participant>(`/v1/sessions/${id}/me`,token,job.body,'PATCH',this.abort.signal);if(this.reset)return;this.identity.participant=participant;
        } else {
          const card=job.card!;
          const required=requiredFlow(this.identity.session);
          const writeup=isWriteupKind(card.kind),permission=writeup?'writeup':'share';
          if(!required&&!this.draft.answers[permission]){this.jobs.shift();continue;}
          try{
            job.consentVersion ??= required?0:writeup?this.identity.participant.writeupVersion??0:this.identity.participant.consentVersion;
            await this.persist();
            if(card.photo && !job.assetId){
              const blob=await(await fetch(card.photo)).blob(),form=new FormData();form.append('photo',blob,'build.jpg');
              const purpose=required?'workshop':writeup?'writeup':'room';
              const res=await fetch(API+`/v1/sessions/${id}/photos?consentVersion=${job.consentVersion}&purpose=${purpose}`,{method:'POST',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(45000)]),headers:{Authorization:'Bearer '+token},body:form});
              if(!res.ok){const e=await res.json();throw new ApiError(res.status,e.error);}
              const uploaded=await res.json();if(this.reset)return;job.assetId=uploaded.assetId;await this.persist();
            }
            if(this.reset)return;if(!this.jobs.includes(job)||!required&&!this.draft.answers[permission])continue;
            job.body ||= {operationId:job.id,expectedRevision:this.identity.participant.revision,consentVersion:job.consentVersion,kind:card.kind,title:card.title,description:card.description,mine:card.mine,assetId:job.assetId||null};await this.persist();
            await request(`/v1/sessions/${id}/cards`,token,job.body,'POST',this.abort.signal);
          }catch(e){
            // A withdrawn publication must never block the consent update behind it.
            if(!(e instanceof ApiError&&e.status===410)&&!this.jobs.includes(job))continue;
            throw e;
          }
          if(this.reset)return;
          const draft=this.draft;
          if(this.jobs.includes(job)&&(required||draft.answers[permission])){
            if(card.kind==='build'&&card.photo===draft.buildPhoto)draft.buildSent=true;
            if(card.kind==='concept'&&card.title===draft.name.trim()&&card.description===draft.what.trim()&&card.mine===draft.mine.trim()&&card.photo===draft.conceptPhoto)draft.sent=true;
            if(card.kind==='first-idea')draft.firstIdeaSent=card.title;
            if(card.kind==='writeup-build'&&card.photo===draft.buildPhoto)draft.buildWriteupSent=true;
            if(card.kind==='writeup-concept'&&card.photo===draft.conceptPhoto)draft.conceptWriteupSent=true;
          }
        }
        if(this.jobs[0]===job)this.jobs.shift();this.message='';await this.persist();this.onChange();
      }
    } catch(e){if(e instanceof ApiError&&e.status===410){await this.sessionReset();return;}if(this.reset)return;this.message=e instanceof ApiError?e.message:'Saved on this phone. Waiting for a connection to send.';if(e instanceof ApiError && e.status>=400 && e.status<500 && e.status!==429){this.blocked=true;}}finally{this.busy=false;this.onChange();}
  }
  async retry(){
    if(this.reset)return;
    if(!this.blocked){await this.flush();return;}
    const pending=this.jobs;this.jobs=[];
    try{await this.refresh();}catch{this.jobs=pending;this.message='Still waiting for a connection. Your work is saved on this phone.';this.onChange();return;}
    if(this.reset)return;
    this.blocked=false;
    const answers=this.identity.participant.data;
    this.draft.answers={...answers};
    this.draft.sent=false;
    if(requiredFlow(this.identity.session)){
      const step=answers.progress??0;
      Object.assign(this.draft,{step,waitingForPhase:null,buildCaptured:step>=6,reflectionDone:step>=6,sent:step>=8,handedOff:answers.handoff==='ready'});
    }
    this.message='Connected again. Review this step and continue.';
    await this.persist();this.onChange();
  }
  private async sessionReset(){
    if(this.reset)return;this.reset=true;this.abort.abort();this.jobs=[];this.draft=blank();this.blocked=true;
    this.message='Your facilitator reset the session. Join again to start fresh.';this.onChange();
    await this.persisting.catch(()=>{});await this.store.del(this.key).catch(()=>{});this.onReset();
  }
  async refresh(){
    if(this.reset)return;
    try{
      const state=await request<{session:Session;participant:Participant}>(`/v1/sessions/${this.identity.id}`,this.identity.token,undefined,'GET',this.abort.signal);
      if(this.reset)return;this.identity.session=state.session;
      if(!this.jobs.length && !this.busy){this.identity.participant=state.participant;this.draft.answers={...state.participant.data,...this.draft.answers};}this.onChange();
    }catch(e){if(e instanceof ApiError&&e.status===410){await this.sessionReset();return;}if(!this.reset)throw e;}
  }
}
export async function photograph(file:File):Promise<string>{
  if(file.size>30*1024*1024)throw new Error('Choose a photo smaller than 30 MB.');
  let bitmap:ImageBitmap|HTMLImageElement;
  try{bitmap=await createImageBitmap(file);}catch{
    const url=URL.createObjectURL(file);
    try{const image=new Image();image.src=url;await image.decode();bitmap=image;}catch{throw new Error('This photo could not be opened. Choose a JPEG, PNG, or WebP photo, or take a new one.');}finally{URL.revokeObjectURL(url);}
  }
  const factor=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*factor);canvas.height=Math.round(bitmap.height*factor);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);if('close' in bitmap)bitmap.close();
  const image=canvas.toDataURL('image/jpeg',.78);if(image.length>2400000)throw new Error('This photo is too large. Try a simpler photo.');return image;
}
