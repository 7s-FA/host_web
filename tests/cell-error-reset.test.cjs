const assert=require('node:assert/strict');
const {run}=require('../assets/control/cell-error-reset.js');
const initial=()=>({bridge_connected:true,pending_commands:0,can_retry:true,order:{id:'old',status:'failed',stage:4,recovery_revision:0,completed:1}});
(async()=>{
 for(const label of ['자재창고','조립대'])for(const hasOrder of [true,false])for(const ready of [true,false]){
  let s=initial(),events=[];if(!hasOrder)s.order=null;s.can_retry=ready;const before=JSON.stringify(s.order);
  const result=await run({label,read:async()=>s,clear:async()=>{events.push('clear');return {success:true};},reset:async()=>{throw Error('must not delete order');}});
  assert.match(result,/초기화 완료/);assert.deepEqual(events,['clear']);assert.equal(JSON.stringify(s.order),before);
  if(hasOrder)assert.match(result,ready?/다음 단계로 재시도/:/응답 확인 필요/);
 }
 for(const fault of ['running','manual','offline','clear-failed','changed','revision','stage','full-reset']){
  let s=initial();if(fault==='running')s.order.status='running';if(fault==='manual')s.manual_move={};if(fault==='offline')s.bridge_connected=false;if(fault==='full-reset')s.full_reset={status:'running'};
  await assert.rejects(run({read:async()=>s,clear:async()=>{if(fault==='changed')s.order.id='new';if(fault==='revision')s.order.recovery_revision++;if(fault==='stage')s.order.stage++;return {success:fault!=='clear-failed'};}}));
 }
 console.log('PASS cell reset preserves order/stage/counts and rejects stale or unsafe state');
})().catch(e=>{console.error(e);process.exit(1)});
