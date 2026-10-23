/* Clear only the stopped device job; retain the failed production checkpoint. */
(function(root){
 'use strict';
 async function run({label='조립대',read,clear,progress=()=>{}}){
  const initial=await read(),id=initial.order?.id??null,revision=initial.order?.recovery_revision??0,stage=initial.order?.stage;
  function valid(s){
   if(!s.bridge_connected||s.pending_commands||s.manual_move||s.reset_pending||s.full_reset?.status==='running'||s.full_reset?.uncertain||
      (s.order?.id??null)!==id||(s.order&&s.order.status!=='failed')||
      (s.order?.recovery_revision??0)!==revision||s.order?.stage!==stage)
    throw Error('주문·연결·작업 상태가 변경되었습니다. 오류 해제 결과를 확인하세요.');
  }
  valid(initial);progress(label+' 남은 작업 종료 확인 중');
  const result=await clear();
  if(!result?.success)throw Error(label+' 초기화 미확인: '+(result?.message||'응답 없음')+' · 실패 주문 유지');
  const state=await read();valid(state);
  return label+' 오류 초기화 완료 · '+(id===null?'자동 이동 없음':state.can_retry?'실패 단계 유지 · 다음 단계로 재시도':'실패 단계 유지 · 다른 장치 종료·정지 응답 확인 필요');
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={run};else root.CellErrorReset={run};
})(typeof window!=='undefined'?window:globalThis);
