/* Clear a stopped cell job first, then archive its failed Host order. */
(function(root){
 'use strict';
 async function run({label='조립대',read,clear,reset,progress=()=>{},now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms))}){
  const initial=await read(),id=initial.order?.id??null,revision=initial.order?.recovery_revision??0;
  function valid(s){
   if(!s.bridge_connected||s.pending_commands||s.manual_move||(s.order?.id??null)!==id||
      (s.order&&s.order.status!=='failed')||(s.order?.recovery_revision??0)!==revision)
    throw Error('주문·연결·작업 상태가 변경되었습니다. 초기화를 중단합니다.');
  }
  valid(initial);progress(label+' 남은 작업 종료 확인 중');
  const result=await clear();
  if(!result?.success)throw Error(label+' 초기화 미확인: '+(result?.message||'응답 없음')+' · 실패 주문 유지');
  if(id===null){valid(await read());return label+' 오류 초기화 완료 · 자동 이동 없음';}
  let deadline=now()+15000;
  while(true){const s=await read();valid(s);if(s.can_reset)break;
   if(now()>=deadline)throw Error(label+' 작업은 종료됐지만 Host 종료 응답 미확인 · 실패 주문 유지');await delay(300);}
  progress(label+' 작업 종료 확인 · 실패 주문 초기화 중');
  valid(await read());
  await reset({order_id:id,operator_confirmed:true});deadline=now()+25000;
  while(true){const s=await read();
   if(!s.bridge_connected)throw Error('Host 연결 끊김 · 주문 초기화 결과 미확인');
   if(!s.order&&!s.pending_commands&&!s.reset_pending)return label+' 오류·실패 주문 초기화 완료 · 자동 이동 없음';
   if(s.order?.id!==id)throw Error('주문이 변경되었습니다. 초기화 결과를 확인하세요.');
   if(now()>=deadline)throw Error(label+' 작업은 종료됐지만 주문 초기화 결과 미확인');await delay(300);
  }
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={run};else root.CellErrorReset={run};
})(typeof window!=='undefined'?window:globalThis);
