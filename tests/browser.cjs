const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.setDefaultTimeout(10000);
 await page.routeWebSocket(/.*/,socket=>socket.close());
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('robot3-simulation-settings-v1',JSON.stringify({version:1,burger1:{forwardSpeed:2,reverseSpeed:2,turnSpeed:45},burger2:{forwardSpeed:2,reverseSpeed:2,turnSpeed:45},process:{loadPartSeconds:1,assemblySeconds:13,linearPrepareSeconds:1,linearHomeSeconds:1,palletSeconds:1}})));
 const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8082';
 await page.goto(base,{waitUntil:'networkidle'});
 assert.equal(await page.locator('a[href="admin.html"]').count(),0);
 assert.equal(await page.locator('#speed').count(),0);
 const productButtons=page.locator('#order-form [data-product-type]'),quantityButtons=page.locator('#order-form [data-quantity]');
 async function selected(product,quantity){
  assert.equal(await page.locator('#product').inputValue(),product);
  assert.equal(await page.locator('#quantity').inputValue(),String(quantity));
  assert.equal(await page.locator('#order-form [data-product-type][aria-pressed="true"]').count(),1);
  assert.equal(await page.locator(`#order-form [data-product-type="${product}"]`).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#order-form [data-quantity][aria-pressed="true"]').count(),1);
  assert.equal(await page.locator(`#order-form [data-quantity="${quantity}"]`).getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#order-selection').textContent(),new RegExp(`${product}제품.*${quantity}개`));
 }
 async function choicesLocked(locked){
  for(const button of [...await productButtons.all(),...await quantityButtons.all()])assert.equal(await button.isDisabled(),locked);
  assert.equal(await page.locator('#start').isDisabled(),locked);
 }
 async function select(product,quantity){
  await page.locator(`#order-form [data-product-type="${product}"]`).click();
  await page.locator(`#order-form [data-quantity="${quantity}"]`).click();
  await selected(product,quantity);
 }
 async function finish(){await page.locator('#timeline').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input'));});}
 assert.equal(await productButtons.count(),2);assert.equal(await quantityButtons.count(),2);
 assert.equal(await page.locator('#order-form select, #order-form input[type="number"], #plus, #minus').count(),0);
 await selected('A',2);await choicesLocked(false);
 await page.screenshot({path:'/tmp/robot3-desktop.png',fullPage:true});
 const map=await page.locator('.map-panel').boundingBox(),host=await page.locator('.host-console').boundingBox();
 assert(map.x+map.width<=host.x,'Simulation is left of Host GUI');assert(map.width>host.width*2,'Simulation occupies the larger area');
 for(const id of ['quantity','start','total','transport','remaining','completed'])assert(await page.locator('.host-console #'+id).count()===1,`Host GUI contains ${id}`);
 for(const invalid of ['0','3','1.5','not-a-number']){
  await page.locator('#quantity').evaluate((el,value)=>el.value=value,invalid);
  await page.click('#step-order');assert.match(await page.locator('#form-error').textContent(),/1~2/);
  assert.equal(await page.evaluate(()=>plan),null);
 }
 await select('A',2);
 await page.locator('#product').evaluate(el=>el.value='C');await page.click('#start');
 assert.match(await page.locator('#form-error').textContent(),/제품/);assert.equal(await page.evaluate(()=>plan),null);
 await select('A',2);
 assert.equal(await page.locator('#total').textContent(),'—');
 await page.click('#start');await choicesLocked(true);await page.click('#play');await choicesLocked(true);
 assert.equal(await page.evaluate(()=>plan.config.burger1.forwardSpeed),1);
 assert.equal(await page.evaluate(()=>plan.config.process.assemblySeconds),6);
 assert.equal(await page.locator('#total').textContent(),'2');
 await page.locator('#timeline').evaluate(el=>{el.value=RobotSimulation.makePlan(2).jobs[0].dispatch;el.dispatchEvent(new Event('input'));});
 assert.equal(await page.locator('#transport').textContent(),'1');
 await page.locator('#timeline').evaluate(el=>{el.value=RobotSimulation.makePlan(2).jobs[1].dispatch;el.dispatchEvent(new Event('input'));});
 assert.equal(await page.locator('#transport').textContent(),'0');assert.equal(await page.locator('#remaining').textContent(),'1');
 await page.screenshot({path:'/tmp/robot3-running.png',fullPage:true});
 await finish();await choicesLocked(false);
 assert.equal(await page.locator('#run-status').textContent(),'주문 완료');assert.equal(await page.locator('#completed').textContent(),'2');
 for(const product of ['A','B'])for(const quantity of [1,2]){
  await select(product,quantity);await page.click('#start');await choicesLocked(true);
  await page.click('#play');await choicesLocked(true);await selected(product,quantity);
  assert.equal(await page.evaluate(()=>plan.productType),product);
  assert.equal(await page.locator('#total').textContent(),String(quantity));
  assert.equal(await page.locator('#jig-product').textContent(),product);
  assert.match(await page.locator('#order-id').textContent(),new RegExp(`${product}제품 ${quantity}개`));
  await page.click('#next');await page.click('#previous');
  await finish();await choicesLocked(false);
  assert.equal(await page.locator('#completed').textContent(),String(quantity));
  assert.equal(await page.locator('#scene-title').textContent(),`${product}제품 주문 완료`);
 }
 // A completed B order stays B in the export after choosing the next order's A product.
 await select('A',1);
 await page.click('#open-details');
 const download=page.waitForEvent('download');await page.click('#export');const log=await download;
 assert.equal(log.suggestedFilename(),'robot3-simulation-log.json');
 const exported=JSON.parse(await fs.readFile(await log.path(),'utf8'));
 assert.equal(exported.product,'B');assert.equal(exported.ordered,2);
 assert(exported.events.some(event=>event.text.includes('B제품')));
 await page.click('#close-details');
 await select('B',1);await page.click('#step-order');await choicesLocked(true);await page.click('#play');
 assert.equal(await page.evaluate(()=>plan.productType),'B');await choicesLocked(true);
 assert.equal(await page.evaluate(()=>manualMode),true);await finish();await choicesLocked(false);
 await page.click('[data-tab=gallery]');assert.equal(await page.locator('.gallery-card').count(),9);await page.locator('.gallery-card').first().click();assert(await page.locator('#photo-dialog').isVisible());await page.keyboard.press('Escape');
 const allImages=await page.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0));assert(allImages,'All 9 photos should load');
 await page.click('[data-tab=simulation]');await page.click('#reset');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/robot3-mobile.png',fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow on mobile');
 assert.deepEqual(errors,[]);
 console.log('PASS: desktop/mobile, A/B × 1/2 orders, invalid hidden values, selection locks, product-specific labels/export, steps, fixed defaults, counters, photos and no browser errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
