// Real Chromium, production module/level/RAF, and Playwright keyboard/mouse events.
// The HTTP server adds observation hooks; fixtures are explicitly marked below.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root=path.resolve(__dirname,'../../docs');
const out=path.resolve(process.env.BROWSER_RESULTS_DIR || 'browser-results');
fs.mkdirSync(out,{recursive:true});
const hooks=`
window.__qa={frame:0,trace:[],ready:()=>!!state,
  snapshot:()=>({frame:window.__qa.frame,player:{...state.player},
    grapple:{mode:state.grapple.mode,head:state.grapple.head,anchor:state.grapple.anchor},
    cam:{...state.cam},boss:{...state.boss},game_state:state.game_state}),
  record(){this.frame++;this.trace.push(this.snapshot());if(this.trace.length>3000)this.trace.shift();},
  fixture(kind){
    state.enemies=[];state.projectiles=[];state.boss.active=false;
    if(kind==='wall')state.rects.push({id:'QA_WALL',type:'Wall',x:14,y:-21,w:1,h:8});
    if(kind==='boss')Object.assign(state.boss,{x:8.5,y:state.player.y+0.3,
      active:true,alive:true,dead:false,hp:420,shoot_cd:1000,phase:'rifle',phase_t:1000});
  }};
`;
const source=fs.readFileSync(path.join(root,'game.js'),'utf8')
  .replace('updateLogic(); acc-=DT;','updateLogic(); window.__qa.record(); acc-=DT;')+hooks;
const server=http.createServer((req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  if(file==='/game.js'){res.setHeader('Content-Type','text/javascript');res.end(source);return;}
  const names={'/':'index.html','/level_train_v1.json':'level_train_v1.json'};
  if(!names[file]){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.json')?'application/json':'text/html');
  res.end(fs.readFileSync(path.join(root,names[file])));
});

const results=[];
let browser;
async function scenario(name,fixture,body){
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const read=()=>page.evaluate(()=>window.__qa.snapshot());
  const frames=async(n)=>{
    const target=(await read()).frame+n;
    await page.waitForFunction(t=>window.__qa.frame>=t,target,{timeout:12000});
  };
  const aim=async(x,y)=>{
    const s=await read();const box=await page.locator('#game').boundingBox();
    await page.mouse.move(box.x+(x-(s.cam.x-16))*40,box.y+(s.cam.y+9-y)*40);
  };
  let failure;
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>window.__qa?.ready());await frames(40);
    if(fixture)await page.evaluate(k=>window.__qa.fixture(k),fixture);
    const evidence=await body({page,read,frames,aim});
    assert.deepEqual(errors,[],'no uncaught browser errors');
    results.push({name,fixture:fixture||'unmodified training level',passed:true,evidence});
    console.log('PASS '+name+' '+JSON.stringify(evidence));
  }catch(e){
    failure=e;results.push({name,fixture:fixture||'unmodified training level',passed:false,error:e.stack,errors});
    console.error('FAIL '+name+' '+e.stack);
  }finally{
    await page.screenshot({path:path.join(out,name+'.png')});
    const trace=await page.evaluate(()=>window.__qa?.trace||[]).catch(()=>[]);
    fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(trace,null,2));
    await context.close();
  }
  return !failure;
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true});
  console.log('Chromium '+browser.version());
  await scenario('movement-release',null,async({page,read,frames})=>{
    const start=await read();assert.ok(start.player.grounded);
    for(const key of ['KeyD','KeyA']){
      const before=await read();await page.keyboard.down(key);await frames(18);
      const moving=await read();assert.equal(moving.player.vx,key==='KeyD'?8:-8);
      assert.ok(Math.abs(moving.player.x-before.player.x)>1);
      assert.ok(Math.abs(moving.player.x-before.player.x)<5);
      await page.keyboard.up(key);await frames(3);
      const stop=await read();assert.equal(stop.player.vx,0);
      await frames(12);assert.ok(Math.abs((await read()).player.x-stop.player.x)<1e-9);
    }
    await page.keyboard.down('KeyA');await page.keyboard.down('KeyD');await frames(4);
    assert.equal((await read()).player.vx,0);
    await page.keyboard.up('KeyA');await page.keyboard.up('KeyD');
    const trace=await page.evaluate(()=>window.__qa.trace);
    for(let i=1;i<trace.length;i++)assert.ok(Math.abs(trace[i].player.x-trace[i-1].player.x)<0.14,'no horizontal teleport');
    return {startX:start.player.x,endX:(await read()).player.x,frames:trace.length};
  });
  await scenario('jump-and-air-dash',null,async({page,read,frames,aim})=>{
    const start=await read();await page.keyboard.down('Space');await frames(3);
    const jumping=await read();assert.ok(jumping.player.y>start.player.y);
    assert.equal(jumping.player.dash,null);assert.ok(jumping.player.st>99);
    await page.keyboard.up('Space');await frames(2);
    const before=await read();await aim(before.player.x+8,before.player.y);
    await page.keyboard.down('Space');await frames(2);await page.keyboard.up('Space');
    const dashing=await read();assert.ok(dashing.player.dash);assert.ok(dashing.player.st<80);
    await frames(12);const after=await read();
    assert.equal(after.player.dash,null);assert.equal(after.player.dash_used,true);
    assert.ok(after.player.x-before.player.x>5.8&&after.player.x-before.player.x<=6.01,'6 cm dash');
    await page.keyboard.press('Space');await frames(2);assert.equal((await read()).player.dash,null);
    await page.waitForFunction(()=>window.__qa.snapshot().player.grounded,null,{timeout:5000});
    return {jumpRise:jumping.player.y-start.player.y,dashX:after.player.x-before.player.x,landed:(await read()).player.grounded};
  });
  await scenario('grapple-wall-pull','wall',async({page,read,frames,aim})=>{
    const start=await read();await aim(14,start.player.y);await page.mouse.down({button:'right'});
    await page.waitForFunction(()=>window.__qa.snapshot().grapple.mode==='pull');
    await frames(10);const pulled=await read();assert.ok(pulled.player.x>start.player.x+1);
    await page.keyboard.press('Space');await frames(2);assert.equal((await read()).player.dash,null);
    await page.mouse.up({button:'right'});await frames(3);
    const stopped=await read();assert.equal(stopped.grapple.mode,'none');
    await frames(8);assert.ok(Math.abs((await read()).player.x-stopped.player.x)<1e-9);
    return {startX:start.player.x,pulledX:pulled.player.x,released:stopped.grapple.mode};
  });
  await scenario('grapple-stuck-release','quiet',async({page,read,frames,aim})=>{
    const start=await read();await aim(start.player.x,-25.5);await page.mouse.down({button:'right'});
    await page.waitForFunction(()=>window.__qa.snapshot().grapple.mode==='stuck');
    const stuck=await read();await page.keyboard.down('KeyD');await page.keyboard.press('Space');
    await page.keyboard.press('KeyF');await page.mouse.down({button:'left'});await frames(10);
    const frozen=await read();assert.equal(frozen.grapple.mode,'stuck');
    assert.equal(frozen.player.x,stuck.player.x);assert.equal(frozen.player.y,stuck.player.y);
    assert.equal(frozen.player.dash,null);assert.ok(frozen.player.melee);assert.ok(frozen.player.ammo<60);
    assert.equal(frozen.player.facing,1);await page.keyboard.up('KeyD');await page.mouse.up({button:'left'});
    await page.mouse.move(1400,800);await page.mouse.up({button:'right'});await frames(3);
    assert.equal((await read()).grapple.mode,'none');
    return {stuckX:stuck.player.x,stuckY:stuck.player.y,shots:60-frozen.player.ammo,outsideRelease:true};
  });
  await scenario('dash-wall-collision','wall',async({page,read,frames,aim})=>{
    await page.keyboard.down('KeyD');await frames(12);await page.keyboard.up('KeyD');await frames(2);
    await page.keyboard.down('Space');await frames(3);await page.keyboard.up('Space');await frames(2);
    const s=await read();await aim(20,s.player.y);await page.keyboard.down('Space');
    await frames(10);await page.keyboard.up('Space');
    const ended=await read();assert.equal(ended.player.dash,null);
    assert.ok(ended.player.x<=12.9991&&ended.player.x>12.9,'wall stops dash at its left face');
    return {x:ended.player.x,dashEnded:true};
  });
  await scenario('boss-melee-once','boss',async({page,read,frames,aim})=>{
    const s=await read();await aim(8.5,s.player.y);await page.keyboard.down('KeyF');await frames(3);
    assert.equal((await read()).boss.hp,340);await frames(25);
    const after=await read();assert.equal(after.boss.hp,340);await page.keyboard.up('KeyF');
    return {beforeHP:420,afterHP:after.boss.hp};
  });
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({browser:browser.version(),results},null,2));
  console.log(`${results.filter(r=>r.passed).length}/${results.length} browser scenarios passed`);
  if(results.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();server.close();
});
