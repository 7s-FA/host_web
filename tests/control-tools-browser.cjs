const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
 const errors=[],goals=[],posts=[],sockets=new Set();let stopSocket,cellSocket;
 let state={bridge_connected:true,bridge_configured:true,pending_commands:0,can_reset:true,can_manual_move:true,can_retry:true,can_start:false,conditions:[],log:[],
  devices:Object.fromEntries(['M1','M2','warehouse','production'].map(k=>[k,{state:'idle',detail:'fixture',log:[]} ])),
  order:{id:'failed',status:'failed',stage:3,stage_count:14,recovery_revision:0,product_type:'B',quantity:2,completed:0,product_remaining:2,transport_remaining:1,stage_label:'M1 조립대',fault:'M1 GO_TO_ASM: ERROR'}};
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*live=1&embedded=1',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Map fixture</title>'}));
 await page.route('**/api/live/**',async r=>{if(r.request().method()==='POST'){const action=new URL(r.request().url()).pathname.split('/').at(-1);posts.push({action,...r.request().postDataJSON()});assert.equal(action,'reset');state={...state,order:null,can_reset:false,can_start:true,can_retry:false,can_manual_move:false};}await r.fulfill({json:state});});
 await page.routeWebSocket(/.*/,ws=>{sockets.add(ws);ws.onMessage(raw=>{const m=JSON.parse(raw);
  if(m.id?.startsWith('robot-stop:'))stopSocket=ws;
  if(m.id?.startsWith('cell-controls:'))cellSocket=ws;
  if(m.op==='send_action_goal'){goals.push({ws,m});if(m.action==='/M1/data')ws.send(JSON.stringify({op:'action_result',id:m.id,action:m.action,result:true,status:4,values:{success:true,message:'IDLE'}}));}
 });});
 const publish=(ws,topic,value)=>ws.send(JSON.stringify({op:'publish',topic,msg:{data:JSON.stringify(value)}}));
 const telemetry=()=>{if(stopSocket){for(let i=1;i<=2;i++){publish(stopSocket,`/burger${i}/motion_owner/communication_status`,{mode:'idle'});publish(stopSocket,`/burger${i}/mission/status`,{status:'failed',destination:'asm'});}}if(cellSocket)publish(cellSocket,'/host/device_discovery',{stamp_ms:Date.now(),publishers:{arm1:['/arm1/server'],arm2:['/arm2/server'],arm3:['/arm3/server']}});};
 await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:8082')+'/control.html',{waitUntil:'networkidle'});const timer=setInterval(telemetry,500);telemetry();
 try{
  assert.equal(goals.length,0);assert.equal(posts.length,0);
  await page.waitForFunction(()=>!document.querySelector('[data-error-reset-robot="M1"]').disabled);
  await page.locator('[data-error-reset-robot="M1"]').click();assert.match(await page.locator('#reset-title').textContent(),/M1.*주문 초기화/);
  await page.locator('#cancel-reset').click();assert.equal(posts.length,0);
  await page.locator('[data-error-reset-robot="M1"]').click();await page.locator('#reset-confirmed').check();await page.locator('#confirm-reset').click();
  await page.waitForFunction(()=>document.getElementById('control-alert').textContent.includes('오류 잠금 해제·실패 주문 초기화 완료'));
  assert.deepEqual(posts,[{action:'reset',order_id:'failed',operator_confirmed:true}]);assert.deepEqual(goals[0].m.args,{command:'RESTART',cmd_val:0});assert.equal(goals[0].m.action,'/M1/data');
  const result=(g,ok=true)=>g.ws.send(JSON.stringify({op:'action_result',id:g.m.id,action:g.m.action,result:ok,status:ok?4:6,values:{success:ok,message:ok?'IDLE':'ERROR'}}));
  await page.waitForFunction(()=>!document.querySelector('[data-cell-stop="warehouse"]').disabled);
  await page.locator('[data-cell-stop="warehouse"]').click();let g=goals.at(-1);assert.equal(g.m.action,'/arm1/data');assert.deepEqual(g.m.args,{command:'EMER_STOP'});
  result(g,false);await page.waitForFunction(()=>document.querySelector('[data-cell-status="warehouse"]').dataset.phase==='error');assert(await page.locator('[data-cell-release="warehouse"]').isDisabled());
  await page.locator('[data-cell-stop="production"]').click();g=goals.at(-1);assert.equal(g.m.action,'/arm2/data');assert.equal(g.m.action_type,'host_pkg/action/Arm');result(g);
  await page.waitForFunction(()=>!document.querySelector('[data-cell-release="production"]').disabled);
  page.once('dialog',d=>d.dismiss());const count=goals.length;await page.locator('[data-cell-release="production"]').click();assert.equal(goals.length,count);
  page.once('dialog',d=>d.accept());await page.locator('[data-cell-release="production"]').click();g=goals.at(-1);assert.deepEqual(g.m.args,{command:'RESTART'});result(g);
  const beforePopup=goals.length;await page.locator('#open-robot-panel').click();
  const frame=page.frameLocator('#robot-panel-dialog iframe');await frame.getByRole('heading',{name:'로봇 제어',exact:true}).waitFor();
  assert(await page.locator('#robot-panel-dialog').isVisible());assert.equal(goals.length,beforePopup,'Popup opens with subscriptions only');
  // Feed panel owner status and verify Host interlock when an order starts.
  for(const ws of sockets)for(let i=1;i<=2;i++)try{publish(ws,`/burger${i}/motion_owner/communication_status`,{mode:'idle',error:null});}catch{}
  await frame.locator('[data-command="GO_TO_MAT"]').first().waitFor();
  state={...state,order:{id:'new-order',status:'running',stage:0,stage_count:14,product_type:'B',quantity:2},can_start:false,can_manual_move:false};
  await page.waitForTimeout(1200);assert(await frame.locator('[data-command="GO_TO_MAT"]').first().isDisabled());
  await page.screenshot({path:'/tmp/control-robot-popup.png',fullPage:true});await page.keyboard.press('Escape');await page.locator('#robot-panel-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>!document.querySelector('#robot-panel-dialog iframe').hasAttribute('src'));
  assert.equal(await page.locator('#robot-panel-dialog iframe').getAttribute('src'),null);assert.equal(goals.length,beforePopup,'Closing never cancels or replays');
  await page.screenshot({path:'/tmp/control-new-tools.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#open-robot-panel').click();
  assert(await page.locator('#robot-panel-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);console.log('PASS combined reset acknowledgement, arm stop/release/cancel/error, popup open/close, active order interlock, no automatic movement, mobile');
 }finally{clearInterval(timer);}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
