/* Fresh challenge/ack handshake for workcell V2. Never sends an Action itself. */
(function(root){
 'use strict';
 function create({now=()=>performance.now(),uuid=()=>crypto.randomUUID().replaceAll('-','')}={}){
  const client=uuid();let epoch=null,ack=null,pending=new Map();
  function reset(){epoch=null;ack=null;pending.clear();}
  function ready(){return !!ack&&now()-ack.at>=0&&now()-ack.at<1500;}
  function receive(text){
   let m;try{m=JSON.parse(text);}catch{return null;}
   if(!m||!['epoch','nonce'].every(k=>typeof m[k]==='string'&&m[k].length>0&&m[k].length<=128))return null;
   const time=now();for(const [k,t]of pending)if(time-t>=1500)pending.delete(k);
   if(m.kind==='challenge'){
    if(epoch!==m.epoch){reset();epoch=m.epoch;}
    if(pending.has(m.nonce))return null;
    pending.set(m.nonce,time);return JSON.stringify({client_id:client,epoch,nonce:m.nonce});
   }
   if(m.kind==='ack'&&m.client_id===client&&m.epoch===epoch&&pending.has(m.nonce)){
    const at=pending.get(m.nonce);if(time-at<1500&&(!ack||at>ack.at))ack={epoch,nonce:m.nonce,at};
   }
   return null;
  }
  function encode(command){
   if(!ready()){if(command==='EMER_STOP')return command;throw Error('제작공정 V2 연결 확인 대기');}
   return JSON.stringify({version:2,client_id:client,request_id:uuid(),attempt_id:uuid(),command,epoch:ack.epoch,nonce:ack.nonce});
  }
  return {receive,ready,encode,reset};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={create};else root.WorkcellSession={create};
})(typeof window!=='undefined'?window:globalThis);
