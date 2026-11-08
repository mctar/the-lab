import { participantLabel, type HostTelemetry, type ParticipantActivity } from './model.js';
import type { Row } from './db.js';

const iso = (time:Date|string|null|undefined) => time ? new Date(time).toISOString() : null;
export function hostTelemetry(people:Row[],phase:number,connected:Set<string>,submitted:Set<string>,now=Date.now()):HostTelemetry {
  const steps=Array(10).fill(0);
  const participants:ParticipantActivity[]=people.map(p=>{
    const data=p.data, status=p.client_status||{}, reported=p.current_step!=null;
    const step=reported?p.current_step:(data.progress||0);
    const fresh=p.telemetry_at!=null && now-new Date(p.telemetry_at).getTime()<90000;
    const recent=p.last_seen_at!=null && now-new Date(p.last_seen_at).getTime()<90000;
    const waitingForPhase=reported && status.waitingForPhase!=null && status.waitingForPhase>phase ? status.waitingForPhase : null;
    const pendingSaves=status.pendingSaves||0;
    const needsAttention=fresh && (status.syncStatus==='error' || pendingSaves>0 && p.pending_since_at!=null && now-new Date(p.pending_since_at).getTime()>60000);
    steps[step]++;
    return {id:p.id,label:participantLabel(p.id),step,reported,stepStartedAt:iso(p.step_started_at),lastSeenAt:iso(p.last_seen_at),joinedAt:iso(p.created_at)!,
      connected:connected.has(p.id),visibility:status.visibility||null,waitingForPhase,pendingSaves,pendingSince:iso(p.pending_since_at),syncStatus:status.syncStatus||null,
      photos:status.photos||null,handedOff:reported?!!status.handedOff:null,cardReady:reported?!!status.cardReady:null,
      answeredBefore:data.before!=null,answeredAfter:data.after!=null,sharing:!!data.share,cardSubmitted:submitted.has(p.id),aiTool:data.aiTool||null,
      finished:data.progress===9,needsAttention,recent};
  });
  return {connected:participants.filter(p=>p.connected).length,recent:participants.filter(p=>p.recent).length,waiting:participants.filter(p=>p.waitingForPhase!==null).length,
    finished:participants.filter(p=>p.finished).length,needsAttention:participants.filter(p=>p.needsAttention).length,steps,participants};
}
