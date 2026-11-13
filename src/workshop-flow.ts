import {CHANGE_QUESTION,WORKSHOP_NAME,buildFirstFlow,hasTimer,requiredFlow,revisedFlow,type Session} from '../server/model';

export const WORKSHOP_BRIEF='Create something that brings people together.';
export const WORKSHOP_PROMPT_LABEL='Today’s prompt';
export const IDEA_LIKING_QUESTION='How much did you like the idea?';
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
  const required=requiredFlow(session);
  const buildFirst=buildFirstFlow(session);
  if(required&&session.phase===0)return {title:'Get an AI build plan',steps:[
    ...stageCues[0].steps.slice(0,3),
    buildFirst?'Come back to The Lab and tell us what you got. Save the image after building.':'When you have your instructions, bring them back into The Lab. Save the first idea and an image.',
  ],step:1};
  if(buildFirst&&session.phase===1)return {title:'Start building',steps:['Use whatever came back from your AI.','If you’re still waiting, start with the pieces you have.',`Come back to ${WORKSHOP_NAME} when time is up.`],step:2};
  if(required&&session.phase===5&&session.stageView==='final-exchange')return {title:'Compare with your neighbour',steps:['Show each other your final concept cards.','Take one minute each to explain what changed and why.'],step:5};
  if(session.phase===2&&!hasTimer(session)){
    const steps=[`Open ${WORKSHOP_NAME} on your phone.`,'Take a photo of what you actually built, even if it’s unfinished.'];
    if(buildFirst)steps.push('Save the AI’s first idea and a screenshot if you got one.');
    if(revisedFlow(session)&&!required)steps.push('If you have a plan, share a short label for the AI’s first idea.');
    return {title:'Photograph your build',steps,step:3};
  }
  if(revisedFlow(session)&&session.phase===2){
    if(session.exchange)return {title:'Show your neighbour',steps:['Show the person next to you what you built.',buildFirst?'Take one minute each to finish “I want to change…”':'Take one minute each to say what you would change and hear their idea.','Choose one change to take back to your AI chat.'],step:3};
    return {title:'Reflect on the first build',steps:required?['What would you change first?',REFLECTION_PROMPTS[1],IDEA_LIKING_QUESTION]:['What would you change first?',REFLECTION_PROMPTS[1]],step:3};
  }
  if(required&&session.phase===3)return {title:'Make it yours',steps:['What’s the first thing you’d do to make this yours?','Take that change back to your AI chat.','The bricks were a prototype. Your idea can become a game, a ritual, a service, or an experience.'],step:4};
  if(required&&session.phase===4)return {title:buildFirst?'Save your final card':'Make a concept card',steps:['Name your idea and describe it in one sentence.','Upload a final image, a screenshot, or a photo of a sketch.','Add one line about what changed.'],step:4};
  if(buildFirst&&session.phase===5)return {title:'Reflect together',steps:[CHANGE_QUESTION,'Tap one answer on your phone.','Pick a pair from the wall. What prompted the change?'],step:5};
  if(revisedFlow(session)&&session.phase===5)return {title:'Reflect together',steps:['Compare the AI’s first ideas with the final cards.','What changed, and what prompted that decision?','Find an idea someone kept. What made it worth keeping?'],step:5};
  return {...stageCues[session.phase],step:Math.min(session.phase+1,session.phase===4?4:5)};
}
