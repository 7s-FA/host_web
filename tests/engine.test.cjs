// Keep reference assertions stable when a maintainer edits config.js.
Object.assign(require('../settings.js').defaults, structuredClone(require('./baseline-config.cjs')));
const assert=require('node:assert/strict');
const {makePlan,snapshot}=require('../engine.js');
let cases=0;
for(const n of [1,2,3,4,5,10,20]){
 const p=makePlan(n),end=snapshot(p,p.duration);
 assert.equal(end.transport,0);assert.equal(end.remaining,0);assert.equal(end.completed,n);assert(end.done);
 end.robots.forEach(r=>{assert.equal(r.place,'home');assert.equal(r.parts,0);});
 assert.equal(p.events.filter(e=>e.kind==='dispatch').length,n);
 assert.equal(p.events.filter(e=>e.kind==='pallet_end').length,n);
 assert.equal(p.events.filter(e=>e.kind==='part').length,n*3);
 for(const j of p.jobs){
  assert(j.dispatch>=j.loaded);assert(j.assemblyStart>=j.arrived);
  if(j.id){const prev=p.jobs[j.id-1];assert(j.dispatch>=prev.palletEnd);assert(j.dispatch>=prev.waitEnd);assert(j.warehouseStart>=prev.assemblyStart);}
 }
 for(let t=0;t<=p.duration;t+=.13){const s=snapshot(p,t);assert(s.transport>=0&&s.remaining>=0);assert.equal(s.remaining+s.completed,n);assert(s.transport<=s.remaining);const inAssembly=s.active.filter(a=>a.actor==='arm2');assert(inAssembly.length<=1);}
 for(const actor of [0,1,'arm1','arm2','arm3','linear']){const jobs=p.tasks.filter(t=>t.actor===actor&&t.end>t.start&&t.type!=='gate').sort((a,b)=>a.start-b.start);for(let i=1;i<jobs.length;i++)assert(jobs[i].start>=jobs[i-1].end,`${actor} resource overlap`);}
 // Repeated/rewound reads never decrement persistent counters twice.
 assert.deepEqual(snapshot(p,10),snapshot(p,10));snapshot(p,p.duration);assert.deepEqual(snapshot(p,0),snapshot(p,0));cases++;
}
const p=makePlan(2),j=p.jobs;
assert(j[1].loadStart<j[0].assemblyEnd,'second load overlaps first assembly');
for(const job of j){assert.equal(snapshot(p,job.dispatch-.001).transport,snapshot(p,job.dispatch).transport+1);assert.equal(snapshot(p,job.palletEnd-.001).remaining,snapshot(p,job.palletEnd).remaining+1);}
for(const bad of [0,-1,21,NaN,Infinity,1.2,'2'])assert.throws(()=>makePlan(bad));
console.log(`PASS: ${cases} order sizes; counters, all 3 parts, concurrent work, exclusive resources, interlocks, seek and return-to-home.`);
// All routes must follow floor aisles, with no diagonal cuts through workboards.
const {path,position,POINTS}=require('../engine.js');
const floorAreas=[[280,250,400,975],[50,640,435,850]];
const inFloor=([x,y])=>floorAreas.some(([l,t,r,b])=>x>=l&&x<=r&&y>=t&&y<=b);
for(const n of [1,2,3,20])for(const task of makePlan(n).tasks.filter(t=>t.type==='move')){
 const route=path(task.from,task.to,task.actor);
 const endpoint=place=>POINTS[place==='home'?'home'+(task.actor+1):place];
 assert.deepEqual(route[0],endpoint(task.from));
 assert.deepEqual(route.at(-1),endpoint(task.to));
 for(let i=1;i<route.length;i++)assert(route[i][0]===route[i-1][0]||route[i][1]===route[i-1][1],'Only orthogonal aisle segments');
 for(let i=0;i<=100;i++)assert(inFloor(position(route,i/100)),`${task.from} → ${task.to} leaves the floor aisle`);
}
assert(POINTS.home1[0]<POINTS.warehouse[0]&&POINTS.home1[1]>POINTS.warehouse[1]);
assert(POINTS.assembly[0]>POINTS.warehouse[0]&&POINTS.assembly[1]>POINTS.warehouse[1]);
console.log('PASS: photo-oriented floor layout, route endpoints, orthogonal aisles and workboard avoidance.');

// The second robot stages as soon as the first reaches storage, before dispatch.
for(let n=1;n<=20;n++){
 const plan=makePlan(n);
 const firstArrival=plan.events.find(e=>e.kind==='arrive'&&e.robot===0&&e.to==='warehouse');
 const staging=plan.tasks.filter(t=>t.actor===1&&t.type==='move'&&t.from==='home'&&t.to==='waiting');
 if(n===1){
  assert.equal(staging.length,0);
  assert(plan.tasks.every(t=>t.actor!==1),'One-item orders leave burger 2 at home');
 }else{
  assert.equal(staging.length,1);
  assert.equal(staging[0].start,firstArrival.time);
  assert(staging[0].start<plan.jobs[0].dispatch);
  assert.equal(snapshot(plan,firstArrival.time-.001).robots[1].status,'초기위치 대기');
  assert.equal(snapshot(plan,firstArrival.time).robots[1].status,'초기위치 10cm 후진 중');
  assert.equal(snapshot(plan,staging[0].end).robots[1].status,'대기장소 대기');
 }
}
for(const robot of [0,1]){
 const route=path('warehouse','assembly',robot);
 assert.equal(route.length,robot===0?6:4,'Storage exit includes short backup and Burger 1 via points');
 assert.deepEqual(route.slice(0,2),[[340,300],[340,340]]);
 const approach=route.at(-2),dock=route.at(-1);
 assert.equal(approach[1],dock[1],'Final approach is horizontal');
 assert(dock[0]>approach[0],'Dock by moving straight right toward the workboard');
 assert.deepEqual(path('assembly','warehouse',robot)[0],route.at(-1));
 assert.deepEqual(path('assembly','warehouse',robot).at(-1),route[0]);
}
console.log('PASS: staging trigger for orders 1–20, exact arrival boundary and straight assembly docking.');
// Turning occupies time at a fixed point; driving never slides sideways.
const {pose,DOCK_HEADINGS,motionPose}=require('../engine.js');
const angularDistance=(a,b)=>Math.abs((a-b+540)%360-180);
for(const n of [1,2,3,20]){
 const plan=makePlan(n);
 for(const task of plan.tasks.filter(t=>t.type==='move')){
  for(const phase of task.motion){
   const at=f=>snapshot(plan,task.start+phase.start+(phase.end-phase.start)*f).robots[task.actor];
   if(phase.type==='turn'){
    const a=at(.1),b=at(.5),c=at(.9);
    assert.deepEqual(a.position,c.position,'No translation while turning');
    assert(a.turning&&b.turning&&c.turning);
    assert(angularDistance(a.heading,c.heading)>1,'Rotation must animate over time');
    assert(angularDistance(b.heading,(phase.heading+phase.delta/2+360)%360)<1e-8);
   }else{
    const state=at(.5),radians=state.heading*Math.PI/180;
    const dx=phase.to[0]-phase.from[0],dy=phase.to[1]-phase.from[1],distance=Math.hypot(dx,dy);
    const direction=phase.reversing?-1:1;
    assert(!state.turning);
    assert(Math.abs(Math.sin(radians)-direction*dx/distance)<1e-8);
    assert(Math.abs(-Math.cos(radians)-direction*dy/distance)<1e-8);
   }
  }
  for(let i=1;i<task.motion.length;i++){
   const boundary=task.start+task.motion[i].start;
   const a=motionPose(task,boundary-.00001),b=motionPose(task,boundary+.00001);
   assert(Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1])<.1,'Continuous position');
   assert(angularDistance(a.heading,b.heading)<.01,'Continuous heading at phase boundary');
  }
  assert.equal(motionPose(task,task.end).heading,DOCK_HEADINGS[task.to]);
 }
 const end=snapshot(plan,plan.duration);
 end.robots.forEach(r=>assert.equal(r.heading,DOCK_HEADINGS.home));
 const mid=snapshot(plan,plan.duration/2);snapshot(plan,plan.duration);assert.deepEqual(snapshot(plan,plan.duration/2),mid);
}
console.log('PASS: stationary animated turns, aligned driving, continuous headings and deterministic seek.');
for(const n of [2,3,20]){
 const plan=makePlan(n);
 for(const task of plan.tasks.filter(t=>t.type==='move'&&t.to==='waiting')){
  const before=snapshot(plan,task.end-.01).robots[task.actor];
  assert.equal(before.heading,180,'Face into waiting bay while parking forwards');
  assert.equal(before.reversing,false);
  assert.equal(before.status,'대기장소 전진 주차 중');
  assert(before.position[1]<POINTS.waiting[1]);
  const parked=snapshot(plan,task.end).robots[task.actor];
  assert.equal(parked.heading,180);
  assert.deepEqual(parked.position,POINTS.waiting);
 }
 for(const task of plan.tasks.filter(t=>t.type==='move'&&t.from==='waiting')){
  const phases=task.motion;
  assert.equal(phases[0].type,'drive');assert(phases[0].reversing);
  assert.equal(phases[0].heading,180);
  assert.equal(phases[0].to[1]-phases[0].from[1],-40,'Short schematic undock only');
  assert.equal(phases[1].type,'turn');assert.equal(Math.abs(phases[1].delta),180);
  assert.deepEqual(phases[1].position,phases[0].to,'Turn only after clearing waiting bay');
  assert.equal(phases[2].type,'drive');assert.equal(phases[2].reversing,false);
  const leaving=snapshot(plan,task.start+.01).robots[task.actor];
  assert.equal(leaving.heading,180);
  assert.equal(leaving.reversing,true);
  assert.equal(leaving.status,'대기장소 10cm 후진 중');
  assert(leaving.position[1]<POINTS.waiting[1],'Reverse out of bay before turning');
 }
}
console.log('PASS: forward parking into waiting bay, rear IR stop and short reverse/180° forward departure.');

for(const n of [1,2,3,20]){
 const plan=makePlan(n);
 snapshot(plan,0).robots.forEach(r=>assert.equal(r.heading,270));
 snapshot(plan,plan.duration).robots.forEach(r=>assert.equal(r.heading,270));
 for(const task of plan.tasks.filter(t=>t.type==='move')){
  const phases=task.motion;
  if(task.from==='home'){
   assert.equal(phases[0].type,'drive');assert(phases[0].reversing);
   assert.equal(phases[0].heading,270);
   assert.equal(phases[0].to[0]-phases[0].from[0],40,'Short schematic undock only');
   assert.equal(phases[1].type,'turn');assert.equal(Math.abs(phases[1].delta),180);
   assert.equal(phases[1].heading,270);assert.equal(phases[1].targetHeading,90);
   assert.equal(phases[2].type,'drive');assert.equal(phases[2].reversing,false);
  }
  if(task.from==='warehouse'||task.from==='assembly'){
   assert.equal(phases[0].type,'drive');assert(phases[0].reversing);
   assert.equal(phases[0].heading,DOCK_HEADINGS[task.from]);
   assert.equal(Math.hypot(phases[0].to[0]-phases[0].from[0],phases[0].to[1]-phases[0].from[1]),40);
   assert.equal(phases[1].type,'turn');assert.equal(Math.abs(phases[1].delta),180);
   assert.deepEqual(phases[1].position,phases[0].to,'Turn only after clearing the dock');
   assert.equal(phases[2].type,'drive');assert.equal(phases[2].reversing,false);
  }
  phases.filter(p=>p.type==='drive'&&p.reversing).forEach(p=>{
   assert(['home','warehouse','assembly','waiting'].includes(task.from)&&p===phases[0],'No reverse transit outside local undock');
  });
  if(task.from==='assembly'&&task.to==='home'){
   assert(phases.slice(1).filter(p=>p.type==='drive').every(p=>!p.reversing));
   assert.equal(phases.at(-1).type,'drive');assert.equal(phases.at(-1).heading,270);
  }
 }
}
console.log('PASS: all four docks use short reverse exit → 180° turn after clearance → forward transit.');

for(let n=2;n<=20;n++){
 const plan=makePlan(n),last=plan.jobs.at(-1),other=1-last.robot;
 const returning=plan.tasks.find(t=>t.actor===other&&t.type==='move'&&t.from==='waiting'&&t.to==='home');
 assert(returning.start>=last.arrived,'Wait until the other robot finishes assembly docking');
 assert.equal(snapshot(plan,last.arrived-.001).robots[other].status,'대기장소 대기');
 assert(!plan.tasks.some(t=>t.actor===other&&t.type==='move'&&t.start<last.arrived&&t.end>last.dispatch),'No simultaneous travel during final delivery');
 assert.equal(snapshot(plan,last.arrived).transport,0);
}
console.log('PASS: final delivery docking completes before the waiting robot returns home, orders 2–20.');

for(const robot of [0,1]){
 const home=POINTS['home'+(robot+1)];
 assert.deepEqual(path('assembly','home',robot),[POINTS.assembly,[360,750],[340,750],[340,home[1]],home]);
 assert.deepEqual(path('waiting','home',robot),robot===0?[POINTS.waiting,[340,880],[340,750],[340,700],home]:[POINTS.waiting,[340,880],[340,home[1]],home]);
}
console.log('PASS: Burger 1 via points and Burger 2 return route avoid extra home-side detours.');
