import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from './db.js';

/** A durable file queue lets a restarted process finish deletion after the database commit. */
export async function purgeExpiredData(db:Database,photoDir:string){
  const deadline = new Date(Date.now()+3600000);
  await db.transaction(async q=>{
    const expired=await q('SELECT id FROM participants WHERE retain_until<=$1 FOR UPDATE',[deadline]);
    if(!expired.length)return;
    const ids=expired.map(person=>person.id);
    await q('INSERT INTO expired_photo_files(asset_id) SELECT id FROM assets WHERE participant_id=ANY($1::uuid[]) ON CONFLICT DO NOTHING',[ids]);
    await q('DELETE FROM operations WHERE owner=ANY($1::text[])',[ids]);
    await q('DELETE FROM participants WHERE id=ANY($1::uuid[])',[ids]);
  });
  const photos=await db.query('SELECT asset_id FROM expired_photo_files LIMIT 1000');
  for(const {asset_id:id} of photos){
    await Promise.all(['.jpg','-thumb.jpg'].map(async suffix=>{
      try{await unlink(join(photoDir,id+suffix));}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }));
    await db.query('DELETE FROM expired_photo_files WHERE asset_id=$1',[id]);
  }
}
