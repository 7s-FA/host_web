/* Failed-order reset, then stationary robot unlock. Never sends a movement goal. */
(function(root){
 'use strict';
 async function run({robot,orderId,stage,revision,read,reset,release,progress=()=>{},now=Date.now,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const initial=await read(),order=initial.order;
  if(!['M1','M2'].includes(robot)||!initial.bridge_connected||!initial.can_reset||initial.pending_commands||
    order?.status!=='failed'||order.id!==orderId||order.stage!==stage||(order.recovery_revision||0)!==revision)
   throw Error('실패 주문 또는 연결 상태가 변경되었습니다. 다시 확인하세요.');
  progress('실패 주문 초기화 중 · 필요한 정지 응답 확인');
  await reset({order_id:orderId,operator_confirmed:true});
  const deadline=now()+25000;
  while(true){
   const state=await read();
   if(!state.bridge_connected)throw Error('Host 연결 끊김 · 주문 초기화 결과 미확인, 잠금 해제 미전송');
   if(state.order&&state.order.id!==orderId)throw Error('주문이 변경됨 · 잠금 해제 미전송');
   if(!state.order&&!state.pending_commands&&!state.reset_pending)break;
   if(now()>=deadline)throw Error('주문 초기화 응답 시간 초과 · 잠금 해제 미전송');
   await delay(500);
  }
  progress('주문 초기화 완료 · '+robot+' 정지 잠금 해제 확인 중');
  // Check again after observing the acknowledgement. Another tab may have started an order.
  const beforeRelease=await read();
  if(!beforeRelease.bridge_connected||beforeRelease.order||beforeRelease.pending_commands)
   throw Error('주문 초기화 후 상태 변경 · 로봇 잠금 해제 미전송');
  const result=await release(robot);
  if(!result?.success)throw Error('주문은 초기화됐지만 '+robot+' 잠금 해제 미확인: '+(result?.message||'응답 없음'));
  return robot+' 오류 잠금 해제·실패 주문 초기화 완료 · 자동 이동 없음';
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={run};else root.CombinedReset={run};
})(typeof window!=='undefined'?window:globalThis);
