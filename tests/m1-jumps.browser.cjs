// Real Chromium key/mouse events against production game.js; isolated room fixtures.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
let browser,server,base;
const metrics={build:process.env.GITHUB_SHA||process.env.GAME_FEEL_BUILD||'local',scenarios:[]};
const fixture={player_spawn:{x:50,y:-23.999,facing:1},rects:[{id:'FLOOR',type:'Solid',x:50,y:-26,w:100,h:2}],enemies:[],boss:{id:'BOSS',x:300,y:-20,w:3,h:4}};
before(async()=>{
  server=http.createServer((req,res)=>{
    if(req.url==='/')return res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#222}canvas{background:#111}</style><canvas id="game" width="1280" height="720"></canvas><script type="module" src="game.js"></script>');
    if(req.url==='/level_train_v1.json'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(fixture));}
    if(req.url==='/game.js'){
      res.setHeader('content-type','application/javascript');
      return res.end(fs.readFileSync(path.join(__dirname,'../docs/game.js'),'utf8')+'\nwindow.__jumpTest={run:code=>eval(code)};const originalJumpTick=updateLogic;updateLogic=()=>{window.__jumpTicks=(window.__jumpTicks||0)+1;originalJumpTick();};');
    }
    res.writeHead(404);res.end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{
  fs.mkdirSync('test-artifacts',{recursive:true});fs.writeFileSync('test-artifacts/m1-jumps.json',JSON.stringify(metrics,null,2));
  await browser?.close();await new Promise(r=>server?server.close(r):r());
});
async function tick(p,n=1){for(let k=0;k<n;k++){
  const before=await p.evaluate(()=>window.__jumpTicks||0);let advanced=false;
  for(let i=0;i<100;i++){await p.clock.runFor(1);const now=await p.evaluate(()=>window.__jumpTicks||0);if(now>before){assert.equal(now-before,1);advanced=true;break;}}
  assert.ok(advanced,'one production tick advances');
}}
async function game(t){
  const p=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await p.close();assert.deepEqual(errors,[]);});
  await p.clock.install({time:new Date('2026-11-17T00:00:00Z')});await p.clock.pauseAt(new Date('2026-11-17T00:00:10Z'));
  await p.goto(base+'/#m1-jumps');await p.waitForFunction(()=>window.__jumpTest?.run('state!==null'));
  const run=src=>p.evaluate(src=>window.__jumpTest.run(src),src);
  await tick(p,2);return {p,run};
}
async function shot(p,run,name){await run('render()');fs.mkdirSync('test-artifacts',{recursive:true});await p.locator('#game').screenshot({path:'test-artifacts/'+name+'.png'});}
test('browser M1 jumps: ground -> free second jump -> Shift Dash, no third jump',async t=>{
  const {p,run}=await game(t);await run('state.player.st=0');
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');await tick(p,5);
  const first=await run('({y:state.player.y,vy:state.player.vy,air:state.player.jump_extension.air_available})');
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const second=await run('({y:state.player.y,vy:state.player.vy,air:state.player.jump_extension.air_available,dash:state.player.dash})');
  assert.equal(first.air,true);assert.equal(second.air,false);assert.ok(second.vy>first.vy);assert.equal(second.dash,null);
  await shot(p,run,'m1-double-jump');await tick(p);
  const vy=await run('state.player.vy');await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  assert.ok((await run('state.player.vy'))<vy);await run('state.player.st=100');
  await p.keyboard.down('Shift');await tick(p);await p.keyboard.up('Shift');
  assert.ok(await run('!!state.player.dash'));assert.equal(await run('state.player.jump_extension.carry'),false);assert.equal(await run('state.player.jump_extension.air_available'),false);
  await tick(p,10);assert.equal(await run('state.player.dash'),null);assert.equal(await run('state.player.jump_extension.carry'),false);
  metrics.scenarios.push({case:'double-then-dash',first,second,noThird:true,dashDoesNotRefill:true});
});
for(const dir of [-1,1])test('browser M1 jumps: real movement into wall, then kick away '+dir,async t=>{
  const {p,run}=await game(t);
  await run("state.rects=[{id:'WALL',type:'Wall',x:"+(50+dir*1.6)+",y:-15,w:1,h:30}];Object.assign(state.player,{x:50,y:-12,vx:0,vy:0,grounded:false});");
  const key=dir===1?'d':'a';await p.keyboard.down(key);await tick(p,6);
  const contact=await run('({x:state.player.x,vx:state.player.vx,y:state.player.y})');assert.equal(contact.vx,0);
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const kicked=await run('({x:state.player.x,vx:state.player.vx,vy:state.player.vy,wall:state.player.jump_extension.walls,air:state.player.jump_extension.air_available,penetrating:blockers().some(r=>penetrates(aabb(state.player),aabb(r)))})');
  assert.equal(kicked.vx,-dir*10);assert.ok(kicked.vy>0);assert.ok(dir*(kicked.x-contact.x)<0);assert.equal(kicked.penetrating,false);assert.equal(kicked.air,true);
  await shot(p,run,'m1-wall-jump-'+(dir===1?'right':'left'));await p.keyboard.up(key);await tick(p,2);
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  assert.equal(await run('state.player.jump_extension.air_available'),false,'wall jump can chain into the free second jump');
  metrics.scenarios.push({case:'wall-kick',direction:dir,contact,kicked});
});
test('browser M1 jumps: combined W/Space hold and blur do not produce phantom air jumps',async t=>{
  const {p,run}=await game(t);await p.keyboard.down('Space');await tick(p);await p.keyboard.down('w');await tick(p);
  assert.equal(await run('state.player.jump_extension.air_available'),true);
  await p.keyboard.up('Space');await tick(p);assert.equal(await run('state.player.jump_extension.air_available'),true);
  await p.keyboard.up('w');await tick(p);await p.keyboard.down('w');await tick(p);
  assert.equal(await run('state.player.jump_extension.air_available'),false);
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await tick(p);
  assert.equal(await run('keyRaw.size'),0);assert.equal(await run('input.Jump.down'),false);assert.equal(await run('state.player.jump_extension.air_available'),false);
  metrics.scenarios.push({case:'aliases-and-blur',noPhantomJump:true});
});
test('browser M1 jumps: real U rope attachment takes over jump carry, then detach does not refill jumps',async t=>{
  const {p,run}=await game(t);
  await run("state.rects=[{id:'ANCHOR',type:'Wall',x:55,y:-15,w:1,h:35}];Object.assign(state.player,{x:50,y:-20,vx:0,vy:0,grounded:false});state.cam={x:50,y:-20};mx=1279;my=360");
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');await tick(p);
  assert.equal(await run('state.player.jump_extension.air_available'),false);
  await run('state.cam={x:state.player.x,y:state.player.y};mx=1279;my=360');
  await p.keyboard.down('u');let n=0;
  while(!(await run("['rope_slack','rope_taut'].includes(state.grapple.mode)"))&&n++<25)await tick(p);
  assert.ok(n<25,'real U hook reaches the wall');assert.equal(await run('state.player.jump_extension.carry'),false);
  await p.keyboard.up('u');await tick(p);assert.equal(await run('state.grapple.mode'),'none');
  assert.equal(await run('state.player.jump_extension.air_available'),false);
  await run('respawn()');assert.equal(await run('state.player.jump_extension'),null);
  metrics.scenarios.push({case:'jump-rope-detach-respawn',hookTicks:n,carryCleared:true,noRefill:true});
});
