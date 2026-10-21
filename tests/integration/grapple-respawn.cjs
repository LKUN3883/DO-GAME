// Run explicitly against a combined checkout; this is not a standalone-branch test.
// GAME_REPO_ROOT=/path/to/combined node --test tests/integration/grapple-respawn.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.GAME_REPO_ROOT || path.resolve(__dirname,'../..');
const {game}=require(path.join(root,'tests/game-harness.cjs'));

test('combined death clears grapple immediately, then masks held RMB for the lock tick',async()=>{
  const g=await game();
  assert.equal(g.run('typeof separatePlayerBodies'),'function','requires the respawn/body branch');
  g.run('state.enemies=[]');g.tick(40);g.mouse(2,true);g.tick();
  g.run('state.player.hp=0');g.tick();
  assert.equal(g.run('state.player.respawn_lock'),1);
  assert.deepEqual(JSON.parse(g.run('JSON.stringify(state.grapple)')),
    {mode:'none',head:null,anchor:null,target:null,local:null,stuck_frames:0,end:false});
  g.tick();
  assert.equal(g.run('state.player.respawn_lock'),0);
  assert.equal(g.run('state.grapple.mode'),'none');
  assert.equal(g.run('input.RMB.down || input.RMB.just_pressed || input.RMB.just_released'),false);
});

test('combined body separation that cancels pull displacement leads to STUCK',async()=>{
  const g=await game();
  assert.equal(g.run('typeof separatePlayerBodies'),'function','requires the respawn/body branch');
  g.run(`state.rects=[{id:'G',type:'Solid',x:50,y:-25.5,w:100,h:1}];
    state.boss.alive=false;
    state.enemies=[{id:'E',type:'ranged_rifle',alive:true,hp:95,x:12,y:-24.399,
      w:1.2,h:1.2,vx:0,vy:0,grounded:true,shoot_cd:10000}];
    Object.assign(state.player,{x:10,y:-23.999,vx:0,vy:0,grounded:true});
    spawnGrapple({x:1,y:0});state.grapple.head.x=11.4;updateGrapple();`);
  g.tick(30);
  assert.equal(g.run('state.grapple.mode'),'stuck');
  const x=g.run('state.player.x');g.tick(30);
  assert.equal(g.run('state.player.x'),x);
  g.mouse(2,true);g.tick();g.mouse(2,false);g.tick();
  assert.equal(g.run('state.grapple.mode'),'none');
});
