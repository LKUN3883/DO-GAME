const test = require('node:test');
const assert = require('node:assert/strict');
const {game} = require('./game-harness.cjs');
const near=(a,b,eps=0.004)=>assert.ok(Math.abs(a-b)<eps, String(a)+' != '+String(b));

test('death resets every action and locks input exactly one subsequent frame',async()=>{
  const g=await game();
  g.run("state.enemies=[];Object.assign(state.player,{hp:0,x:20,y:-21,h:1,dash_used:true,jump_ascend:true,slide:{dir:1,t:0.2},crouch:true,melee:{t:0.6,hit:new Set(),window:0.3},standing_oneway_id:'OneA'});state.grapple={mode:'stuck',head:null,anchor:{x:40,y:-21},target:null,local:null,stuck_frames:3,end:false};state.projectiles=[{x:20,y:-21,w:0.2,h:0.1,owner:'player',damage:9,spawn_seq:100,destroyed:false}];state.hint={text:'old',t:7}");
  g.tick();
  assert.equal(g.run('state.player.hp'),100);
  assert.equal(g.run('state.player.respawn_lock'),1,'lock still pending after death tick');
  assert.equal(g.run('state.player.melee'),null);
  assert.equal(g.run('state.player.h'),2);
  assert.equal(g.run('state.player.slide'),null);
  assert.equal(g.run('state.player.standing_oneway_id'),'');
  assert.equal(g.run('state.grapple.mode'),'none');
  assert.equal(g.run('state.projectiles.length'),0);
  assert.equal(g.run('state.hint.text'),'');
  g.key('KeyF',true);g.key('Space',true);g.mouse(0,true);g.mouse(2,true);
  g.tick();
  assert.equal(g.run('state.player.respawn_lock'),0);
  assert.equal(g.run('state.player.melee'),null);
  assert.equal(g.run('state.player.dash'),null);
  assert.equal(g.run('state.grapple.mode'),'none');
  assert.equal(g.run('state.player.ammo'),60);
  for(const name of ['Jump','F','LMB','RMB'])
    assert.equal(g.run('input.'+name+'.down || input.'+name+'.just_pressed || input.'+name+'.just_released'),false,name);
  g.key('KeyF',false);g.key('Space',false);g.mouse(0,false);g.mouse(2,false);
});

test('death in Boss room resets phase and preserves Boss HP',async()=>{
  const g=await game();
  g.run("state.enemies=[];state.boss_mode=true;Object.assign(state.boss,{active:true,alive:true,hp:177,phase:'charge',charge:{dir:1,left:4},charge_next:'shotgun',charge_t:2.4,charge_pending:true,shoot_cd:0.3,shot_count:2,warning_t:0.1});state.rects.find(r=>r.id==='DoorBoss').locked=true;state.player.hp=0;state.player.x=300");
  g.tick();
  assert.equal(g.run('state.boss_mode'),false);
  assert.equal(g.run("state.rects.find(r=>r.id==='DoorBoss').locked"),false);
  assert.equal(g.run('state.boss.active'),false);
  assert.equal(g.run('state.boss.hp'),177);
  assert.equal(g.run('state.boss.phase'),'rifle');
  assert.equal(g.run('state.boss.charge'),null);
  assert.equal(g.run('state.boss.charge_next'),null);
  assert.equal(g.run('state.boss.shot_count'),0);
  assert.equal(g.run('state.boss.charge_t'),0);
  assert.equal(g.run('state.boss.charge_pending'),false);
});

test('body separation resolves tie along X, preserves both velocities',async()=>{
  const g=await game();
  g.run("state.rects=[];state.enemies=[{id:'E1',type:'melee_basic',alive:true,x:6,y:-21,w:1,h:2,hp:110,vx:5,vy:0}];Object.assign(state.player,{x:6,y:-21,w:1,h:2,vx:8,vy:0})");
  g.run('separatePlayerBodies()');
  near(g.run('state.player.x'),7.002);
  near(g.run('state.player.y'),-21);
  near(g.run('state.enemies[0].x'),6);
  near(g.run('state.enemies[0].vx'),5);
  near(g.run('state.player.vx'),8);
  assert.equal(g.run('overlap(aabb(state.player),aabb(state.enemies[0]))'),false);
});

test('body separation chooses smallest Y shift and ignores inactive Boss',async()=>{
  const g=await game();
  g.run("state.rects=[];state.enemies=[{id:'E1',type:'melee_basic',alive:true,x:6.1,y:-19.2,w:1,h:2,hp:110,vx:0,vy:0}];Object.assign(state.player,{x:6,y:-21,w:1,h:2,vx:0,vy:7})");
  g.run('separatePlayerBodies()');
  near(g.run('state.player.x'),6);
  assert.ok(g.run('state.player.y')<-21.18);
  near(g.run('state.player.vy'),7);
  g.run("state.enemies=[];state.player.x=300;state.player.y=-20.2;state.boss.x=300;state.boss.y=-20.2;state.boss.active=false");
  g.run('separatePlayerBodies()');
  near(g.run('state.player.x'),300);
});

test('terrain correction after body separation clears wall penetration',async()=>{
  const g=await game();
  g.run("state.rects=[{id:'wall',type:'Wall',x:5,y:-21,w:1,h:10}];state.enemies=[{id:'E1',type:'melee_basic',alive:true,x:6.3,y:-21,w:1,h:2,hp:110,vx:0,vy:0}];Object.assign(state.player,{x:6,y:-21,w:1,h:2,vx:-8,vy:0})");
  g.run('separatePlayerBodies()');
  assert.equal(g.run('blockers(false).some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
});
