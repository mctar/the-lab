import { get, set, del } from 'idb-keyval';
import type { Answers, Participant, Session } from '../server/model';
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
export type Draft={step:number; aiConcept:string; decided:string; name:string; what:string; mine:string; pilePhoto:string; buildPhoto:string; conceptPhoto:string; handedOff:boolean; buildCaptured:boolean; buildSent:boolean; sent:boolean; answers:Answers;waitingForPhase:number|null};
const blank=():Draft=>({step:0,aiConcept:'',decided:'',name:'',what:'',mine:'',pilePhoto:'',buildPhoto:'',conceptPhoto:'',handedOff:false,buildCaptured:false,buildSent:false,sent:false,answers:{},waitingForPhase:null});
type DraftStore={get:<T>(key:string)=>Promise<T|undefined>;set:(key:string,value:unknown)=>Promise<void>;del:(key:string)=>Promise<void>};
type Job={id:string; kind:'patch'|'publish'; patch?:Answers; card?:{kind:'build'|'concept'; title:string; description:string; mine:string; photo:string}; body?:any; assetId?:string; consentVersion?:number};
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
    if(patch.share===false){this.jobs=this.jobs.filter(j=>j.kind!=='publish');this.draft.sent=false;this.draft.buildSent=false;}
    this.jobs.push({id:crypto.randomUUID(),kind:'patch',patch});this.onChange();await this.persist();void this.flush();
  }
  publishing(kind:'build'|'concept'){return this.jobs.some(job=>job.card?.kind===kind);}
  async publish(kind:'build'|'concept',allowSharing=false){
    if(this.reset||this.publishing(kind))return;
    const draft=this.draft;
    if(!draft.answers.share){
      if(!allowSharing)return;
      draft.answers.share=true;
      this.jobs.push({id:crypto.randomUUID(),kind:'patch',patch:{share:true}});
    }
    this.jobs.push({id:crypto.randomUUID(),kind:'publish',card:{kind,title:kind==='concept'?draft.name:'First build',description:kind==='concept'?draft.what:'',mine:kind==='concept'?draft.mine:'',photo:kind==='concept'?draft.conceptPhoto:draft.buildPhoto}});
    if(kind==='concept')draft.sent=false;
    else draft.buildSent=false;
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
          if(!this.draft.answers.share){this.jobs.shift();continue;}
          try{
            job.consentVersion ??= this.identity.participant.consentVersion;await this.persist();
            if(job.card!.photo && !job.assetId){
              const blob=await(await fetch(job.card!.photo)).blob(),form=new FormData();form.append('photo',blob,'build.jpg');
              const res=await fetch(API+`/v1/sessions/${id}/photos?consentVersion=${job.consentVersion}`,{method:'POST',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(45000)]),headers:{Authorization:'Bearer '+token},body:form});
              if(!res.ok){const e=await res.json();throw new ApiError(res.status,e.error);}
              const uploaded=await res.json();if(this.reset)return;job.assetId=uploaded.assetId;await this.persist();
            }
            if(this.reset)return;if(!this.draft.answers.share || !this.jobs.includes(job))continue;
            job.body ||= {operationId:job.id,expectedRevision:this.identity.participant.revision,consentVersion:job.consentVersion,kind:job.card!.kind,title:job.card!.title,description:job.card!.description,mine:job.card!.mine,assetId:job.assetId||null};await this.persist();
            await request(`/v1/sessions/${id}/cards`,token,job.body,'POST',this.abort.signal);
          }catch(e){
            // A withdrawn publication must never block the consent update behind it.
            if(!(e instanceof ApiError&&e.status===410)&&!this.jobs.includes(job))continue;
            throw e;
          }
          if(this.reset)return;
          const draft=this.draft,card=job.card!;
          if(this.jobs.includes(job)&&draft.answers.share){
            if(card.kind==='build'&&card.photo===draft.buildPhoto)draft.buildSent=true;
            if(card.kind==='concept'&&card.title===draft.name&&card.description===draft.what&&card.mine===draft.mine&&card.photo===draft.conceptPhoto)draft.sent=true;
          }
        }
        if(this.jobs[0]===job)this.jobs.shift();this.message='';await this.persist();this.onChange();
      }
    } catch(e){if(e instanceof ApiError&&e.status===410){await this.sessionReset();return;}if(this.reset)return;this.message=e instanceof ApiError?e.message:'Saved on this phone. Waiting for a connection to send.';if(e instanceof ApiError && e.status>=400 && e.status<500 && e.status!==429){this.blocked=true;}}finally{this.busy=false;this.onChange();}
  }
  async retry(){if(this.reset)return;if(this.blocked){this.blocked=false;this.jobs=[];this.draft.sent=false;await this.refresh();if(this.reset)return;this.draft.answers={...this.identity.participant.data};await this.persist();this.message='Connected again. Please make your selection or submit your card again.';}else await this.flush();this.onChange();}
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
