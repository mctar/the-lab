import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import type {Session} from '../server/model';
import {useRoundSeconds} from './round-clock';

export function StageMusic({session,connected}:{session:Session;connected:boolean}){
  const audio=useRef<HTMLAudioElement>(null);
  const [track,setTrack]=useState<{url:string;name:string}|null>(null);
  const [enabled,setEnabled]=useState(false);
  const [volume,setVolume]=useState(.25);
  const [error,setError]=useState('');
  const seconds=useRoundSeconds(session);
  const playing=connected&&session.endsAt!==null&&session.remainingMs===null&&(seconds??0)>0;
  const countdownActive=useRef(playing);
  countdownActive.current=playing;

  useEffect(()=>{
    if(!track)return;
    return()=>URL.revokeObjectURL(track.url);
  },[track]);

  useEffect(()=>{
    const player=audio.current;
    if(!player||!track)return;
    if(!enabled||!playing){
      player.pause();
      return;
    }
    player.volume=volume;
    let active=true;
    void player.play().catch(error=>{
      if(active&&error.name!=='AbortError'){
        setEnabled(false);
        setError('Playback needs a tap on this screen. Select Enable music.');
      }
    });
    return()=>{active=false;};
  },[track,enabled,playing,volume]);

  useEffect(()=>{
    const player=audio.current;
    return()=>player?.pause();
  },[]);

  function choose(event:ChangeEvent<HTMLInputElement>){
    const file=event.currentTarget.files?.[0];
    if(!file)return;
    audio.current?.pause();
    setEnabled(false);
    setError('');
    setTrack({url:URL.createObjectURL(file),name:file.name});
    event.currentTarget.value='';
  }

  function enable(){
    const player=audio.current;
    if(!player||!track)return;
    if(enabled){
      player.pause();
      setEnabled(false);
      return;
    }
    setError('');
    player.muted=!playing;
    player.volume=volume;
    // Start on a click to authorize this element for later timer-driven playback.
    void player.play().then(()=>{
      if(player.getAttribute('src')!==track.url)return;
      if(!countdownActive.current)player.pause();
      player.muted=false;
      setEnabled(true);
    }).catch(error=>{
      if(error.name!=='AbortError')setError('This audio could not play. Try an MP3 or WAV file.');
    });
  }

  return <><details className="stage-music">
    <summary>{enabled?'Countdown music on':'Countdown music'}</summary>
    <div className="stage-music-controls">
      <label>Track on this Mac<input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={choose}/></label>
      {track&&<p className="stage-music-track">{track.name}</p>}
      <div className="stage-music-buttons">
        <button type="button" onClick={enable} disabled={!track}>{enabled?'Mute music':'Enable music'}</button>
        <label>Volume<input type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
      </div>
      <p role="status">{error||(enabled?(playing?'Playing':'Ready for the next countdown'):'Plays whenever a countdown is running.')}</p>
    </div>
  </details><audio ref={audio} src={track?.url} loop preload="metadata"/></>;
}
