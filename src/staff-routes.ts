export type StaffRole = 'host' | 'stage';
type StaffRoute = {role:StaffRole;id:string;access:string|null;base:string};

const staffPaths: Record<StaffRole, string> = {host:'facilitator',stage:'big-screen'};
const staffPathPattern = /\/(facilitator|big-screen)(?:\/(?:index\.html)?)?$/;

export function staffUrl(base:string,role:StaffRole,id?:string,access?:string){
  const url=new URL(staffPaths[role]+'/',base);
  if(id){
    const query=access?'?'+new URLSearchParams({access}):'';
    url.hash='/'+id+query;
  }
  return url.href;
}

export function staffRoute(url:URL):StaffRoute|null{
  const pathMatch=staffPathPattern.exec(url.pathname);
  const fragment=url.hash.replace(/^#\/?/,'');
  const queryStart=fragment.indexOf('?');
  const path=queryStart<0?fragment:fragment.slice(0,queryStart);
  const access=queryStart<0?null:new URLSearchParams(fragment.slice(queryStart+1)).get('access');

  if(pathMatch){
    const role:StaffRole=pathMatch[1]===staffPaths.host?'host':'stage';
    const base=new URL(url.pathname.slice(0,pathMatch.index+1),url).href;
    return {role,id:path,access,base};
  }
  const [role,id]=path.split('/');
  if(role==='host'||role==='stage')return {role,id:id||'',access,base:new URL('.',url).href};
  return null;
}
