const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),sent=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket(/.*/,s=>s.close());
  let state={bridge_configured:true,bridge_connected:true,runtime_mode:'mock',pending_commands:0,can_retry:true,can_manual_move:true,can_reset:true,can_start:false,can_advance:false,
   order_policy:{quantity_min:1,quantity_max:2,quantity_default:1},conditions:[],log:[],
   devices:Object.fromEntries(['M1','M2','warehouse','production'].map(k=>[k,{state:'idle',detail:'모의 서버',log:[]} ])),
   order:{id:'test-order',product_type:'A',quantity:1,status:'failed',stage:4,stage_count:6,completed:0,transport_remaining:0,product_remaining:1,recovery_revision:0,auto_advance:true,stage_label:'1번 완제품 팔레트 적재',fault:'모의 검사 실패'}};
  await page.route('**/api/live/**',async r=>{
   if(r.request().method()==='POST'){
    const action=new URL(r.request().url()).pathname.split('/').at(-1),body=r.request().postDataJSON();sent.push({action,...body});
    state={...state,can_retry:false,can_manual_move:false,pending_commands:1};
   }
   await r.fulfill({json:state});
  });
  await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:8767')+'/control.html',{waitUntil:'networkidle'});
  assert.equal(sent.length,0);assert(await page.locator('#retry-order').isEnabled());
  await page.locator('#retry-order').click();assert.match(await page.locator('#recovery-description').textContent(),/완제품 팔레트 적재.*성공 후 다음 단계로 자동 진행/);
  await page.locator('#cancel-recovery').click();assert.equal(sent.length,0);
  await page.locator('[data-move-destination="M2"]').selectOption('GO_TO_REST');
  await page.locator('[data-move-robot="M2"]').click();
  assert.match(await page.locator('#recovery-description').textContent(),/M2.*대기장소/);
  await page.locator('#recovery-confirmed').check();await page.locator('#confirm-recovery').click();
  await page.waitForFunction(()=>document.getElementById('retry-order').disabled);
  assert.deepEqual(sent[0],{action:'manual_move',order_id:'test-order',stage:4,recovery_revision:0,device:'M2',destination:'GO_TO_REST',operator_confirmed:true});
  assert(await page.locator('[data-move-robot="M1"]').isDisabled());
  state={...state,pending_commands:0,can_retry:true,can_manual_move:true,order:{...state.order,recovery_revision:1}};
  await page.waitForFunction(()=>!document.getElementById('retry-order').disabled);
  await page.locator('#retry-order').click();
  state={...state,order:{...state.order,recovery_revision:2}};
  await page.waitForFunction(()=>document.getElementById('confirm-recovery').disabled);
  assert.equal(sent.length,1);await page.locator('#cancel-recovery').click();
  await page.locator('#retry-order').click();await page.locator('#recovery-confirmed').check();
  await page.screenshot({path:'/tmp/recovery-dialog.png',fullPage:true});
  await page.locator('#confirm-recovery').click();
  await page.waitForFunction(()=>document.getElementById('retry-order').disabled);
  assert.equal(sent[1].action,'retry');assert.equal(sent[1].recovery_revision,2);
  state={...state,pending_commands:0,can_retry:true,can_manual_move:true,order:{...state.order,auto_advance:false}};
  await page.waitForFunction(()=>!document.getElementById('retry-order').disabled);
  await page.locator('#retry-order').click();
  assert.match(await page.locator('#recovery-description').textContent(),/수동 진행.*다음 단계 버튼을 기다/);
  await page.locator('#cancel-recovery').click();
  await page.screenshot({path:'/tmp/recovery-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('[data-move-robot="M1"]').click();
  assert(await page.locator('#recovery-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));
  await page.screenshot({path:'/tmp/recovery-mobile.png',fullPage:true});
  state={...state,bridge_connected:false};
  await page.waitForFunction(()=>document.getElementById('confirm-recovery').disabled);
  assert.deepEqual(errors,[]);console.log('PASS recovery browser: no auto commands, confirmation, M1/M2 destinations, pending lock, stale revision, retry payload, disconnect, mobile layout');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
