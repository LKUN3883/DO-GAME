const test = require('node:test');
const assert = require('node:assert/strict');
const {game} = require('./helpers/game.cjs');

test('grounded A/D movement does not teleport and stops after key release',async()=>{
  const g=await game();
  g.tick(60);
  const start=g.run('state.player.x');
  assert.ok(Math.abs(start-6)<1,'spawn position should not teleport');
  g.key('KeyD',true);g.tick(15);g.key('KeyD',false);g.tick(1);
  const stop=g.run('state.player.x');
  assert.ok(stop>start+0.5 && stop<start+5, 'D moves a short distance, not across level');
  g.tick(10);
  assert.ok(Math.abs(g.run('state.player.x')-stop)<0.02, 'release stops movement');
  g.key('KeyA',true);g.tick(15);g.key('KeyA',false);g.tick(1);
  assert.ok(g.run('state.player.x') < stop-0.5,'A goes left');
});

test('one melee swing damages enemy once and knocks it back',async()=>{
  const g=await game();
  g.tick(60);
  g.run("state.enemies = [{id:'E_TEST',type:'melee_basic',alive:true,x:state.player.x+2,y:state.player.y,w:1,h:1.6,hp:110,vx:0,vy:0,grounded:true,melee_cd:100,discovered:false}]; mx=1279;my=360;");
  const before=g.run('state.enemies[0].x');
  g.key('KeyF',true);g.tick(1);g.key('KeyF',false);g.tick(10);
  assert.equal(g.run('state.enemies[0].hp'),30);
  assert.ok(g.run('state.enemies[0].x')>before+0.3,'knockback moves enemy');
});

test('grapple flies and can pull player toward an obstacle',async()=>{
  const g=await game();
  g.tick(60);
  g.run("state.enemies=[]; state.rects.push({id:'GRAPPLE_TEST_WALL',type:'Wall',x:14,y:-21,w:1,h:8}); mx=1279;my=360;");
  const start=g.run('state.player.x');
  g.mouse(2,true);g.tick(55);
  assert.ok(g.run('state.player.x')>start+1.0,'grapple should pull toward wall');
  g.mouse(2,false);g.tick(1);
  assert.equal(g.run('state.grapple.mode'),'none');
});

test('inactive boss does not appear as an attackable active boss',async()=>{
  const g=await game();
  assert.equal(g.run('state.boss.active'),false);
  g.run('render()');
  assert.ok(!g.labels.some(x => x.startsWith('BOSS HP')),'inactive boss has no health bar');
  g.run("state.player.x=280;state.player.y=-21;postChecks()");
  assert.equal(g.run('state.boss.active'),true);
  g.run('render()');
  assert.ok(g.labels.some(x=>x.startsWith('BOSS HP')),'active boss bar must be visible');
});
