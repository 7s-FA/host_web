const assert=require('node:assert/strict');
const {run}=require('../assets/control/combined-reset.js');
const initial=()=>({bridge_connected:true,can_reset:true,pending_commands:0,order:{id:'order',status:'failed',stage:3,recovery_revision:2}});
(async()=>{
 for(const robot of ['M1','M2']){
  let state=initial(),time=0,events=[];
  const result=await run({robot,orderId:'order',stage:3,revision:2,read:async()=>state,
   reset:async payload=>{events.push(['reset',payload]);state={...state,order:null};},
   release:async name=>{events.push(['release',name]);return {success:true};},now:()=>time,delay:async ms=>time+=ms});
  assert.match(result,/초기화 완료/);assert.deepEqual(events.map(x=>x[0]),['reset','release']);
  assert.equal(events[0][1].order_id,'order');
 }
 for(const failure of ['changed','offline','timeout','release-failed','new-order']){
  let state=initial(),time=0,releases=0,reads=0;
  await assert.rejects(run({robot:'M1',orderId:'order',stage:failure==='changed'?4:3,revision:2,
   read:async()=>{reads++;if(failure==='new-order'&&reads===3)return {...state,order:{id:'new'}};return state;},
   reset:async()=>{if(failure==='offline')state.bridge_connected=false;else if(failure!=='timeout')state.order=null;},
   release:async()=>{releases++;return {success:false,message:'rejected'};},now:()=>time,delay:async ms=>time+=ms}));
  assert.equal(releases,failure==='release-failed'?1:0,failure);
 }
 console.log('PASS: failed-order acknowledgement precedes unlock; stale order, disconnect, timeout, new order and partial failure stop the sequence');
})().catch(e=>{console.error(e);process.exit(1)});
