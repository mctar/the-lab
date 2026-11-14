import {useEffect,useRef,useState} from 'react';
import type {Session} from '../server/model';
import {API,request} from './client';
import {useRoundSeconds} from './round-clock';

const rampSeconds=.08;

export function StageMusic({session,connected,track,token}:{session:Session;connected:boolean;track?:string|null;token:string}){
  const audio=useRef<{context:AudioContext;volume:GainNode}>(null);
  const cache=useRef(new Map<string,AudioBuffer>());
  const resumeAt=useRef<{buffer:AudioBuffer;offset:number}>(null);
  const [first,setFirst]=useState<string>();
  const [source,setSource]=useState<{id:string;buffer:AudioBuffer}>();
  const [enabled,setEnabled]=useState(false);
  const [enabling,setEnabling]=useState(false);
  const [volume,setVolume]=useState(.25);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const seconds=useRoundSeconds(session);
  const playing=connected&&session.endsAt!==null&&session.remainingMs===null&&(seconds??0)>0;
  const current=track||first;
  const buffer=source?.id===current?source?.buffer:undefined;
  const root=`/v1/sessions/${session.id}/soundtracks`;

  useEffect(()=>{
    const buffers=cache.current;
    return()=>{
      buffers.clear();
      const player=audio.current;
      audio.current=null;
      if(player)void player.context.close();
    };
  },[]);

  useEffect(()=>{
    if(track||first)return;
    const abort=new AbortController();
    void request<{tracks:string[]}>(root,token,undefined,'GET',abort.signal)
      .then(({tracks})=>{
        if(abort.signal.aborted)return;
        if(tracks.length)setFirst(tracks[0]);
        else setError('No soundtracks are available.');
      })
      .catch(()=>{if(!abort.signal.aborted)setError('Could not load the soundtrack library.');});
    return()=>abort.abort();
  },[root,token,track,first,retry]);

  useEffect(()=>{
    if(!current)return;
    const existing=cache.current.get(current);
    if(existing){setSource({id:current,buffer:existing});setError('');return;}
    const abort=new AbortController();
    async function load(id:string){
      const response=await fetch(API+root+'/'+encodeURIComponent(id),{
        headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])
      });
      if(!response.ok||response.headers.get('Content-Type')!=='audio/wav')throw new Error('Soundtrack unavailable');
      const file=await response.arrayBuffer();
      if(abort.signal.aborted)return;
      // Decode at the WAV's sample rate to preserve the samples at the loop join.
      const decoded=await new OfflineAudioContext(2,1,44100).decodeAudioData(file);
      if(abort.signal.aborted)return;
      const buffers=cache.current;
      if(buffers.size>=4)buffers.delete(buffers.keys().next().value!);
      buffers.set(id,decoded);
      setSource({id,buffer:decoded});
      setError('');
    }
    void load(current).catch(()=>{if(!abort.signal.aborted)setError('Could not load this soundtrack.');});
    return()=>abort.abort();
  },[current,root,token,retry]);

  useEffect(()=>{
    const player=audio.current;
    if(player)player.volume.gain.setTargetAtTime(volume,player.context.currentTime,rampSeconds/3);
  },[volume]);

  useEffect(()=>{
    const player=audio.current;
    if(!player||!buffer||!enabled||!playing)return;
    const {context}=player;
    const node=context.createBufferSource();
    const fade=context.createGain();
    node.buffer=buffer;
    node.loop=true;
    node.connect(fade).connect(player.volume);
    const startedAt=context.currentTime;
    const offset=resumeAt.current?.buffer===buffer?resumeAt.current.offset:0;
    fade.gain.setValueAtTime(0,startedAt);
    fade.gain.linearRampToValueAtTime(1,startedAt+rampSeconds);
    node.onended=()=>{node.disconnect();fade.disconnect();};
    node.start(startedAt,offset);
    return()=>{
      if(context.state==='closed')return;
      const now=context.currentTime;
      const elapsed=now-startedAt;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(Math.min(1,elapsed/rampSeconds),now);
      fade.gain.linearRampToValueAtTime(0,now+rampSeconds);
      node.stop(now+rampSeconds);
      resumeAt.current={buffer,offset:(offset+elapsed)%buffer.duration};
    };
  },[buffer,enabled,playing]);

  async function toggleMusic(){
    if(enabled){setEnabled(false);return;}
    setError('');
    setEnabling(true);
    try{
      if(!audio.current){
        const context=new AudioContext();
        const gain=context.createGain();
        gain.gain.value=volume;
        gain.connect(context.destination);
        audio.current={context,volume:gain};
      }
      const player=audio.current;
      // Resume directly from the click, including in the lobby.
      await player.context.resume();
      if(audio.current===player)setEnabled(true);
    }catch{
      setError('The browser could not enable soundtrack playback.');
    }finally{
      setEnabling(false);
    }
  }

  return <details className="stage-music">
    <summary>{enabled?'Countdown music on':'Countdown music'}</summary>
    <div className="stage-music-controls">
      {current&&<p className="stage-music-track">{current.replace(/-/g,' ')}</p>}
      <div className="stage-music-buttons">
        <button type="button" onClick={toggleMusic} disabled={enabling||(!buffer&&!enabled)}>{enabled?'Mute music':'Enable music'}</button>
        <label>Volume<input type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
      </div>
      <p role="status">{error||(!buffer?'Waiting for the soundtrack library…':enabled?(playing?'Playing':'Ready for the next countdown'):'Plays whenever a countdown is running.')}</p>
      {error&&!buffer&&<button type="button" onClick={()=>{setError('');setRetry(value=>value+1);}}>Retry loading music</button>}
    </div>
  </details>;
}
