const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),sent=[],errors=[];
  // Every API response is synthetic; never let this test reach a robot.
  await page.routeWebSocket(/.*/,socket=>socket.close());
  page.on('pageerror',error=>errors.push(error.message));
  let state={bridge_connected:true,bridge_configured:true,runtime_mode:'hardware',
   order:null,manual_revision:7,pending_commands:0,can_full_reset:true,can_start:true,supports_parked_full_reset:true,
   devices:Object.fromEntries(['M1','M2','warehouse','production'].map(x=>[x,{state:'idle',log:[]}]))};
  await page.route('**/api/live/**',async route=>{
   if(route.request().method()==='POST'){
    const action=new URL(route.request().url()).pathname.split('/').at(-1);
    sent.push({action,...route.request().postDataJSON()});
    assert(['full_reset','cancel_full_reset'].includes(action));
    state={...state,can_full_reset:false,can_start:false,full_reset:{id:'init-1',
     status:action==='full_reset'?'running':'failed',step:4,total:9,label:'팔1 초기 자세 복귀',uncertain:action!=='full_reset',error:''}};
   }
   await route.fulfill({json:state});
  });
  await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:8087')+'/control.html');
  await page.locator('#full-reset').click();
  assert.match(await page.locator('#full-reset-dialog').textContent(),/바깥/);
  await page.locator('#confirm-full-reset').click();
  assert.equal(sent.length,0);
  await page.screenshot({path:'/tmp/full-reset-dialog.png',fullPage:true});
  await page.locator('#full-reset-confirmed').check();
  await page.locator('#confirm-full-reset').click();
  await page.waitForFunction(()=>document.querySelector('#full-reset').disabled);
  assert.deepEqual(sent[0],{action:'full_reset',order_id:null,recovery_revision:7,operator_confirmed:true});
  assert(await page.locator('#start-order').isDisabled());
  assert(await page.locator('[data-move-robot="M1"]').isDisabled());
  assert(await page.locator('[data-parked-robot="M2"]').isDisabled());
  await page.locator('#cancel-full-reset-run').click();
  await page.waitForFunction(()=>document.querySelector('#full-reset-label').textContent==='전체 초기화 중단');
  assert.deepEqual(sent[1],{action:'cancel_full_reset',reset_id:'init-1'});
  assert.match(await page.locator('#full-reset-detail').textContent(),/결과 미확인/);
  state={...state,can_full_reset:true,full_reset:null,manual_revision:8};
  await page.waitForFunction(()=>!document.querySelector('#full-reset').disabled);
  await page.locator('#full-reset').click();
  state={...state,manual_revision:9};
  await page.waitForFunction(()=>document.querySelector('#confirm-full-reset').disabled);
  await page.locator('#cancel-full-reset').click();
  assert.equal(sent.length,2);
  await page.locator('#full-reset').click();
  assert(!(await page.locator('#full-reset-parked').isChecked()));
  await page.locator('#full-reset-parked').check();
  await page.locator('#full-reset-confirmed').check();
  await page.locator('#confirm-full-reset').click();
  await page.waitForFunction(()=>!document.querySelector('#full-reset-dialog').open);
  assert.deepEqual(sent[2],{action:'full_reset',order_id:null,recovery_revision:9,operator_confirmed:true,amrs_parked:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: full-reset confirmation, exact request, progress/cancel, concurrent controls and stale context');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
