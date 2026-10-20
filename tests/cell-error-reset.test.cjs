const assert=require('node:assert/strict');
const {run}=require('../assets/control/cell-error-reset.js');
const initial=()=>({bridge_connected:true,pending_commands:0,can_reset:true,order:{id:'old',status:'failed',recovery_revision:0}});
(async()=>{
 for(const label of ['자재창고','조립대'])for(const hasOrder of [true,false]){
  let s=initial(),events=[];if(!hasOrder)s.order=null;
  const result=await run({label,read:async()=>s,clear:async()=>{events.push('clear');return {success:true};},reset:async()=>{events.push('reset');s.order=null;}});
  assert.ok(result.startsWith(label));
  assert.match(result,/초기화 완료/);assert.deepEqual(events,hasOrder?['clear','reset']:['clear']);
 }
 for(const fault of ['running','manual','offline','clear-failed','changed','timeout','reset-failed']){
  let s=initial(),resets=0,time=0;
  if(fault==='running')s.order.status='running';if(fault==='manual')s.manual_move={};if(fault==='offline')s.bridge_connected=false;
  await assert.rejects(run({read:async()=>s,clear:async()=>{
   if(fault==='changed')s.order.id='new';if(fault==='timeout')s.can_reset=false;
   return {success:fault!=='clear-failed'};},reset:async()=>{resets++;throw Error('reset failed');},now:()=>time,delay:async ms=>time+=ms}));
  assert.equal(resets,fault==='reset-failed'?1:0,fault);
 }
 console.log('PASS cell reset: no resume/movement; device ack before order reset; stale, running, manual, offline, timeout and partial failure guards');
})().catch(e=>{console.error(e);process.exit(1)});
