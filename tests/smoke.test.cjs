const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function game() {
  const root = path.join(__dirname, '..', 'docs');
  const handlers = {};
  const labels = [];
  const context2d = new Proxy({}, {
    get(_, key) {
      if (key === 'fillText') return (value) => labels.push(String(value));
      return () => {};
    },
    set() { return true; },
  });
  const canvas = {
    getContext: () => context2d,
    getBoundingClientRect: () => ({left:0, top:0, width:1280, height:720}),
    addEventListener: (name, fn) => { handlers['canvas:'+name] = fn; },
  };
  const scope = vm.createContext({
    document: {
      getElementById: () => canvas,
      addEventListener: (name, fn) => {handlers['document:'+name] = fn;},
      hidden: false,
    },
    window: {addEventListener:(name, fn) => {handlers[name] = fn;}},
    fetch: async () => ({json: async () => JSON.parse(fs.readFileSync(path.join(root, 'level_train_v1.json'),'utf8'))}),
    performance: {now:()=>0},
    requestAnimationFrame:()=>{},
    console,
    Math,
    Map,
    Set,
  });
  vm.runInContext(fs.readFileSync(path.join(root,'game.js'),'utf8'),scope,{filename:'docs/game.js'});
  await new Promise(resolve => setImmediate(resolve));
  const run = (code) => vm.runInContext(code,scope);
  const tick = (n=1) => {for(let k=0;k<n;k++) run('updateLogic(); updateCamera();');};
  const key = (name, down) => handlers[down?'keydown':'keyup']({code:name, preventDefault() {}});
  const mouse = (button,down) => handlers[down?'canvas:mousedown':'canvas:mouseup']({button});
  return {run,tick,key,mouse,labels};
}

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
  g.key('KeyF',true);g.tick(1);
  const pushed=g.run('state.enemies[0].x');
  assert.ok(pushed>before+0.3,'knockback moves enemy at hit frame');
  g.key('KeyF',false);g.tick(10);
  assert.equal(g.run('state.enemies[0].hp'),30,'each swing may hit the enemy only once');
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

test('ranged enemy cannot detect the player through a solid wall',async()=>{
  const g=await game();
  g.tick(60);
  g.run("state.enemies=[{id:'E_TEST',type:'ranged_rifle',alive:true,x:12,y:state.player.y,w:1.2,h:1.2,hp:95,vx:0,vy:0,grounded:false,shoot_cd:0,discovered:false,exclaim_t:0}]; state.rects.push({id:'SIGHT_TEST_WALL',type:'Wall',x:9,y:-21,w:1,h:8});");
  g.tick(1);
  assert.equal(g.run('state.enemies[0].discovered'),false);
  assert.equal(g.run('state.projectiles.filter(p=>p.owner==="enemy").length'),0);
  g.run("state.rects=state.rects.filter(r=>r.id!=='SIGHT_TEST_WALL')");
  g.tick(1);
  assert.equal(g.run('state.enemies[0].discovered'),true);
  assert.ok(g.run('state.enemies[0].exclaim_t')>0);
});

test('boss cannot be damaged before its trigger',async()=>{
  const g=await game();
  g.run("state.projectiles.push({owner:'player',x:300,y:-20,vx:0,vy:0,w:1,h:1,damage:9,spawn_seq:0,age:0,destroyed:false})");
  g.tick(1);
  assert.equal(g.run('state.boss.hp'),420);
});
