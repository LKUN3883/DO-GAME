const test=require('node:test');
const assert=require('node:assert/strict');
const {game}=require('./game-harness.cjs');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
async function settled(){const g=await game();g.run('state.enemies=[]');g.tick(60);return g;}

test('A and D each move 8cm/s; key repeat, simultaneous keys, release and blur stop',async()=>{
  const g=await settled(); const x=g.run('state.player.x');
  g.key('KeyD',true);g.tick(60);close(g.run('state.player.x'),x+8);
  g.key('KeyD',true);g.key('KeyA',true);g.tick(10);close(g.run('state.player.x'),x+8);
  g.key('KeyD',false);g.tick(60);close(g.run('state.player.x'),x);
  g.key('KeyA',false);g.tick(20);close(g.run('state.player.x'),x);
  g.key('KeyD',true);g.tick();g.handlers.blur();g.tick();const stop=g.run('state.player.x');g.tick(20);close(g.run('state.player.x'),stop);
});

test('ordinary jump is fixed height, does not dash on hold, then lands',async()=>{
  const g=await settled();const base=g.run('state.player.y');
  g.key('KeyW',true);g.tick();assert.equal(g.run('state.player.dash'),null);assert.equal(g.run('state.player.dash_used'),false);
  let apex=base;for(let i=0;i<40;i++){g.tick();apex=Math.max(apex,g.run('state.player.y'));}
  assert.ok(apex-base>7 && apex-base<8);assert.equal(g.run('state.player.dash_used'),false);
  g.tick(90);close(g.run('state.player.y'),base);assert.equal(g.run('state.player.grounded'),true);
});

test('second jump press dashes exactly 6cm, costs 30 ST and cannot repeat before landing',async()=>{
  const g=await settled();g.key('Space',true);g.tick(5);g.key('Space',false);g.tick();
  g.run('state.cam.x=state.player.x;state.cam.y=state.player.y;mx=1000;my=360');
  const x=g.run('state.player.x'),st=g.run('state.player.st');
  g.key('Space',true);g.tick(8);close(g.run('state.player.x'),x+6);close(g.run('state.player.st'),st-30+8*0.2);
  assert.equal(g.run('state.player.dash'),null);assert.equal(g.run('state.player.vx'),0);
  g.key('Space',false);g.tick();g.key('Space',true);g.tick();assert.equal(g.run('state.player.dash'),null);
  g.key('Space',false);g.tick(120);assert.equal(g.run('state.player.dash_used'),false);
});

test('diagonal dash ends on first wall contact instead of sliding along it',async()=>{
  const g=await settled();g.run("state.player.y=-18;state.player.grounded=false;state.player.dash_used=true;state.player.dash={dir:{x:Math.SQRT1_2,y:Math.SQRT1_2},left:6};state.rects.push({id:'TEST_WALL',type:'Wall',x:7.2,y:-15,w:1,h:20})");
  g.tick();assert.equal(g.run('state.player.dash'),null);assert.equal(g.run('state.player.vx'),0);assert.equal(g.run('state.player.vy'),0);
});

test('solid landing chooses highest top even with different obstacle heights',async()=>{
  const g=await game();g.run("state.rects=[{id:'low',type:'Solid',x:6,y:-2,w:10,h:1},{id:'high',type:'Solid',x:6,y:-3,w:10,h:6}];state.player.y=2;state.player.vy=-5;resolveAxis(state.player,0,-2)");
  close(g.run('state.player.y'),1.001);assert.equal(g.run('state.player.grounded'),true);
});

test('OneWay allows ascent, lands from above and S+jump drops without jumping',async()=>{
  const g=await settled();g.run('state.player.x=40;state.player.y=-16;state.player.vy=10;resolveAxis(state.player,0,2)');
  close(g.run('state.player.y'),-14);assert.equal(g.run('state.player.grounded'),false);
  g.run('state.player.y=-12;state.player.vy=-10;resolveAxis(state.player,0,-2)');
  close(g.run('state.player.y'),-12.999);assert.equal(g.run('state.player.standing_oneway_id'),'OneA');
  g.key('KeyS',true);g.key('Space',true);g.tick();assert.equal(g.run('state.player.jump_ascend'),false);assert.equal(g.run('state.player.dash'),null);
  g.tick(20);assert.ok(g.run('state.player.y') < -14);
});

test('Boss loses 80 once per swing, no knockback, next swing can hit again',async()=>{
  const g=await settled();g.run("state.player.x=298;state.player.y=-23.999;Object.assign(state.boss,{active:true,x:300,y:-23.699,phase:'idleA',phase_t:100});mx=1279;my=360;state.cam={x:298,y:-23.999}");
  const before=g.run('state.boss.x');g.key('KeyF',true);g.tick();assert.equal(g.run('state.boss.hp'),340);close(g.run('state.boss.x'),before);
  g.tick(25);assert.equal(g.run('state.boss.hp'),340);
  g.key('KeyF',false);g.tick(40);g.run('state.player.y=state.boss.y;state.player.vy=0');g.key('KeyF',true);g.tick();assert.equal(g.run('state.boss.hp'),260);
});

test('projectile spawn backtracks out of wall or fails without consuming ammo or sequence',async()=>{
  const g=await settled();g.run("state.rects=[{id:'wall',type:'Wall',x:7,y:0,w:1,h:10}]");
  assert.equal(g.run("spawnProjectile({x:6.8,y:0,w:0.25,h:0.1,vx:30,vy:0})"),true);
  assert.ok(g.run('state.projectiles[0].x')<6.375);
  g.run("state.rects=[{id:'wall',type:'OneWay',x:6,y:state.player.y,w:10,h:10}];mx=1279;my=360");
  const seq=g.run('state.spawn_seq');g.mouse(0,true);g.tick();assert.equal(g.run('state.player.ammo'),60);assert.equal(g.run('state.spawn_seq'),seq);assert.ok(g.run('state.p_fire_cd')>0);
});

test('mouse released outside canvas clears held fire',async()=>{
  const g=await settled();g.mouse(0,true);g.tick();g.mouse(0,false);g.tick();const ammo=g.run('state.player.ammo');g.tick(30);assert.equal(g.run('state.player.ammo'),ammo);
});

test('head collision stops ascent, wall blocks horizontal movement, unlocked doors do not',async()=>{
  const g=await settled();g.run("state.rects.push({id:'ceiling',type:'Solid',x:6,y:-20,w:4,h:1});state.player.vy=53;resolveAxis(state.player,0,4)");
  close(g.run('state.player.y'),-21.501);assert.equal(g.run('state.player.vy'),0);
  g.run("state.rects.push({id:'wall',type:'Wall',x:7,y:-23,w:1,h:10});state.player.vx=8;resolveAxis(state.player,0.5,0)");
  close(g.run('state.player.x'),5.999);assert.equal(g.run('state.player.vx'),0);
  g.run("state.rects=state.rects.filter(r=>r.id!=='wall');state.rects.push({id:'door',type:'Door',locked:false,x:7,y:-23,w:1,h:10});resolveAxis(state.player,1,0)");
  close(g.run('state.player.x'),6.999);
});

test('eight unresolved collision corrections roll back and clear both velocities',async()=>{
  const g=await game();g.run("state.rects=Array.from({length:30},(_,i)=>({id:String(i),type:'Wall',x:1-i,y:0,w:1,h:5}));Object.assign(state.player,{x:0,y:0,vx:8,vy:4});resolveAxis(state.player,1,0)");
  close(g.run('state.player.x'),0);close(g.run('state.player.y'),0);assert.equal(g.run('state.player.vx'),0);assert.equal(g.run('state.player.vy'),0);
});

test('ground contact does not cancel ordinary enemy melee knockback; wall backtracks it',async()=>{
  const g=await settled();g.run("state.enemies=[{id:'target',alive:true,x:8,y:-23.999,w:1,h:2,hp:110,vx:5,vy:0}];state.hits=[{src:'p_melee',id:'target',damage:80}];resolveDamage()");
  assert.ok(g.run('state.enemies[0].x')>8.4);assert.equal(g.run('state.enemies[0].vx'),5);
  g.run("state.hits=[];state.enemies[0].x=8;state.rects.push({id:'stop',type:'Wall',x:9.2,y:-22,w:1,h:8});state.hits=[{src:'p_melee',id:'target',damage:80}];resolveDamage()");
  assert.ok(g.run('state.enemies[0].x')<8.201);assert.equal(g.run('state.enemies[0].hp'),-50);
});


test('approved Boss camera Y bounds are -21 and -9; X bounds remain 286 and 314',async()=>{
  const g=await game();
  g.run('state.boss_mode=true;state.cam={x:0,y:-50};updateCamera()');
  assert.equal(g.run('state.cam.y'),-21);assert.equal(g.run('state.cam.x'),286);
  g.run('state.cam={x:400,y:50};updateCamera()');
  assert.equal(g.run('state.cam.y'),-9);assert.equal(g.run('state.cam.x'),314);
});
