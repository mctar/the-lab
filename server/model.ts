import { z } from 'zod';
export const WORKSHOP_NAME = 'The Lab';
export const PHASES = ['Get a build plan', 'Build', 'Capture & reflect', 'Make it yours', 'Concept card', 'Final reflection'];
export const ROUND_MINUTES: Readonly<Partial<Record<number, number>>> = {1:5, 2:2, 3:10};
export const INSTRUCTION_EASE = ['Easy', 'Some parts were hard', 'Hard'] as const;
export const SCALE = [['Magic button', 'I hand it over'], ['Centaur', 'We split the work'], ['Cyborg', 'We think as one']];
export const AI_TOOLS = ['ChatGPT', 'Gemini', 'Claude', 'Copilot', 'Something else'] as const;
export const TWISTS = ['for people who have never met', "for people who don’t share a language", 'that only works at night', 'for people who disagree', 'that works without electricity', 'for a city 100 years from now', 'that fits in a pocket', 'for strangers on a train', 'for one minute a day', 'for people of all ages at once', 'that moves', 'that makes a sound', 'in the middle of a forest', 'for a rainy Monday morning', 'for people waiting in line', 'that grows over time', 'for neighbours who never talk', 'for a place where everyone is in a hurry'];
export const CARD_PHASE = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 5];
export const FLOW_STEPS = ['Joined', 'Opening question', 'Photograph loose pieces', 'Get a build plan', 'Build', 'Capture & reflect', 'Make it yours', 'Concept card', 'Final reflection', 'Finished'];
export const participantLabel = (id:string) => 'Builder '+id.slice(0,8).toUpperCase();
export const activityInput = z.object({
  step:z.number().int().min(0).max(9),
  visibility:z.enum(['visible','hidden']),
  pendingSaves:z.number().int().min(0).max(1000),
  syncStatus:z.enum(['saved','sending','queued','error']),
  waitingForPhase:z.number().int().min(0).max(5).nullable(),
  photos:z.object({pile:z.boolean(),build:z.boolean(),concept:z.boolean()}).strict(),
  handedOff:z.boolean(), cardReady:z.boolean()
}).strict();
export type ActivityReport = z.infer<typeof activityInput>;
export type ParticipantActivity = {
  id:string; label:string; step:number; reported:boolean; stepStartedAt:string|null;
  lastSeenAt:string|null; joinedAt:string; connected:boolean; visibility:'visible'|'hidden'|null;
  waitingForPhase:number|null; pendingSaves:number; pendingSince:string|null; syncStatus:ActivityReport['syncStatus']|null;
  photos:ActivityReport['photos']|null; handedOff:boolean|null; cardReady:boolean|null;
  answeredBefore:boolean; answeredAfter:boolean; sharing:boolean; cardSubmitted:boolean;
  aiTool:Answers['aiTool']|null;
  finished:boolean; needsAttention:boolean; recent:boolean;
};
export type HostTelemetry = {connected:number; recent:number; waiting:number; finished:number; needsAttention:number; steps:number[]; participants:ParticipantActivity[]};
export const answerPatch = z.object({
  aiTool: z.enum(AI_TOOLS).optional(),
  before: z.number().int().min(0).max(2).optional(), after: z.number().int().min(0).max(2).optional(),
  works: z.enum(['Yes', 'Partly', 'No']).optional(), feel: z.enum(['Easy', 'Mixed', 'Uncomfortable']).optional(),
  instructionEase: z.enum(INSTRUCTION_EASE).optional(),
  share: z.boolean().optional(), progress: z.number().int().min(0).max(9).optional(),
  twist: z.enum(TWISTS as [string, ...string[]]).optional()
}).strict();
export const mutation = z.object({ operationId: z.uuid(), expectedRevision: z.number().int().nonnegative(), patch: answerPatch }).strict();
export const resetInput = z.object({operationId:z.uuid(),expectedRevision:z.number().int().nonnegative(),confirmation:z.string().trim().min(6).max(12)}).strict();
export const cardInput = z.object({
  operationId: z.uuid(), expectedRevision: z.number().int().nonnegative(), consentVersion: z.number().int().nonnegative(),
  kind: z.enum(['build', 'concept']), title: z.string().trim().max(100).default(''),
  description: z.string().trim().max(600).default(''), mine: z.string().trim().max(240).default(''),
  assetId: z.uuid().nullable().default(null)
}).strict();
export type Answers = z.infer<typeof answerPatch>;
export type Session = { id: string; code: string; title: string; run:number; phase: number; revision: number; closed: boolean; galleryPaused: boolean; stageView: string; endsAt: string | null; remainingMs: number | null; serverTime: string };
export const hasTimer = (session: Pick<Session, 'endsAt'|'remainingMs'>) => session.endsAt !== null || session.remainingMs !== null;
export type Participant = { id: string; revision: number; consentVersion: number; data: Answers };
export type Card = { id: string; kind: string; title: string; description: string; mine: string; assetId: string | null; hidden: boolean; updatedAt: string; twist: string };
export type Snapshot = { session: Session; total: number; before: number[]; after: number[]; paired: number; transitions: number[][]; works: Record<string, number>; feel: Record<string, number>; instructionEase?: Record<string, number>; progress: number[]; gallery: Card[]; capturedAt: string; telemetry?:HostTelemetry };
