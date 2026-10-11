const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:8082').replace(/\/$/,'');
 try{
  const page=await browser.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.routeWebSocket(/.*/,socket=>socket.close());
  let state={status:'idle',quantity:0,product_type:'A',order_id:null,command:null,acked_seq:0,time:0,log:[],auto:false,
   order_policy:{quantity_min:1,quantity_max:2,quantity_default:2},stage_count:8};
  let pendingStart,releaseStart,holdStart=true;
  const startSeen=new Promise(resolve=>pendingStart=resolve);
  const startReleased=new Promise(resolve=>releaseStart=resolve);
  await page.route('**/api/*',async route=>{
   const action=new URL(route.request().url()).pathname.slice('/api/'.length),body=route.request().postDataJSON();
   requests.push({action,body});
   if(action==='start'){
    pendingStart();if(holdStart)await startReleased;
    state={...state,status:'running',quantity:body.quantity,product_type:body.product_type,order_id:'order-'+requests.filter(r=>r.action==='start').length,
     time:0,acked_seq:0,counters:{transport:body.quantity,remaining:body.quantity,completed:0},command:{seq:1,target_time:10000}};
   }
   if(action==='auto')state={...state,auto:body.enabled};
   await route.fulfill({json:state});
  });
  async function selected(product,quantity){
   assert.equal(await page.locator('#product').inputValue(),product);assert.equal(await page.locator('#quantity').inputValue(),String(quantity));
   assert.equal(await page.locator(`#order-form [data-product-type="${product}"]`).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator(`#order-form [data-quantity="${quantity}"]`).getAttribute('aria-pressed'),'true');
  }
  async function locked(expected){
   for(const button of await page.locator('#order-form [data-product-type], #order-form [data-quantity], #start').all())assert.equal(await button.isDisabled(),expected);
  }
  async function select(product,quantity){
   await page.locator(`#order-form [data-product-type="${product}"]`).click();await page.locator(`#order-form [data-quantity="${quantity}"]`).click();
   await selected(product,quantity);
  }
  async function heartbeat(){
   const response=await page.waitForResponse(r=>r.url().endsWith('/api/heartbeat'));await response.finished();await page.evaluate(()=>new Promise(requestAnimationFrame));
  }
  await page.goto(base+'/?host=1',{waitUntil:'load'});
  await page.waitForFunction(()=>HostBridge.online&&!document.getElementById('start').disabled);
  await select('B',1);await heartbeat();await selected('B',1);
  await page.click('#start');await startSeen;await locked(true);
  assert.equal(await page.locator('#step-order').isDisabled(),true);
  const first=requests.find(r=>r.action==='start').body;
  assert.equal(first.product_type,'B');assert.equal(first.quantity,1);
  releaseStart();holdStart=false;
  await page.waitForFunction(()=>plan?.hostOrder==='order-1');await selected('B',1);await locked(true);
  assert.equal(await page.evaluate(()=>plan.productType),'B');assert.match(await page.locator('#order-id').textContent(),/B제품 1개/);
  assert.equal(await page.locator('#jig-product').textContent(),'B');
  state={...state,status:'paused'};await heartbeat();await locked(true);await selected('B',1);
  const duration=await page.evaluate(()=>plan.duration);
  state={...state,status:'done',time:duration,command:null,acked_seq:8,counters:{transport:0,remaining:0,completed:1}};
  await page.waitForFunction(()=>!document.getElementById('start').disabled);await locked(false);
  await select('A',2);await heartbeat();await selected('A',2);
  assert.equal(await page.evaluate(()=>plan.productType),'B','Completed order retains its product while next selection changes');
  assert.match(await page.locator('#order-id').textContent(),/B제품 1개/);
  await page.click('#step-order');await page.waitForFunction(()=>plan?.hostOrder==='order-2');await locked(true);
  const second=requests.filter(r=>r.action==='start')[1].body;
  assert.equal(second.product_type,'A');assert.equal(second.quantity,2);assert.equal(state.auto,false);
  assert.equal(await page.evaluate(()=>plan.productType),'A');await selected('A',2);
  state={...state,status:'running',order_id:'external-B-order',product_type:'B',quantity:2,time:0};
  await page.waitForFunction(()=>plan?.hostOrder==='external-B-order');await selected('B',2);await locked(true);
  assert.equal(await page.evaluate(()=>plan.productType),'B');
  assert.deepEqual(errors,[]);await page.close();

  // The real ROS transport is mocked at the WebSocket boundary, using the bundled ROSLIB.
  const rosPage=await browser.newPage(),published=[],events=new EventEmitter(),rosErrors=[];
  rosPage.on('pageerror',error=>rosErrors.push(error.message));
  await rosPage.routeWebSocket(/.*/,socket=>socket.onMessage(raw=>{
   const message=JSON.parse(raw);
   if(message.op==='publish'&&message.topic==='/web_to_ros'){
    const payload=JSON.parse(message.msg.data);published.push(payload);events.emit('publish',payload);
   }
  }));
  async function telemetry(product,quantity,playing,from){
   const matches=payload=>payload.product===`${product}제품 · 부품 3개 / 세트`&&payload.quantity===String(quantity)&&payload.playing===playing;
   if(published.slice(from).some(matches))return;
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{events.off('publish',listener);reject(Error(`Missing ROS ${product}/${quantity}/${playing}`));},5000);
    const listener=payload=>{if(matches(payload)){clearTimeout(timer);events.off('publish',listener);resolve();}};
    events.on('publish',listener);
   });
  }
  await rosPage.goto(base,{waitUntil:'networkidle'});await telemetry('A',2,false,0);
  for(const product of ['A','B'])for(const quantity of [1,2]){
   let from=published.length;
   await rosPage.locator(`#order-form [data-product-type="${product}"]`).click();
   await rosPage.locator(`#order-form [data-quantity="${quantity}"]`).click();
   await telemetry(product,quantity,false,from);
   from=published.length;await rosPage.click('#start');await telemetry(product,quantity,true,from);
   from=published.length;await rosPage.click('#play');await telemetry(product,quantity,false,from);
   await rosPage.locator('#timeline').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input'));});
  }
  assert(published.length>0);
  for(const payload of published){
   assert(['A제품 · 부품 3개 / 세트','B제품 · 부품 3개 / 세트'].includes(payload.product),'Backend requires full product label');
   assert(['1','2'].includes(payload.quantity));assert.equal(typeof payload.playing,'boolean');
  }
  assert.deepEqual(rosErrors,[]);
  console.log('PASS: HTTP A/B request/response, pending/paused locks, heartbeat selection retention, external order sync, step orders and exact ROS product/quantity/playing serialization.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
