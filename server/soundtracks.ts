import {randomInt} from 'node:crypto';
import {readdir} from 'node:fs/promises';

export const soundtrackId=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function soundtrackIds(directory:string){
  const files=await readdir(directory,{withFileTypes:true});
  return files.filter(file=>file.isFile()&&file.name.endsWith('.wav'))
    .map(file=>file.name.slice(0,-4)).filter(id=>id.length<=80&&soundtrackId.test(id)).sort();
}

export function nextSoundtrack(ids:string[],played:string[],previous:string|null){
  let used=played.filter(id=>ids.includes(id));
  let remaining=ids.filter(id=>!used.includes(id));
  if(!remaining.length){
    used=[];
    remaining=ids.length>1?ids.filter(id=>id!==previous):ids;
  }
  if(!remaining.length)return {track:null,played:[]};
  const track=remaining[randomInt(remaining.length)];
  return {track,played:[...used,track]};
}
