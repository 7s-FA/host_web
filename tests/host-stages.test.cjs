const assert=require('node:assert/strict');
const sim=require('../engine.js');
const {stagesFor}=require('../host/build_scenarios.cjs');
for(let q=1;q<=20;q++){
 const p=sim.makePlan(q),stages=stagesFor(q);
 assert.ok(stages[0].time>0,'start immediately executes a useful trip');
 assert.equal(stages.at(-1).time,p.duration);
 assert.equal(stages.at(-1).completed,q);
 assert.equal(stages.at(-1).remaining,0);
 assert.equal(stages.at(-1).done,true);
 assert.deepEqual(stages.flatMap(s=>s.events),p.events,'retain all events, not just barrier events');
 for(const s of stages){
  assert.ok(!p.tasks.some(t=>t.type==='move'&&t.start<s.time-1e-7&&s.time<t.end-1e-7),`quantity ${q}: robot stopped inside trip at ${s.time}`);
  assert.ok(s.events.some(e=>e.time===s.time&&(['arrive','assembly_end','jig_ready','jig_home','pallet_end','complete'].includes(e.kind)||(e.kind==='part'&&e.part===3))));
 }
}
const p=sim.makePlan(2);
console.log(`PASS: no mid-trip host waits in orders 1–20; full event history and counters retained. 2 products: ${new Set(p.events.map(e=>e.time)).size} → ${stagesFor(2).length} stages.`);
