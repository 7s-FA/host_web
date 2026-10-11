// Keep reference assertions stable when a maintainer edits config.js.
Object.assign(require('../settings.js').defaults, structuredClone(require('./baseline-config.cjs')));
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../settings.js'),sim=require('../engine.js');
const clone=()=>structuredClone(S.defaults);
for(const [g,k,,,min,max] of S.fields){for(const bad of [0,-1,NaN,Infinity,'1',max+1,min-.01]){const c=clone();c[g][k]=bad;assert.throws(()=>S.validate(c));}}
assert.throws(()=>S.validate({version:2}));
const changed=clone();changed.burger1.forwardSpeed=2;changed.burger1.reverseSpeed=.5;changed.burger1.turnSpeed=45;
const original=sim.makePlan(2),altered=sim.makePlan(2,changed);
const baseMove=original.tasks.find(t=>t.actor===0&&t.type==='move').motion;
const newMove=altered.tasks.find(t=>t.actor===0&&t.type==='move').motion;
baseMove.forEach((p,i)=>assert(Math.abs((newMove[i].end-newMove[i].start)/(p.end-p.start)-(p.type==='turn'?2:p.reversing?2:.5))<1e-8));
const scenarios=[clone(),changed];
for(const edge of [4,5]){const c=clone();for(const f of S.fields)c[f[0]][f[1]]=f[edge];scenarios.push(c);}
// Different arm and robot timings must retain the dependency graph.
for(let i=0;i<16;i++){const c=clone();for(const [g,k,,,min,max] of S.fields)c[g][k]=min+(max-min)*((i*17+k.length*13)%101)/100;scenarios.push(c);}
for(const c of scenarios)for(const n of [1,2]){
 const p=sim.makePlan(n,c),stages=sim.stagesFor(n,c);
 assert.equal(sim.snapshot(p,p.duration).completed,n);
 assert.equal(stages.at(-1).time,p.duration);
 for(const stage of stages)assert(!p.tasks.some(t=>t.type==='move'&&t.start<stage.time-1e-7&&stage.time<t.end-1e-7));
 for(const actor of [0,1,'arm1','arm2','arm3','linear']){
  const tasks=p.tasks.filter(t=>t.actor===actor&&t.type!=='gate').sort((a,b)=>a.start-b.start);
  for(let i=1;i<tasks.length;i++)assert(tasks[i].start>=tasks[i-1].end-1e-7,`${actor} overlap`);
 }
 if(n>1){const other=p.tasks.find(t=>t.type==='move'&&t.from==='waiting'&&t.to==='home');const last=p.tasks.find(t=>t.type==='move'&&t.from==='assembly'&&t.to==='home');assert(last.start>=other.end);}
}
const saved=JSON.stringify({...clone(),burger1:{...clone().burger1,forwardSpeed:2},process:{...clone().process,assemblySeconds:13}});
let reads=0;
const window={SIMULATION_CONFIG:clone(),localStorage:{getItem(){reads++;return saved;}}};
vm.runInNewContext(fs.readFileSync('settings.js','utf8'),{window});
assert.equal(reads,0,'Legacy browser settings must not change fixed simulation defaults');
assert.equal(window.SimulationSettings.defaults.burger1.forwardSpeed,1);
assert.equal(window.SimulationSettings.defaults.process.assemblySeconds,6);
assert.equal(window.SimulationSettings.save,undefined);
assert.equal(window.SimulationSettings.read,undefined);
console.log('PASS: internal configuration validation, process interlocks and legacy browser settings ignored.');
