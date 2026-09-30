const assert=require('node:assert/strict');
const sim=require('../engine.js');
const first=sim.makePlan(2).tasks.find(t=>t.type==='move'&&t.actor===0);
assert.deepEqual(first.navigation.map(s=>s.code),['UNDOCK','TURN_180','NAV_HOME_WP','NAV_APPROACH','ARUCO_DOCK','IR_STOP']);
assert.equal(first.navigation[2].condition,'WP1 도착');
assert.equal(first.navigation[3].condition,'WP2 도착');
assert.deepEqual(sim.motionPose(first,first.start+first.navigation[3].end).position,sim.WAYPOINTS[2]);
for(let q=1;q<=20;q++){
 const plan=sim.makePlan(q);
 for(const move of plan.tasks.filter(t=>t.type==='move')){
  const steps=move.navigation;
  assert.equal(steps[0].start,0);
  assert.equal(steps.at(-1).end,move.motion.at(-1).end);
  assert.equal(steps.at(-1).code,'IR_STOP');
  for(let i=0;i<steps.length;i++){
   const step=steps[i];
   if(i)assert.equal(step.start,steps[i-1].end,'No gaps or overlaps in local state progression');
   const doneAt=move.start+step.end;
   assert.equal(sim.navigationState(move,doneAt).steps[i].done,true,'Completion at exact boundary');
   assert.equal(sim.navigationState(move,doneAt-1e-5).steps[i].done,false,'Do not complete early');
  }
  assert.equal(sim.navigationState(move,move.end).done,true);
  assert.equal(sim.navigationState(move,move.end-1e-5).steps.at(-1).done,false,'IR must remain pending during approach');
  if(move.to==='warehouse'){
   const nav=steps.find(s=>s.code==='NAV_APPROACH'),dock=steps.find(s=>s.code==='ARUCO_DOCK');
   assert.equal(nav.condition,'WP2 도착');assert.equal(nav.end,dock.start);
   const position=sim.motionPose(move,move.start+dock.start).position;
   assert(Math.hypot(position[0]-sim.WAYPOINTS[2][0],position[1]-sim.WAYPOINTS[2][1])<1e-7);
  }
  if(move.to==='waiting')assert(!steps.some(s=>s.code==='ARUCO_DOCK'),'Waiting bay has no marker');
  if(move.from==='home')assert.equal(steps.find(s=>s.code==='NAV_HOME_WP').condition,move.actor===0?'WP1 도착':'WP4 도착');
 }
 if(q>1){
  const stage=plan.tasks.find(t=>t.type==='move'&&t.actor===1&&t.from==='home');
  assert.equal(stage.to,'waiting','Keep Burger 2 waiting-bay staging');
 }
}
console.log('PASS: local departure → Nav2 → camera → IR stages, exact completion boundaries, both home junctions and marker-free waiting bay.');
