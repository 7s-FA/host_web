const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),sent=[],errors=[];
  await page.routeWebSocket(/.*/,socket=>socket.close());
  page.on('pageerror',e=>errors.push(e.message));
  let state={bridge_connected:true,bridge_configured:true,runtime_mode:'hardware',order:null,
   can_prepare_parked:true,manual_revision:7,pending_commands:0,can_start:false,can_manual_move:false,
   devices:Object.fromEntries(['M1','M2','warehouse','production'].map(x=>[x,{state:'offline',log:[]}]))};
  await page.route('**/api/live/**',async route=>{
   if(route.request().method()==='POST'){
    assert.equal(new URL(route.request().url()).pathname,'/api/live/prepare_parked');
    sent.push(route.request().postDataJSON());
   }
   await route.fulfill({json:state});
  });
  await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:8087')+'/control.html');
  for(const device of ['M1','M2']){
   await page.locator(`[data-parked-robot="${device}"]`).click();
   assert.equal(await page.locator('#parked-title').textContent(),device+' 주차 위치로 옮긴 후 준비');
   await page.locator('#confirm-parked').click();
   assert.equal(sent.length,device==='M1'?0:1,'Unchecked confirmation sends nothing');
   await page.locator('#parked-confirmed').check();
   await page.locator('#confirm-parked').click();
   await page.waitForFunction(()=>!document.querySelector('#parked-dialog').open);
  }
  assert.deepEqual(sent.map(x=>x.device),['M1','M2']);
  for(const p of sent)assert.deepEqual(p,{device:p.device,order_id:null,recovery_revision:7,operator_confirmed:true});
  await page.locator('[data-parked-robot="M1"]').click();
  state={...state,manual_revision:8};
  await page.waitForFunction(()=>document.querySelector('#confirm-parked').disabled);
  await page.locator('#cancel-parked').click();
  state={...state,can_prepare_parked:false,manual_move:{device:'M1',command:'PREPARE_PARKED'}};
  await page.waitForFunction(()=>document.querySelector('[data-parked-robot="M1"]').disabled);
  assert(await page.locator('[data-parked-robot="M2"]').isDisabled());
  assert.match(await page.locator('[data-parked-status="M1"]').textContent(),/준비 중/);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/parked-preparation-ui.png',fullPage:true});
  console.log('PASS: M1/M2 confirmation, exact payload, stale dialog and concurrent preparation lock');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
