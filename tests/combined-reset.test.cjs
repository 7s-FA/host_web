const assert=require('node:assert/strict');
const {run}=require('../assets/control/combined-reset.js');
const initial=()=>({bridge_connected:true,can_retry:true,pending_commands:0,order:{id:'order',status:'failed',stage:3,recovery_revision:2,completed:1}});
(async()=>{
 for(const robot of ['M1','M2']){
  let s=initial(),events=[];const before=JSON.stringify(s.order);
  const result=await run({robot,orderId:'order',stage:3,revision:2,read:async()=>s,reset:async()=>{throw Error('must not reset');},release:async name=>{events.push(name);return {success:true};}});
  assert.match(result,/다음 단계로 재시도/);assert.deepEqual(events,[robot]);assert.equal(JSON.stringify(s.order),before);
 }
 for(const fault of ['changed','offline','unconfirmed','release-failed','new-order']){
  let s=initial(),reads=0,releases=0;if(fault==='offline')s.bridge_connected=false;if(fault==='unconfirmed')s.can_retry=false;
  await assert.rejects(run({robot:'M1',orderId:'order',stage:fault==='changed'?4:3,revision:2,read:async()=>{if(++reads===2&&fault==='new-order')s.order.id='new';return s;},release:async()=>{releases++;return {success:false};}}));
  assert.equal(releases,fault==='release-failed'?1:0);
 }
 console.log('PASS AMR unlock preserves checkpoint; unconfirmed/stale/disconnected state blocks release');
})().catch(e=>{console.error(e);process.exit(1)});
