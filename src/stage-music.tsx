import {useEffect,useRef,useState} from 'react';
import type {Session} from '../server/model';
import {API,request} from './client';
import {useRoundSeconds} from './round-clock';

export function StageMusic({session,connected,track,token}:{session:Session;connected:boolean;track?:string|null;token:string}){
  const audio=useRef<HTMLAudioElement>(null);
  const cache=useRef(new Map<string,string>());
  const [first,setFirst]=useState<string>();
  const [source,setSource]=useState<{id:string;url:string}>();
  const [enabled,setEnabled]=useState(false);
  const [volume,setVolume]=useState(.25);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const seconds=useRoundSeconds(session);
  const playing=connected&&session.endsAt!==null&&session.remainingMs===null&&(seconds??0)>0;
  const current=track||first;
  const url=source?.id===current?source?.url:undefined;
  const countdownActive=useRef(playing);
  countdownActive.current=playing;
  const root=`/v1/sessions/${session.id}/soundtracks`;

  useEffect(()=>{
    const files=cache.current;
    const player=audio.current;
    return()=>{player?.pause();files.forEach(url=>URL.revokeObjectURL(url));files.clear();};
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
    if(existing){setSource({id:current,url:existing});setError('');return;}
    const abort=new AbortController();
    async function load(id:string){
      const response=await fetch(API+root+'/'+encodeURIComponent(id),{
        headers:{Authorization:'Bearer '+token},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])
      });
      if(!response.ok||response.headers.get('Content-Type')!=='audio/wav')throw new Error('Soundtrack unavailable');
      const blob=await response.blob();
      if(abort.signal.aborted)return;
      const url=URL.createObjectURL(blob);
      cache.current.set(id,url);
      setSource({id,url});
      setError('');
    }
    void load(current).catch(()=>{if(!abort.signal.aborted)setError('Could not load this soundtrack.');});
    return()=>abort.abort();
  },[current,root,token,retry]);

  useEffect(()=>{
    const player=audio.current;
    if(player)player.volume=volume;
  },[volume]);

  useEffect(()=>{
    const player=audio.current;
    if(!player)return;
    if(!url||!enabled||!playing){player.pause();return;}
    let active=true;
    void player.play().catch(error=>{
      if(active&&error.name!=='AbortError'){
        setEnabled(false);
        setError('Select Enable music to allow playback.');
      }
    });
    return()=>{active=false;};
  },[url,enabled,playing]);

  function enable(){
    const player=audio.current;
    if(!player||!url)return;
    if(enabled){player.pause();setEnabled(false);return;}
    setError('');
    player.muted=!playing;
    // Authorize this media element on a click, including from the lobby.
    void player.play().then(()=>{
      if(player.getAttribute('src')!==url)return;
      if(!countdownActive.current)player.pause();
      player.muted=false;
      setEnabled(true);
    }).catch(error=>{
      if(error.name!=='AbortError')setError('The browser could not play this soundtrack.');
    });
  }

  return <><details className="stage-music">
    <summary>{enabled?'Countdown music on':'Countdown music'}</summary>
    <div className="stage-music-controls">
      {current&&<p className="stage-music-track">{current.replace(/-/g,' ')}</p>}
      <div className="stage-music-buttons">
        <button type="button" onClick={enable} disabled={!url}>{enabled?'Mute music':'Enable music'}</button>
        <label>Volume<input type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
      </div>
      <p role="status">{error||(!url?'Waiting for the soundtrack library…':enabled?(playing?'Playing':'Ready for the next countdown'):'Plays whenever a countdown is running.')}</p>
      {error&&!url&&<button type="button" onClick={()=>{setError('');setRetry(value=>value+1);}}>Retry loading music</button>}
    </div>
  </details><audio ref={audio} src={url} loop preload="metadata"/></>;
}
