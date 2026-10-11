const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8082';
  for(const path of ['/?live=1','/','/control.html']){
   const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],goals=[],stopSockets=new Set();let stopSocket;
   page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
   await page.routeWebSocket(/.*/,socket=>socket.onMessage(raw=>{
    const msg=JSON.parse(raw);
    if(msg.op==='subscribe'&&msg.id?.startsWith('robot-stop:')){stopSocket=socket;stopSockets.add(socket);}
    if(msg.op==='send_action_goal')goals.push({socket,msg});
   }));
   await page.goto(base+path,{waitUntil:'networkidle'});
   const stop=robot=>page.locator('[data-stop-robot="'+robot+'"]'),restart=robot=>page.locator('[data-restart-robot="'+robot+'"]'),status=robot=>page.locator('[data-stop-status="'+robot+'"]');
   const waitEnabled=(kind,robot,enabled)=>page.waitForFunction(({kind,robot,enabled})=>document.querySelector('[data-'+kind+'-robot="'+robot+'"]').disabled===!enabled,{kind,robot,enabled});
   const waitPhase=(robot,phase)=>page.waitForFunction(({robot,phase})=>document.querySelector('[data-stop-status="'+robot+'"]').dataset.phase===phase,{robot,phase});
   const publish=(robot,topic,value)=>stopSocket.send(JSON.stringify({op:'publish',topic:'/burger'+robot.at(-1)+'/'+topic,msg:{data:JSON.stringify(value)}}));
   const owner=(robot,mode='idle')=>publish(robot,'motion_owner/communication_status',{mode});
   const mission=(robot,state)=>publish(robot,'mission/status',{status:state});
   const result=(goal,overrides={})=>goal.socket.send(JSON.stringify({op:'action_result',id:goal.msg.id,action:goal.msg.action,result:true,status:4,values:{success:true,message:'IDLE'},...overrides}));
   const assertGoal=(goal,robot,command)=>{assert.equal(goal.socket,stopSocket);assert.equal(goal.msg.action,'/'+robot+'/data');assert.equal(goal.msg.action_type,'host_pkg/action/Burger');assert.deepEqual(goal.msg.args,{command,cmd_val:0});};
   await waitEnabled('stop','M1',true);assert.equal(stopSockets.size,1);assert.equal(goals.length,0,'Opening sends no Action Goal');assert(await restart('M1').isDisabled());assert(await restart('M2').isDisabled());
   owner('M1');await waitEnabled('restart','M1',true);assert(await restart('M2').isDisabled(),'M1 telemetry does not enable M2');
   owner('M2','direct');mission('M2','running');await waitEnabled('restart','M2',false);mission('M2','cancelled');await waitEnabled('restart','M2',true);
   owner('M1','unknown');await waitEnabled('restart','M1',false);owner('M1','nav');await waitEnabled('restart','M1',true);
   await page.clock.fastForward(4000);await waitEnabled('restart','M1',false);await waitEnabled('restart','M2',false);assert.equal(goals.length,0,'Fresh and stale telemetry never triggers release');
   // Stops remain available without fresh telemetry and keep robot results isolated.
   await stop('M1').click();assert.equal(goals.length,1);const first=goals[0];assertGoal(first,'M1','EMER_STOP');assert(await stop('M1').isDisabled());assert(await stop('M2').isEnabled());
   first.socket.send(JSON.stringify({op:'action_feedback',id:first.msg.id,values:{message:'IDLE'}}));result(first,{id:'unrelated'});assert(await stop('M1').isDisabled());
   await stop('M2').click();assert.equal(goals.length,2);const second=goals[1];assertGoal(second,'M2','EMER_STOP');assert.notEqual(first.msg.id,second.msg.id);
   result(first);await waitPhase('M1','success');assert(await stop('M1').isEnabled());assert(await stop('M2').isDisabled());result(second,{status:6,values:{success:false,message:'ERROR'}});await waitPhase('M2','error');assert.match(await status('M2').textContent(),/미확인/);
   // Release is an explicit request, does not lock out a stop, and never restarts motion.
   owner('M1');owner('M2');await waitEnabled('restart','M1',true);await waitEnabled('restart','M2',true);
   await restart('M1').click();const release1=goals.at(-1);assertGoal(release1,'M1','RESTART');assert(await restart('M1').isDisabled());assert(await stop('M1').isEnabled(),'Stop stays available while release is pending');
   await restart('M2').click();const release2=goals.at(-1);assertGoal(release2,'M2','RESTART');assert(await restart('M2').isDisabled());result(release2,{status:6,values:{success:false,message:'ERROR'}});await waitPhase('M2','error');assert.match(await status('M2').textContent(),/정지 해제.*실패/);
   release1.socket.send(JSON.stringify({op:'action_feedback',id:release1.msg.id,values:{message:'IDLE'}}));await stop('M1').click();const priorityStop=goals.at(-1);assertGoal(priorityStop,'M1','EMER_STOP');assert(await stop('M1').isDisabled());result(release1);await page.waitForTimeout(20);assert.equal(await status('M1').getAttribute('data-phase'),'pending','Old release result cannot acknowledge stop');result(priorityStop);await waitPhase('M1','success');assert.match(await status('M1').textContent(),/정지 확인/);
   owner('M1');await waitEnabled('restart','M1',true);await restart('M1').click();const confirmed=goals.at(-1);assertGoal(confirmed,'M1','RESTART');result(confirmed);await waitPhase('M1','success');assert.match(await status('M1').textContent(),/정지 해제 확인/);const afterRelease=goals.length;
   // Polling must retain the confirmed result; mission state must gate release immediately.
   await page.clock.fastForward(1100);assert.equal(await status('M1').getAttribute('data-phase'),'success');assert.equal(goals.length,afterRelease,'Release acknowledgement never resumes the previous movement');mission('M1','running');await waitEnabled('restart','M1',false);mission('M1','success');owner('M1');await waitEnabled('restart','M1',true);
   await page.screenshot({path:'/tmp/robot-stop-'+(path.includes('control')?'control':path.includes('live')?'live':'demo')+'.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile overflow');
   owner('M2');await waitEnabled('restart','M2',true);await restart('M2').click();const pendingRelease=goals.at(-1);assertGoal(pendingRelease,'M2','RESTART');const beforeDisconnect=goals.length;stopSocket.close();await waitPhase('M2','error');assert(await stop('M1').isDisabled());assert(await restart('M2').isDisabled());assert.match(await status('M2').textContent(),/미확인/);
   await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
   await waitEnabled('stop','M1',true);assert.equal(stopSockets.size,2);assert.equal(goals.length,beforeDisconnect,'Restoring reconnects without replay');assert(await restart('M1').isDisabled());assert(await restart('M2').isDisabled(),'Old telemetry cannot enable release after reconnect');owner('M1');await waitEnabled('restart','M1',true);assert(await restart('M2').isDisabled());assert.equal(goals.length,beforeDisconnect);
   assert(goals.every(g=>['EMER_STOP','RESTART'].includes(g.msg.args.command)));assert.deepEqual(errors,[]);await page.close();
  }
  // Public/static pages never connect to a visitor's robot bridge.
  const page=await browser.newPage();let connections=0;
  await page.route('https://robot-stop.test/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:base+url.pathname+url.search});await route.fulfill({response});});
  await page.routeWebSocket(/.*/,socket=>{connections++;socket.close();});await page.goto('https://robot-stop.test/control.html',{waitUntil:'networkidle'});
  for(const robot of ['M1','M2']){assert(await page.locator('[data-stop-robot="'+robot+'"]').isDisabled());assert(await page.locator('[data-restart-robot="'+robot+'"]').isDisabled());}
  assert.match(await page.locator('[data-stop-status="M1"]').textContent(),/Host PC/);assert.equal(connections,0);await page.close();
  console.log('PASS map/demo/control M1/M2 stop and release: API, fresh-state gating, stop priority, responses, polling, reconnect, mobile, public gating and no automatic motion.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
