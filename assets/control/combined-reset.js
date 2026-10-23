/* Release a stationary robot lock without deleting the failed order. */
(function(root){
 'use strict';
 async function run({robot,orderId,stage,revision,read,release,progress=()=>{}}){
  function valid(s){
   const o=s.order;
   if(!['M1','M2'].includes(robot)||!s.bridge_connected||!s.can_retry||s.pending_commands||s.manual_move||s.reset_pending||
      s.full_reset?.status==='running'||s.full_reset?.uncertain||o?.status!=='failed'||o.id!==orderId||o.stage!==stage||(o.recovery_revision||0)!==revision)
    throw Error('실패 단계 또는 작업 종료 상태가 변경되었습니다. 다시 확인하세요.');
  }
  valid(await read());progress(robot+' 오류 잠금 해제 확인 중 · 실패 단계 유지');
  valid(await read());
  const result=await release(robot);
  if(!result?.success)throw Error(robot+' 잠금 해제 미확인: '+(result?.message||'응답 없음')+' · 실패 주문 유지');
  valid(await read());
  return robot+' 오류 초기화 완료 · 실패 단계 유지 · 다음 단계로 재시도';
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={run};else root.CombinedReset={run};
})(typeof window!=='undefined'?window:globalThis);
