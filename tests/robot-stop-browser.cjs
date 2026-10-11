const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8082';
  for(const path of ['/?live=1','/','/control.html']){
   const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],goals=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.routeWebSocket(/.*/,socket=>socket.onMessage(raw=>{
    const msg=JSON.parse(raw);
    if(msg.op==='send_action_goal')goals.push({socket,msg});
   }));
   await page.goto(base+path,{waitUntil:'networkidle'});
   const m1=page.locator('[data-stop-robot="M1"]'),m2=page.locator('[data-stop-robot="M2"]');
   const status1=page.locator('[data-stop-status="M1"]'),status2=page.locator('[data-stop-status="M2"]');
   await m1.waitFor();await page.waitForFunction(()=>!document.querySelector('[data-stop-robot="M1"]').disabled);
   assert.equal(goals.length,0,'Opening any page sends no Action Goal');
   await m1.click();assert.equal(goals.length,1);
   const first=goals[0];
   assert.equal(first.msg.action,'/M1/data');assert.equal(first.msg.action_type,'host_pkg/action/Burger');
   assert.deepEqual(first.msg.args,{command:'EMER_STOP',cmd_val:0});
   assert(await m1.isDisabled());assert(await m2.isEnabled(),'M1 pending must not block M2');
   // A feedback IDLE and another request's result cannot acknowledge this stop.
   first.socket.send(JSON.stringify({op:'action_feedback',id:first.msg.id,values:{message:'IDLE'}}));
   first.socket.send(JSON.stringify({op:'action_result',id:'unrelated',result:true,status:4,values:{success:true,message:'IDLE'}}));
   assert(await m1.isDisabled());
   await m2.click();assert.equal(goals.length,2);const second=goals[1];
   assert.equal(second.msg.action,'/M2/data');assert.notEqual(first.msg.id,second.msg.id);
   first.socket.send(JSON.stringify({op:'action_result',id:first.msg.id,result:true,status:4,values:{success:true,message:'IDLE'}}));
   await page.waitForFunction(()=>document.querySelector('[data-stop-status="M1"]').dataset.phase==='success');
   assert(await m1.isEnabled());assert(await m2.isDisabled());
   second.socket.send(JSON.stringify({op:'action_result',id:second.msg.id,result:true,status:6,values:{success:false,message:'ERROR'}}));
   await page.waitForFunction(()=>document.querySelector('[data-stop-status="M2"]').dataset.phase==='error');
   assert.match(await status2.textContent(),/미확인|확인/);
   // Repeated HTTP polling/render frames must not erase independent stop responses.
   await page.waitForTimeout(1100);assert.equal(await status1.getAttribute('data-phase'),'success');
   await page.screenshot({path:'/tmp/robot-stop-'+(path.includes('control')?'control':path.includes('live')?'live':'demo')+'.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile overflow');
   await m1.click();assert.equal(goals.length,3);
   first.socket.close();
   await page.waitForFunction(()=>document.querySelector('[data-stop-status="M1"]').dataset.phase==='error');
   assert(await m1.isDisabled());assert.match(await status1.textContent(),/미확인|확인/);
   await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
   await page.waitForFunction(()=>!document.querySelector('[data-stop-robot="M1"]').disabled);
   assert.equal(goals.length,3,'Restoring a page reconnects without resending the interrupted stop');
   assert(goals.every(g=>g.msg.args.command==='EMER_STOP'),'Never automatically releases stop or starts motion');
   assert.deepEqual(errors,[]);await page.close();
  }
  // The public/static site must never connect to a visitor's robot bridge.
  const page=await browser.newPage();let connections=0;
  await page.route('https://robot-stop.test/**',async route=>{
   const url=new URL(route.request().url());const response=await route.fetch({url:base+url.pathname+url.search});
   await route.fulfill({response});
  });
  await page.routeWebSocket(/.*/,socket=>{connections++;socket.close();});
  await page.goto('https://robot-stop.test/control.html',{waitUntil:'networkidle'});
  assert(await page.locator('[data-stop-robot="M1"]').isDisabled());
  assert.match(await page.locator('[data-stop-status="M1"]').textContent(),/Host PC/);assert.equal(connections,0);
  await page.close();
  console.log('PASS: map/demo/control M1/M2 stops, exact Action API, isolated results, polling, disconnect, mobile, public-site gating and no automatic commands.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
