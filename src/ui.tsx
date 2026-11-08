import { useEffect, useRef, useState, type ReactNode } from 'react';
import { live } from './client';

export function useLive(id:string,token:string,refresh:()=>void){
  const [connected,setConnected]=useState(false),callback=useRef(refresh);
  callback.current=refresh;
  useEffect(()=>{
    const abort=new AbortController();
    let pending:ReturnType<typeof setTimeout>|undefined;
    const load=()=>{if(!pending)pending=setTimeout(()=>{pending=undefined;callback.current();},300);};
    void live(id,token,abort.signal,load,setConnected);
    const timer=setInterval(load,15000);
    document.addEventListener('visibilitychange',load);
    return()=>{abort.abort();clearInterval(timer);clearTimeout(pending);document.removeEventListener('visibilitychange',load);};
  },[id,token]);
  return connected;
}

export function Button({children,onClick,disabled=false,solid=false}:{children:ReactNode;onClick?:()=>void;disabled?:boolean;solid?:boolean}){
  return <button type="button" className={'pill'+(solid?' solid':'')} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Shell({children}:{children:ReactNode}){
  return <div className="utility-shell"><a className="wordmark" href="#/">Brick <span>Gervi Labs</span></a>{children}</div>;
}
