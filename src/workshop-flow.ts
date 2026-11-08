import {WORKSHOP_NAME,hasTimer,type Session} from '../server/model';

export const WORKSHOP_BRIEF='Create something that brings people together.';
export const WORKSHOP_PROMPT_LABEL='Today’s prompt';
export const REFLECTION_PROMPTS=[
  'What was the AI’s concept?',
  'How easy was it to follow the AI’s instructions?',
  'What’s the first thing you would change?',
] as const;

export const STAGE_STEPS=['Join','Get a plan','Build','Reflect','Make it yours','Finish'];
const stageCues=[
  {title:'Get an AI build plan',steps:[
    'Spread out your loose bricks. Take a photo.',
    'Send the photo and prompt to your AI app.',
    'Let the AI app create a concept and instructions.',
    `When you have your instructions, bring them back into ${WORKSHOP_NAME}`,
  ]},
  {title:'Build what the AI suggests',steps:['Try the AI’s plan with the pieces you have.','If a piece is missing, use the closest one.',`Come back to ${WORKSHOP_NAME} when the round ends.`]},
  {title:'Reflect on the first build',steps:REFLECTION_PROMPTS},
  {title:'Make it yours',steps:['Return to the same AI chat.','Tell it what you want to change.','Develop the concept in your own direction. It can become a game, an experience, or anything else.']},
  {title:'Make a concept card',steps:['Give your developed idea a name.','Describe it in one sentence.','Share it on the big screen if you’d like.']},
  {title:'Reflect together',steps:['When did you follow the AI? When did you make the decisions?','Share one thing you noticed with the room.']},
] as const;

export function stageCue(session:Session){
  if(session.closed)return {title:'Thanks for building',steps:['Take your ideas with you.'],step:5};
  if(session.phase<0)return {title:`Join ${WORKSHOP_NAME}`,steps:['Scan the QR code with your phone.','Choose the AI app you’ll use today.'],step:0};
  if(session.phase===2&&!hasTimer(session))return {title:'Photograph your build',steps:[`Open ${WORKSHOP_NAME} on your phone.`,'Take a photo of what you actually built, even if it’s unfinished.'],step:3};
  return {...stageCues[session.phase],step:Math.min(session.phase+1,session.phase===4?4:5)};
}
