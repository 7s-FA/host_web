/* Same-origin local Host PC test client. The public site keeps standalone playback. */
(function(root){
 'use strict';
 const el=id=>document.getElementById(id);
 const local=['127.0.0.1','localhost'].includes(location.hostname)&&location.protocol==='http:';
 let client;
 try{client=sessionStorage.getItem('robot3-host-client');}catch(_){}
 if(!client){client=crypto.randomUUID();try{sessionStorage.setItem('robot3-host-client',client);}catch(_){}}
 const bridge={enabled:false,online:false,state:null,onchange:()=>{},ackBusy:false};
 let queue=Promise.resolve(),pollBusy=false,recovering=false;
 async function raw(action,data={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);
  try{
   const response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:client,message_id:crypto.randomUUID(),...data}),signal:controller.signal});
   const state=await response.json();
   if(!response.ok)throw Error(state.error||'호스트 요청 실패');
   return state;
  }finally{clearTimeout(timer);}
 }
 function paint(message){
  const s=bridge.state;
  const names={idle:'주문 대기',running:'단계 실행 중',waiting:'완료 수신 · 다음 지시 대기',paused:'일시정지 · 재개 필요',done:'주문 완료'};
  el('host-status').textContent=message||(!bridge.enabled?'자동 재생 모드':!bridge.online?'연결 끊김 · 진행 정지':`호스트 연결됨 · ${names[s?.status]||'연결 중'}`);
  el('host-connect').textContent=bridge.enabled?'연결 해제 · 시험 초기화':'호스트 연결';
  el('host-connect').disabled=!local;
  el('host-next').disabled=!bridge.online||s?.status!=='waiting';
  el('host-pause').disabled=!bridge.online||!['running','waiting','paused'].includes(s?.status);
  el('host-pause').textContent=s?.status==='paused'?'재개':'일시정지';
  el('host-reset').disabled=!bridge.online;
  el('host-auto').disabled=!bridge.online;
  el('host-auto').checked=!!s?.auto;
  el('host-version').textContent=!bridge.enabled?'':!s?'서버 버전 확인 대기':s.scenario_mode==='destination-v2'?`목적지 단위 v2 · 2개 주문 ${s.sample_stage_count}단계`:'구버전 호스트 서버 · 터미널에서 Ctrl+C 후 다시 실행하세요.';
  el('host-progress').textContent=s?.order_id?`주문 ${s.order_id} · 완료 회신 ${s.acked_seq}/${s.stage_count??'?'}단계 · 다음 ${s.command?.seq||'—'}`:'호스트 지시 → 웹 실행 → 완료 회신 → 다음 단계';
  el('host-log').textContent=(s?.log||[]).slice(-12).map(x=>`${x.at} ${x.kind}  ${x.detail}`).join('\n');
 }
 function call(action,data={}){
  const op=queue.then(async()=>{
   try{
    let s=await raw(action,data);
    // After any network/request failure require an explicit operator resume.
    if(recovering&&s.status==='running')s=await raw('pause');
    recovering=false;bridge.online=true;bridge.state=s;
    if(action==='disconnect'){bridge.enabled=false;bridge.online=false;bridge.state=null;}
    paint();bridge.onchange(bridge.state);return s;
   }catch(e){
    bridge.online=false;recovering=true;
    paint(`통신 중지 · ${e.name==='AbortError'?'호스트 응답 시간 초과':e.message}`);
    bridge.onchange(bridge.state);return null;
   }
  });
  queue=op.catch(()=>{});return op;
 }
 bridge.start=quantity=>call('start',{quantity});
 let stepBusy=false;
 bridge.step=async quantity=>{
  if(stepBusy||!bridge.online||!['idle','done','waiting'].includes(bridge.state?.status))return;
  stepBusy=true;
  try{
   const s=await call('auto',{enabled:false});
   if(!s)return;
   if(['idle','done'].includes(s.status))return await call('start',{quantity});
   if(s.status==='waiting')return await call('next');
  }finally{stepBusy=false;}
 };
 bridge.complete=()=>{
  const s=bridge.state;
  if(bridge.ackBusy||!bridge.online||s?.status!=='running'||!s.command)return;
  bridge.ackBusy=true;
  const c=s.command;
  call('ack',{order_id:c.order_id,seq:c.seq,time:c.target_time}).finally(()=>bridge.ackBusy=false);
 };
 bridge.init=callback=>{
  bridge.onchange=callback;
  el('host-connect').onclick=()=>{
   if(bridge.enabled){call('disconnect').then(s=>{if(!s){bridge.enabled=false;bridge.online=false;bridge.state=null;paint('자동 재생 모드 · 연결되지 않은 호스트는 응답 제한시간 후 정지합니다.');callback(null);}});return;}
   bridge.enabled=true;bridge.online=false;callback(null);paint('호스트 연결 중…');call('connect');
  };
  el('host-next').onclick=()=>call('next');
  el('host-pause').onclick=()=>call(bridge.state?.status==='paused'?'resume':'pause');
  el('host-reset').onclick=()=>call('reset');
  el('host-auto').onchange=e=>call('auto',{enabled:e.target.checked});
  el('host-local-help').hidden=local;
  paint();
  setInterval(async()=>{
   if(!bridge.enabled||pollBusy)return;
   pollBusy=true;await call('heartbeat');pollBusy=false;
  },500);
  if(local&&new URLSearchParams(location.search).has('host'))el('host-connect').click();
 };
 root.HostBridge=bridge;
})(window);
