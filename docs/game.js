const DT = 1 / 60;
const EPS = 0.001;
const PX_PER_CM = 40;
const VIEW_W = 32;
const VIEW_H = 18;
const VIEW_HW = 16;
const VIEW_HH = 9;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const keyRaw = new Map();
const input = {
  A: { down: false, prev: false, just_pressed: false, just_released: false },
  D: { down: false, prev: false, just_pressed: false, just_released: false },
  S: { down: false, prev: false, just_pressed: false, just_released: false },
  Jump: { down: false, prev: false, just_pressed: false, just_released: false },
  F: { down: false, prev: false, just_pressed: false, just_released: false },
  LMB: { down: false, prev: false, just_pressed: false, just_released: false },
  RMB: { down: false, prev: false, just_pressed: false, just_released: false },
};
let mx = 640; let my = 360;

window.addEventListener('keydown', (e) => keyRaw.set(e.code, true));
window.addEventListener('keyup', (e) => keyRaw.set(e.code, false));
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mx = Math.round(e.clientX - r.left);
  my = Math.round(e.clientY - r.top);
});
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) keyRaw.set('Mouse0', true); if (e.button === 2) keyRaw.set('Mouse2', true);});
canvas.addEventListener('mouseup', (e) => { if (e.button === 0) keyRaw.set('Mouse0', false); if (e.button === 2) keyRaw.set('Mouse2', false);});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const clamp = (x,a,b)=>Math.min(Math.max(x,a),b);
const sign = (x)=>(x>0?1:(x<0?-1:0));
const len = (v)=>Math.hypot(v.x,v.y);
const norm = (v)=>{const l=len(v); return l<=EPS?{x:0,y:0}:{x:v.x/l,y:v.y/l};};
const dot = (a,b)=>a.x*b.x+a.y*b.y;

const aabb = (o)=>({min_x:o.x-o.w/2,max_x:o.x+o.w/2,min_y:o.y-o.h/2,max_y:o.y+o.h/2});
const overlap = (a,b)=>a.min_x<=b.max_x+EPS&&a.max_x>=b.min_x-EPS&&a.min_y<=b.max_y+EPS&&a.max_y>=b.min_y-EPS;

let level = null;
let state = null;

async function boot() {
  const res = await fetch('./level_train_v1.json');
  level = await res.json();
  resetAll();
  requestAnimationFrame(loop);
}

function resetAll() {
  const p = level.player_spawn;
  const rects = level.rects.map(r=>({...r, locked:r.type==='Door'?!!r.locked_initially:undefined}));
  const enemies = [...level.enemies].sort((a,b)=>a.id.localeCompare(b.id)).map(e=>({ ...e, alive:true, discovered:false, exclaim_t:0, grounded:false, vx:0, vy:0, melee_cd:0, shoot_cd:0 }));
  state = {
    game_state:'RUN',
    player:{x:p.x,y:p.y,vx:0,vy:0,w:1,h:2,facing:p.facing,grounded:false,standing_oneway_id:'',ignore_oneway_id:'',ignore_timer:0,hp:100,st:100,ammo:60,iframe:0,dash_used:false,dash:null,jump_t:0,jump_ascend:false,crouch:false,slide:null,melee:null,respawn_lock:0},
    boss:{...level.boss, alive:true, hp:420, vx:0, vy:0, grounded:false, active:false, dead:false, death_t:0, phase:'rifle', phase_t:2, shoot_cd:0, shot_count:0, charge_t:0, charge_pending:false, warning_t:0, charge:null},
    rects, enemies, projectiles:[], spawn_seq:0,
    grapple:{mode:'none',head:null,anchor:null,target:null,local:null,stuck_frames:0,end:false},
    cam:{x:p.x,y:p.y},
    hint:{text:'',t:0},
    boss_mode:false,
    hits:[],
  };
}

function sampleInput() {
  const map = {
    A: !!keyRaw.get('KeyA'), D: !!keyRaw.get('KeyD'), S: !!keyRaw.get('KeyS'),
    Jump: !!keyRaw.get('KeyW') || !!keyRaw.get('Space'), F: !!keyRaw.get('KeyF'),
    LMB: !!keyRaw.get('Mouse0'), RMB: !!keyRaw.get('Mouse2')
  };
  for (const k in input) {
    input[k].prev = input[k].down;
    input[k].down = !!map[k];
    if (state.player.respawn_lock > 0) input[k].down = false;
    input[k].just_pressed = input[k].down && !input[k].prev;
    input[k].just_released = !input[k].down && input[k].prev;
  }
  mx = clamp(mx,0,1279); my = clamp(my,0,719);
}

function blockers(includeOneWay=false) {
  return state.rects.filter(r=>['Solid','Wall'].includes(r.type) || (r.type==='Door'&&r.locked) || (includeOneWay&&r.type==='OneWay'));
}
function playerAimDir() {
  if (state.player.respawn_lock>0) return {x:state.player.facing,y:0};
  const mw = { x: state.cam.x - VIEW_HW + (mx / PX_PER_CM), y: state.cam.y + VIEW_HH - (my / PX_PER_CM) };
  const raw = {x:mw.x-state.player.x,y:mw.y-state.player.y};
  if (len(raw)<=EPS) return {x:state.player.facing,y:0};
  return norm(raw);
}

function resolveAxis(obj, dx, dy) {
  const prev = {x:obj.x,y:obj.y};
  obj.x += dx;
  for (let i=0;i<8;i++) {
    const hits = blockers(false).filter(r=>overlap(aabb(obj),aabb(r)));
    if (!hits.length) break;
    const sorted = hits.sort((a,b)=>dx>0?((a.x-a.w/2)-(b.x-b.w/2)||a.id.localeCompare(b.id)):((b.x+b.w/2)-(a.x+a.w/2)||a.id.localeCompare(b.id)));
    const o = sorted[0];
    if (dx>0) obj.x = o.x-o.w/2-obj.w/2-EPS; else if (dx<0) obj.x = o.x+o.w/2+obj.w/2+EPS;
    obj.vx=0;
  }
  const preY = obj.y;
  obj.y += dy;
  obj.grounded = false;
  obj.standing_oneway_id = '';
  for (let i=0;i<8;i++) {
    let hits = blockers(false).filter(r=>overlap(aabb(obj),aabb(r)));
    if (dy<0) {
      for (const ow of state.rects.filter(r=>r.type==='OneWay')) {
        if (obj.ignore_oneway_id===ow.id) continue;
        const top = ow.y+ow.h/2;
        const prev_bottom = preY-obj.h/2;
        const curr_bottom = obj.y-obj.h/2;
        const xok = (obj.x+obj.w/2)>=ow.x-ow.w/2-EPS && (obj.x-obj.w/2)<=ow.x+ow.w/2+EPS;
        if (xok && obj.vy<0 && prev_bottom>=top+EPS && curr_bottom<=top+EPS) hits.push(ow);
      }
    }
    if (!hits.length) break;
    const sorted = hits.sort((a,b)=>dy>0?((a.y-a.h/2)-(b.y-b.h/2)||a.id.localeCompare(b.id)):((b.y+b.h/2)-(a.y+b.h/2)||a.id.localeCompare(b.id)));
    const o = sorted[0];
    if (dy>0) obj.y = o.y-o.h/2-obj.h/2-EPS;
    if (dy<0) {
      obj.y = o.y+o.h/2+obj.h/2+EPS;
      obj.grounded=true;
      if (o.type==='OneWay') obj.standing_oneway_id=o.id;
    }
    obj.vy=0;
  }
  if (obj.y===prev.y && obj.x===prev.x && (dx!==0||dy!==0)) { obj.vx=0; obj.vy=0; }
}

function updateLogic() {
  // Assertion A/F points: fixed order + one-frame just_pressed in sampleInput.
  sampleInput();
  const p=state.player;
  p.iframe=Math.max(0,p.iframe-DT);
  p.ignore_timer-=DT; if (p.ignore_timer<=0){p.ignore_timer=0;p.ignore_oneway_id='';}

  let input_x = (input.A.down?-1:0)+(input.D.down?1:0); if (input.A.down&&input.D.down) input_x=0;
  if (input_x!==0) p.facing=input_x;
  const aim = playerAimDir();

  const downThrough = p.grounded && p.standing_oneway_id && input.S.down && input.Jump.just_pressed;
  if (downThrough) { p.ignore_oneway_id = p.standing_oneway_id; p.ignore_timer = 0.2; }

  if (p.grounded && input.Jump.just_pressed && !downThrough) { p.vy=53.334; p.jump_ascend=true; p.jump_t=0; }
  if (p.jump_ascend) { p.jump_t+=DT; if (p.jump_t>0.3||p.vy<=0) p.jump_ascend=false; }

  if (!p.grounded && !p.dash && !state.grapple.mode.startsWith('pull') && input.Jump.just_pressed && !p.dash_used) {
    if (p.st>=30) { p.st-=30; p.dash_used=true; p.dash={dir:aim,left:6}; p.vx=0; p.vy=0; }
    else { state.hint={text:'体力不足',t:0.5}; }
  }

  if (input.F.just_pressed && (!p.melee || p.melee.t<=0)) {
    if (p.st>=18) { p.st-=18; p.melee={t:1.0, hit:new Set(), window:0.45}; }
    else state.hint={text:'体力不足',t:0.5};
  }

  // grapple
  if (input.RMB.just_released) state.grapple={mode:'none',head:null,anchor:null,target:null,local:null,stuck_frames:0,end:false};
  if (input.RMB.just_pressed && state.grapple.mode==='none') {
    let hx=p.x+aim.x*0.9, hy=p.y+aim.y*0.9;
    const head={x:hx,y:hy,w:0.3,h:0.3,vx:aim.x*28,vy:aim.y*28,origin:{x:hx,y:hy}};
    state.grapple={mode:'fly',head,anchor:null,target:null,local:null,stuck_frames:0,end:false};
  }

  if (p.dash) {
    const step = Math.min(50*DT,p.dash.left);
    p.vx = p.dash.dir.x*50; p.vy = p.dash.dir.y*50;
    resolveAxis(p,p.dash.dir.x*step,p.dash.dir.y*step);
    p.dash.left -= step;
    if (p.dash.left<=EPS || p.vx===0&&p.vy===0) { p.dash=null; p.vx=0; p.vy=0; }
  } else {
    if (p.slide) {
      p.slide.t += DT;
      const sp=Math.max(0,10-(10/0.9)*p.slide.t);
      p.vx=p.slide.dir*sp;
      if (sp<=0 || !p.grounded) p.slide=null;
    } else {
      p.vx=input_x*8;
      if (p.grounded && p.vx!==0 && input.S.just_pressed) p.slide={dir:p.facing,t:0};
    }
    if (!p.jump_ascend && !state.grapple.mode.startsWith('pull')) p.vy = Math.max(-15,p.vy + (-180)*DT);
    if (p.jump_ascend) p.vy += (-177.78)*DT;
    resolveAxis(p,p.vx*DT,p.vy*DT);
  }

  if (p.grounded) p.dash_used=false;
  p.crouch = p.grounded && p.vx===0 && input.S.down;
  p.h = (p.crouch || p.slide) ? 1 : 2;

  if (p.melee) {
    p.melee.t -= DT;
    if (p.melee.window>0){
      p.melee.window -= DT;
      for (const e of state.enemies.filter(e=>e.alive)) {
        if (p.melee.hit.has(e.id)) continue;
        const to={x:e.x-p.x,y:e.y-p.y};
        if (len(to)<=3.2+EPS && dot(norm(to),aim)>=0.5) { state.hits.push({src:'p_melee',id:e.id,damage:80}); p.melee.hit.add(e.id); }
      }
      const b=state.boss;
      if (b.alive && !b.dead) {
        const to={x:b.x-p.x,y:b.y-p.y};
        if (len(to)<=3.2+EPS && dot(norm(to),aim)>=0.5) state.hits.push({src:'p_melee',id:'BOSS',damage:80});
      }
    }
    if (p.melee.t<=0) p.melee=null;
  }

  // player fire rate timer
  state.p_fire_cd = (state.p_fire_cd ?? 0) - DT;
  if (input.LMB.down) {
    const interval=0.1;
    while (state.p_fire_cd<=0) {
      if (p.ammo<=0) state.hint={text:'弹药不足',t:0.6};
      else {
        p.ammo-=1;
        spawnProjectile({x:p.x+aim.x*0.8,y:p.y+aim.y*0.8,vx:aim.x*30,vy:aim.y*30,w:0.25,h:0.1,damage:9,owner:'player'});
      }
      state.p_fire_cd += interval;
    }
  } else state.p_fire_cd=Math.max(state.p_fire_cd,0);

  updateEnemies();
  updateBoss();
  updateProjectiles();
  resolveDamage(); // Assertion B point
  cleanup(); // Assertion C/E point
  postChecks();
  p.st = Math.min(100, p.st+12*DT);
  if (state.hint.t>0) state.hint.t=Math.max(0,state.hint.t-DT); else if(state.game_state!=='WIN') state.hint.text='';
}

function spawnProjectile(pr) { pr.age=0; pr.destroyed=false; pr.spawn_seq=state.spawn_seq++; state.projectiles.push(pr); }

function updateEnemies() {
  const p=state.player;
  const vis={x:state.cam.x,y:state.cam.y,w:32,h:18};
  for (const e of state.enemies.filter(e=>e.alive)) {
    e.vy=Math.max(-15,e.vy-180*DT);
    const inCam = overlap(aabb(e),aabb(vis));
    e.discovered = inCam;
    if (e.type==='melee_basic') {
      const dir = sign(p.x-e.x)||1;
      e.vx = e.discovered ? dir*5 : 0;
      e.melee_cd-=DT;
      if (e.discovered && Math.hypot(p.x-e.x,p.y-e.y)<=1.2+EPS && e.melee_cd<=0) {
        state.hits.push({src:'e_melee',damage:22,to:'player'});
        e.melee_cd += 1/1.1;
      }
    } else {
      e.vx=0;
      const R = e.type==='ranged_rifle'?8:0.85;
      const interval=1/R;
      e.shoot_cd-=DT;
      if (e.discovered) {
        while (e.shoot_cd<=0) {
          const dir=norm({x:p.x-e.x,y:p.y-e.y});
          if (e.type==='ranged_rifle') spawnProjectile({x:e.x+dir.x*0.8,y:e.y+dir.y*0.8,vx:dir.x*26,vy:dir.y*26,w:0.22,h:0.1,damage:2,owner:'enemy'});
          else for (const deg of [-15,-7.5,0,7.5,15]) {
            const a=Math.atan2(dir.y,dir.x)+deg*Math.PI/180; spawnProjectile({x:e.x+Math.cos(a)*0.8,y:e.y+Math.sin(a)*0.8,vx:Math.cos(a)*20,vy:Math.sin(a)*20,w:0.18,h:0.18,damage:4,owner:'enemy'});
          }
          e.shoot_cd += interval;
        }
      } else e.shoot_cd = Math.max(e.shoot_cd,0);
    }
    resolveAxis(e,e.vx*DT,e.vy*DT);
  }
}

function updateBoss() {
  const b=state.boss,p=state.player;
  if (!b.active || !b.alive) return;
  if (b.hp<=0&&!b.dead){ b.dead=true;b.death_t=0.8; state.boss_mode=false; }
  if (b.dead) return;
  if (b.hp<=210){ b.charge_t += DT; while (b.charge_t>=3.8){b.charge_t-=3.8; b.charge_pending=true;} }
  b.phase_t -= DT;
  b.shoot_cd -= DT;
  if (b.phase==='rifle') {
    while (b.shoot_cd<=0){const d=norm({x:p.x-b.x,y:p.y-b.y});spawnProjectile({x:b.x+d.x*0.8,y:b.y+d.y*0.8,vx:d.x*26,vy:d.y*26,w:0.22,h:0.1,damage:2,owner:'boss'});b.shoot_cd+=0.1;}
    if (b.phase_t<=0){b.phase='idleA';b.phase_t=0.5;}
  } else if (b.phase==='idleA') {
    if (b.charge_pending){b.phase='warn';b.phase_t=0.2;b.charge_pending=false;}
    else if (b.phase_t<=0){b.phase='shotgun';b.phase_t=0; b.shot_count=0; b.shoot_cd=0;}
  } else if (b.phase==='shotgun') {
    while (b.shoot_cd<=0&&b.shot_count<4){const d=norm({x:p.x-b.x,y:p.y-b.y});for(const deg of[-15,-7.5,0,7.5,15]){const a=Math.atan2(d.y,d.x)+deg*Math.PI/180;spawnProjectile({x:b.x+Math.cos(a)*0.8,y:b.y+Math.sin(a)*0.8,vx:Math.cos(a)*20,vy:Math.sin(a)*20,w:0.18,h:0.18,damage:4,owner:'boss'});}b.shot_count++;b.shoot_cd+=0.9;}
    if (b.shot_count>=4 && b.shoot_cd>0){b.phase='idleB';b.phase_t=0.6;}
  } else if (b.phase==='idleB') {
    if (b.charge_pending){b.phase='warn';b.phase_t=0.2;b.charge_pending=false;}
    else if (b.phase_t<=0){b.phase='rifle';b.phase_t=2.0; b.shoot_cd=0;}
  } else if (b.phase==='warn' && b.phase_t<=0) { b.phase='charge'; b.charge={dir:p.x>b.x?1:-1,left:6}; }
  if (b.phase==='charge') {
    const step=Math.min(18*DT,b.charge.left); b.vx=b.charge.dir*18;b.vy=0; resolveAxis(b,b.vx*DT,0); b.charge.left-=step;
    if (overlap(aabb(b),aabb(p))) state.hits.push({src:'boss_charge',to:'player',damage:18});
    if (b.charge.left<=EPS || b.vx===0){b.phase='rifle';b.phase_t=2;b.shoot_cd=0;b.vx=0;b.vy=0;}
  } else { b.vy=Math.max(-15,b.vy-180*DT); resolveAxis(b,0,b.vy*DT); }
}

function updateProjectiles() {
  for (const pr of state.projectiles.sort((a,b)=>a.spawn_seq-b.spawn_seq)) {
    if (pr.destroyed) continue;
    pr.x += pr.vx*DT; pr.y += pr.vy*DT;
    if (pr.owner==='player') {
      const ts = [...state.enemies.filter(e=>e.alive), ...(state.boss.alive&&!state.boss.dead?[state.boss]:[])].filter(t=>overlap(aabb(pr),aabb(t)));
      if (ts.length){
        ts.sort((a,b)=>Math.hypot(a.x-pr.x,a.y-pr.y)-Math.hypot(b.x-pr.x,b.y-pr.y)||a.id.localeCompare(b.id));
        const t=ts[0]; state.hits.push({src:'p_proj',id:t.id||'BOSS',damage:pr.damage}); pr.destroyed=true; continue;
      }
    } else {
      if (overlap(aabb(pr),aabb(state.player))) { state.hits.push({src:'e_proj',to:'player',damage:pr.damage,forceDestroy:true}); pr.destroyed=true; continue; }
    }
    if (blockers(true).some(r=>overlap(aabb(pr),aabb(r)))) pr.destroyed=true;
    if (pr.x<-10||pr.x>370||pr.y>30||pr.y<-50) pr.destroyed=true;
    pr.age += 1;
  }
}

function resolveDamage() {
  const p=state.player;
  let maxP = 0;
  for (const h of state.hits) {
    if (h.to==='player') maxP = Math.max(maxP,h.damage);
    if (h.id) {
      if (h.id==='BOSS') state.boss.hp -= h.damage;
      else { const e=state.enemies.find(x=>x.id===h.id&&x.alive); if (e) e.hp -= h.damage; }
    }
  }
  if (maxP>0 && p.iframe<=0) { p.hp -= maxP; p.iframe=0.45; }
}

function cleanup() {
  state.projectiles = state.projectiles.filter(p=>!p.destroyed);
  for (const e of state.enemies) if (e.alive && e.hp<=0) e.alive=false;
  const b=state.boss;
  if (b.dead) { b.death_t -= DT; if (b.death_t<=0){ b.alive=false; const db=state.rects.find(r=>r.id==='DoorBoss'); if (db) db.locked=false; } }
  state.hits = [];
}

function postChecks() {
  const p=state.player;
  const trig = state.rects.find(r=>r.type==='Trigger'&&r.kind==='BossTrigger');
  if (trig && overlap(aabb(p),aabb(trig)) && !state.boss.active) {
    const db=state.rects.find(r=>r.id==='DoorBoss'); if (db) db.locked=true;
    state.boss.active=true; state.boss_mode=true;
  }
  const aliveNormals = state.enemies.some(e=>e.alive);
  if (!aliveNormals && !state.boss.alive) {
    const ex=state.rects.find(r=>r.id==='DoorExit'); if (ex && ex.locked){ex.locked=false; state.hint={text:'出口解锁',t:1.0};}
  }
  const goal=state.rects.find(r=>r.type==='Trigger'&&r.kind==='Goal');
  const ex=state.rects.find(r=>r.id==='DoorExit');
  if (goal && ex && !ex.locked && overlap(aabb(p),aabb(goal))) { state.game_state='WIN'; state.hint={text:'通关',t:99999}; }

  if (p.hp<=0 || p.x<-5||p.x>365||p.y>20||p.y<-40) respawn();
  if (p.respawn_lock>0) p.respawn_lock--;
}

function respawn() {
  const cp = state.rects.filter(r=>r.type==='Checkpoint').sort((a,b)=>Math.hypot(state.player.x-a.x,state.player.y-a.y)-Math.hypot(state.player.x-b.x,state.player.y-b.y))[0] || {respawn_x:level.player_spawn.x,respawn_y:level.player_spawn.y,respawn_facing:level.player_spawn.facing};
  Object.assign(state.player,{x:cp.respawn_x,y:cp.respawn_y,vx:0,vy:0,hp:100,st:100,ammo:60,dash_used:false,dash:null,iframe:0,ignore_oneway_id:'',ignore_timer:0,jump_ascend:false,slide:null,crouch:false,facing:cp.respawn_facing,respawn_lock:1});
  state.projectiles=[];
  if (state.boss_mode){state.boss_mode=false; const db=state.rects.find(r=>r.id==='DoorBoss'); if (db) db.locked=false; state.boss.active=false; state.boss.phase='rifle'; state.boss.phase_t=2; state.boss.charge_pending=false; state.boss.charge_t=0;}
}

function updateCamera() {
  const p=state.player;
  let tx = p.x + p.facing * 4;
  let ty = p.y + (p.vy<=-8?-2:0);
  const alpha = 1 - Math.exp(-12*DT);
  let nx = state.cam.x + (tx-state.cam.x)*alpha;
  let ny = state.cam.y + (ty-state.cam.y)*alpha;
  const dx=nx-state.cam.x, dy=ny-state.cam.y;
  const sp=Math.hypot(dx,dy)/DT;
  if (sp>20){const k=(20*DT)/Math.hypot(dx,dy); nx=state.cam.x+dx*k; ny=state.cam.y+dy*k;}
  if (state.boss_mode){nx=clamp(nx,286,314);ny=clamp(ny,-13,-9);} else {nx=clamp(nx,16,344);ny=clamp(ny,-21,1);}
  state.cam.x=nx;state.cam.y=ny;
}

function render() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const toScreen=(x,y)=>({x:(x-(state.cam.x-VIEW_HW))*PX_PER_CM,y:(state.cam.y+VIEW_HH-y)*PX_PER_CM});
  const drawRect=(o,c)=>{const s=toScreen(o.x,o.y);ctx.fillStyle=c;ctx.strokeStyle='#000';ctx.lineWidth=2;ctx.fillRect(s.x-o.w*PX_PER_CM/2,s.y-o.h*PX_PER_CM/2,o.w*PX_PER_CM,o.h*PX_PER_CM);ctx.strokeRect(s.x-o.w*PX_PER_CM/2,s.y-o.h*PX_PER_CM/2,o.w*PX_PER_CM,o.h*PX_PER_CM);};
  for (const r of state.rects) {
    if (r.type==='Door'&&!r.locked) continue;
    drawRect(r,r.type==='OneWay'?'rgba(120,200,120,1)':r.type==='Door'?'rgba(200,140,80,1)':'rgba(120,120,120,1)');
  }
  for (const e of state.enemies.filter(e=>e.alive)) drawRect(e,e.type==='melee_basic'?'rgba(255,120,120,.86)':e.type==='ranged_rifle'?'rgba(255,170,80,.86)':'rgba(180,120,255,.86)');
  if (state.boss.alive) drawRect(state.boss,'rgba(255,200,80,.86)');
  for (const p of state.projectiles) drawRect(p,p.owner==='player'?'rgba(235,235,235,1)':(p.w<0.2?'rgba(220,180,255,1)':'rgba(255,240,160,1)'));
  drawRect(state.player,'rgba(80,180,255,.86)');
  const aim=playerAimDir();
  const s=toScreen(state.player.x,state.player.y), e=toScreen(state.player.x+aim.x*2,state.player.y+aim.y*2);
  ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(e.x,e.y);ctx.stroke();

  ctx.fillStyle='white'; ctx.font='20px sans-serif';
  ctx.fillText(`HP ${Math.round(state.player.hp)} ST ${Math.round(state.player.st)} AMMO ${state.player.ammo}`, 24, 32);
  if (state.hint.text && state.hint.t>0) ctx.fillText(state.hint.text, 24, 64);
}

let acc=0,last=performance.now();
function loop(now){
  if (state.game_state==='RUN') {
    acc += Math.min(0.25,(now-last)/1000); last=now;
    while (acc>=DT) { updateLogic(); updateCamera(); acc-=DT; }
  } else last=now;
  render();
  requestAnimationFrame(loop);
}

boot();
