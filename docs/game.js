const DT = 1 / 60;
// Experimental only: append #slide-jump-momentum to enable slide-jump carry.
// Opt-in v1.1 keyboard input profile. #m1-controls also includes M1 rope and
// slide-jump physics; the legacy URL and all older experiment hashes are stable.
// Opt-in v1.1 motion timings: 18-tick slide, 9-tick air Dash.
const m1TimingEnabled = () => typeof location !== 'undefined' && location.hash === '#m1-timing';
const M1_SLIDE_FRAMES = 18; // 0.30s, within the 0.25-0.35s spec
const M1_DASH_FRAMES = 9; // 0.15s at fixed 60Hz
const M1_SLIDE_HEIGHT = 1.2; // 40% lower than the 2-unit standing body
const M1_SLIDE_IFRAMES = 6; // 0.10s
// Independent 9-tick jump / spent-Dash-to-slide landing-buffer prototype.
const m1BufferEnabled = () => typeof location !== 'undefined' && (location.hash === '#m1-buffer' || m1TimingEnabled());
const M1_BUFFER_FRAMES = 9;
const m1JumpsEnabled = () => typeof location !== 'undefined' && (location.hash === '#m1-jumps' || m1BufferEnabled());
const m1ControlsEnabled = () => typeof location !== 'undefined' && (location.hash === '#m1-controls' || m1JumpsEnabled());
const m1RopeEnabled = () => typeof location !== 'undefined' && (location.hash === '#m1-swing' || m1ControlsEnabled());
const slideJumpMomentumEnabled = () => typeof location !== 'undefined' && (location.hash === '#slide-jump-momentum' || m1RopeEnabled());
// Opt-in physics prototypes can also be compared separately from the old build.
const grappleMomentumEnabled = () => typeof location !== 'undefined' && (location.hash === '#grapple-momentum' || m1RopeEnabled());
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
  Dash: { down: false, prev: false, just_pressed: false, just_released: false },
  F: { down: false, prev: false, just_pressed: false, just_released: false },
  LMB: { down: false, prev: false, just_pressed: false, just_released: false },
  RMB: { down: false, prev: false, just_pressed: false, just_released: false },
};
let mx = 640; let my = 360;

const gameKeys = new Set(['KeyA','KeyD','KeyS','KeyW','Space','KeyF','KeyJ','KeyK','KeyU','ShiftLeft','ShiftRight']);
window.addEventListener('keydown', (e) => {
  if (gameKeys.has(e.code)) e.preventDefault();
  keyRaw.set(e.code, true);
});
window.addEventListener('keyup', (e) => {
  if (gameKeys.has(e.code)) e.preventDefault();
  keyRaw.set(e.code, false);
});
// A lost keyup must never leave the player moving indefinitely.
function releaseAllInputs() {
  keyRaw.clear();
  // Cached button intents must not execute after Alt+Tab / lost focus.
  if(state?.player?.input_buffer) {
    state.player.input_buffer.jump=0;
    state.player.input_buffer.slide=0;
  }
}
window.addEventListener('blur', releaseAllInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllInputs();
});
window.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  // Pointer events use displayed CSS pixels; aim and grapple use the fixed
  // 1280×720 logical Canvas coordinates.
  mx = Math.round((e.clientX - r.left) * canvas.width / r.width);
  my = Math.round((e.clientY - r.top) * canvas.height / r.height);
});
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) keyRaw.set('Mouse0', true); if (e.button === 2) keyRaw.set('Mouse2', true);});
window.addEventListener('mouseup', (e) => { if (e.button === 0) keyRaw.set('Mouse0', false); if (e.button === 2) keyRaw.set('Mouse2', false);});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const clamp = (x,a,b)=>Math.min(Math.max(x,a),b);
const sign = (x)=>(x>0?1:(x<0?-1:0));
const len = (v)=>Math.hypot(v.x,v.y);
const norm = (v)=>{const l=len(v); return l<=EPS?{x:0,y:0}:{x:v.x/l,y:v.y/l};};
const dot = (a,b)=>a.x*b.x+a.y*b.y;
const idCompare=(a,b)=>{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d;}return x.length-y.length;};
const metricCompare=(a,b,measure)=>{const d=measure(a)-measure(b);return Math.abs(d)<=EPS?idCompare(a.id,b.id):d;};
let attackQueue=null;
// Fixed-duration states live on the 60 Hz grid; rate timers retain section 3.4.
const fixedCountdown=t=>Math.max(0,Math.round(t/DT)-1)*DT;

const aabb = (o)=>({min_x:o.x-o.w/2,max_x:o.x+o.w/2,min_y:o.y-o.h/2,max_y:o.y+o.h/2});
const overlap = (a,b)=>a.min_x<=b.max_x+EPS&&a.max_x>=b.min_x-EPS&&a.min_y<=b.max_y+EPS&&a.max_y>=b.min_y-EPS;
// Collision resolution must require actual penetration: epsilon contacts are not walls.
const penetrates = (a,b)=>Math.min(a.max_x,b.max_x)>Math.max(a.min_x,b.min_x) && Math.min(a.max_y,b.max_y)>Math.max(a.min_y,b.min_y);

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
  const enemies = [...level.enemies].sort((a,b)=>idCompare(a.id,b.id)).map(e=>({ ...e, alive:true, discovered:false, exclaim_t:0, grounded:false, vx:0, vy:0, melee_cd:0, shoot_cd:0 }));
  state = {
    game_state:'RUN',
    player:{x:p.x,y:p.y,vx:0,vy:0,w:1,h:2,facing:p.facing,grounded:false,standing_oneway_id:'',ignore_oneway_id:'',ignore_timer:0,hp:100,st:100,ammo:60,iframe:0,dash_used:false,dash:null,jump_t:0,jump_ascend:false,crouch:false,slide:null,slide_jump:null,melee:null,respawn_lock:0,grapple_inertia:false,jump_extension:null,input_buffer:null},
    boss:{...level.boss, alive:true, hp:420, vx:0, vy:0, grounded:false, active:false, dead:false, death_t:0, phase:'rifle', phase_t:2, shoot_cd:0, shot_count:0, charge_t:0, charge_pending:false, warning_t:0, charge:null},
    rects, enemies, projectiles:[], spawn_seq:0,
    grapple:emptyGrapple(),
    cam:{x:p.x,y:p.y},
    hint:{text:'',t:0},
    boss_mode:false,pending_respawn:false,aim_input_locked:false,checkpoint_inside:'',
    hits:[],
  };
}

function sampleInput() {
  const modern=m1ControlsEnabled();
  const map = {
    A: !!keyRaw.get('KeyA'),
    D: !!keyRaw.get('KeyD'),
    S: !!keyRaw.get('KeyS'),
    Jump: !!keyRaw.get('KeyW') || !!keyRaw.get('Space'),
    Dash: modern && (!!keyRaw.get('ShiftLeft') || !!keyRaw.get('ShiftRight')),
    F: modern ? !!keyRaw.get('KeyJ') : !!keyRaw.get('KeyF'),
    LMB: !!keyRaw.get('Mouse0') || (modern && !!keyRaw.get('KeyK')),
    RMB: !!keyRaw.get('Mouse2') || (modern && !!keyRaw.get('KeyU'))
  };

  for (const k in input) {
    input[k].prev = input[k].down;
    input[k].down = map[k];
    if (state.player.respawn_lock > 0) {
      input[k].prev=false;input[k].down=false;input[k].just_pressed=false;input[k].just_released=false;continue;
    }
    input[k].just_pressed  =  input[k].down && !input[k].prev;
    input[k].just_released = !input[k].down &&  input[k].prev;
  }

  mx = clamp(mx, 0, 1279);
  my = clamp(my, 0, 719);
}

function blockers(includeOneWay=false) {
  return state.rects.filter(r=>['Solid','Wall'].includes(r.type) || (r.type==='Door'&&r.locked) || (includeOneWay&&r.type==='OneWay'));
}
function playerAimDir() {
  if (state.game_state==='WIN' && state.win_aim) return state.win_aim;
  if (state.player.respawn_lock>0 || state.aim_input_locked) return {x:state.player.facing,y:0};
  const mw = { x: state.cam.x - VIEW_HW + (mx / PX_PER_CM), y: state.cam.y + VIEW_HH - (my / PX_PER_CM) };
  const raw = {x:mw.x-state.player.x,y:mw.y-state.player.y};
  if (len(raw)<=EPS) return {x:state.player.facing,y:0};
  return norm(raw);
}

function emptyGrapple() {
  return {mode:'none',head:null,anchor:null,target:null,local:null,stuck_frames:0,end:false};
}
function grapplePulling() {
  const g=state.grapple;
  return !g.end && ['pull','stuck','rope_slack','rope_taut'].includes(g.mode);
}
function endGrapple(reason='') {
  const g=state.grapple,p=state.player;
  if(g.end)return;
  // Momentum can be inherited only from an intentional RMB release in midair.
  // STUCK, target death, respawn and grapple timeout never cause a false launch.
  const carry=grappleMomentumEnabled() && reason==='release' &&
    ['pull','rope_slack','rope_taut'].includes(g.mode) &&
    !p.grounded && p.respawn_lock===0;
  g.end=true;
  p.grapple_inertia=carry;
  if(!carry){p.vx=0;p.vy=0;}
}
function spawnGrapple(aim) {
  const p=state.player;
  const head={x:p.x+aim.x*0.9,y:p.y+aim.y*0.9,w:0.3,h:0.3,vx:aim.x*28,vy:aim.y*28};
  const start={x:head.x,y:head.y};
  const blocked=()=>blockers(true).some(r=>overlap(aabb(head),aabb(r)));
  for (let step=1;blocked() && step<=18;step++) {
    head.x=start.x-aim.x*step*0.05;
    head.y=start.y-aim.y*step*0.05;
  }
  if (blocked()) return false;
  head.origin={x:head.x,y:head.y};
  state.grapple={...emptyGrapple(),mode:'fly',head};
  return true;
}
function refreshGrappleAnchor() {
  const g=state.grapple;
  if (g.local) {
    g.anchor={x:g.target.x+g.local.x,y:g.target.y+g.local.y};
    g.head.x=g.anchor.x; g.head.y=g.anchor.y;
  }
}
// Fixed-length rope constraint: gravity and input change velocity, while the
// rope removes only OUTWARD radial motion. Tangential velocity is preserved.
// Terrain is resolved before/while correcting stretch, so a wall cannot be
// crossed simply by projecting the player to the rope circle.
function moveRopePlayer(input_x,separateBodies=()=>{}) {
  const g=state.grapple,p=state.player;
  refreshGrappleAnchor();
  if(!g.anchor){endGrapple();return;}
  const rope=Math.max(1.25,g.rope_length||1.25);
  const maxSpeed=35;
  p.vx+=input_x*32*DT;
  if(input_x===0)p.vx*=1-0.15*DT;
  p.vy=Math.max(-30,p.vy-180*DT);
  let speed=Math.hypot(p.vx,p.vy);
  if(speed>maxSpeed){p.vx*=maxSpeed/speed;p.vy*=maxSpeed/speed;}
  const startDist=Math.hypot(p.x-g.anchor.x,p.y-g.anchor.y);
  if(startDist>=rope-0.012 && startDist>EPS) {
    const outward=(p.vx*(p.x-g.anchor.x)+p.vy*(p.y-g.anchor.y))/startDist;
    if(outward>0){p.vx-=outward*(p.x-g.anchor.x)/startDist;p.vy-=outward*(p.y-g.anchor.y)/startDist;}
  }
  resolveAxis(p,p.vx*DT,p.vy*DT);
  const rx=p.x-g.anchor.x,ry=p.y-g.anchor.y;
  const dist=Math.hypot(rx,ry);
  if(dist>rope+EPS){
    const excess=dist-rope;
    // Collision-aware correction keeps the tangential component if the wall
    // blocks only the inward correction's horizontal component.
    resolveAxis(p,-rx/dist*excess,-ry/dist*excess);
  }
  const finalR={x:p.x-g.anchor.x,y:p.y-g.anchor.y};
  const finalDist=Math.hypot(finalR.x,finalR.y);
  if(finalDist>=rope-0.02 && finalDist>EPS){
    const outward=dot({x:p.vx,y:p.vy},norm(finalR));
    if(outward>0){const n=norm(finalR);p.vx-=outward*n.x;p.vy-=outward*n.y;}
    g.mode='rope_taut';
  } else g.mode='rope_slack';
  g.tension=Math.max(0,finalDist-(rope-0.02));
  separateBodies();
}
function moveGrapplePlayer(input_x, separateBodies=()=>{}) {
  const g=state.grapple,p=state.player;
  if(m1RopeEnabled() && (g.mode==='rope_slack'||g.mode==='rope_taut')){
    moveRopePlayer(input_x,separateBodies);return;
  }
  refreshGrappleAnchor();
  if (g.mode==='stuck') { p.vx=0; p.vy=0;separateBodies(); return; }
  if (Math.hypot(g.anchor.x-p.x,g.anchor.y-p.y)<=0.8+EPS) { endGrapple();separateBodies(); return; }
  const prev={x:p.x,y:p.y};
  const dir=norm({x:g.anchor.x-prev.x,y:g.anchor.y-prev.y});
  p.vx=dir.x*10+input_x*3; p.vy=dir.y*10;
  resolveAxis(p,p.vx*DT,p.vy*DT);
  separateBodies();
  const advance=dot({x:p.x-prev.x,y:p.y-prev.y},dir);
  g.stuck_frames=advance<=EPS ? g.stuck_frames+1 : 0;
  if (g.stuck_frames>=3) { g.mode='stuck'; p.vx=0; p.vy=0; }
  else if (Math.hypot(g.anchor.x-p.x,g.anchor.y-p.y)<=0.8+EPS) endGrapple();
}
function updateGrapple() {
  const g=state.grapple;
  if (g.end || g.mode==='none') return;
  if (g.mode!=='fly') {
    refreshGrappleAnchor();
    if (g.mode==='pull' && Math.hypot(g.anchor.x-state.player.x,g.anchor.y-state.player.y)<=0.8+EPS) endGrapple();
    return;
  }
  const h=g.head;
  h.x+=h.vx*DT; h.y+=h.vy*DT;
  const characters=[...state.enemies.filter(e=>e.alive),...(state.boss.active&&state.boss.alive&&!state.boss.dead?[state.boss]:[])];
  const groups=[characters,state.rects.filter(r=>r.type==='OneWay'),blockers(false)];
  for (const group of groups) {
    const hits=group.filter(t=>overlap(aabb(h),aabb(t)));
    hits.sort((a,b)=>Math.hypot(a.x-h.x,a.y-h.y)-Math.hypot(b.x-h.x,b.y-h.y) || idCompare(a.id,b.id));
    if (!hits.length) continue;
    const target=hits[0],box=aabb(target);
    g.target=target;
    g.anchor={x:clamp(h.x,box.min_x,box.max_x),y:clamp(h.y,box.min_y,box.max_y)};
    if (group===characters) g.local={x:g.anchor.x-target.x,y:g.anchor.y-target.y};
    const terrainTarget=group!==characters;
    const swing=m1RopeEnabled() && terrainTarget;
    g.mode=swing?'rope_taut':'pull'; h.x=g.anchor.x; h.y=g.anchor.y; h.vx=0; h.vy=0;
    if(swing){
      g.rope_length=Math.max(1.25,Math.hypot(g.anchor.x-state.player.x,g.anchor.y-state.player.y));
      g.tension=0;
      state.player.slide=null; // new movement owner: rope
    }
    state.player.grapple_inertia=false;
    if(m1BufferEnabled() && state.player.input_buffer){state.player.input_buffer.jump=0;state.player.input_buffer.slide=0;}
    // Rope/pull takes ownership from slide-jump, Dash and forced ascent.
    state.player.dash=null;state.player.jump_ascend=false;state.player.slide_jump=null;
    if(state.player.jump_extension)state.player.jump_extension.carry=false;
    if (!swing && Math.hypot(g.anchor.x-state.player.x,g.anchor.y-state.player.y)<=0.8+EPS) endGrapple();
    return;
  }
  // Distance is measured from the final (possibly backtracked) spawn center.
  if (Math.hypot(h.x-h.origin.x,h.y-h.origin.y)>40) endGrapple();
}

function resolveAxis(obj, dx, dy) {
  const prev = {x:obj.x,y:obj.y};
  let collided = false;
  obj.x += dx;
  for (let i=0;i<8;i++) {
    const hits = blockers(false).filter(r=>Math.min(obj.y+obj.h/2,r.y+r.h/2)-Math.max(obj.y-obj.h/2,r.y-r.h/2)>EPS*2 && penetrates(aabb(obj),aabb(r)));
    if (!hits.length) break;
    const sorted=hits.sort((a,b)=>metricCompare(a,b,r=>dx>0?r.x-r.w/2:-(r.x+r.w/2)));
    const o = sorted[0];
    if (dx>0) obj.x = o.x-o.w/2-obj.w/2-EPS; else if (dx<0) obj.x = o.x+o.w/2+obj.w/2+EPS;
    obj.vx=0;
    collided = true;
  }
  if (dx!==0 && blockers(false).some(r=>Math.min(obj.y+obj.h/2,r.y+r.h/2)-Math.max(obj.y-obj.h/2,r.y-r.h/2)>EPS*2 && penetrates(aabb(obj),aabb(r)))) {
    obj.x=prev.x; obj.y=prev.y; obj.vx=0; obj.vy=0;
    return true;
  }
  const preY = obj.y;
  obj.y += dy;
  obj.grounded = false;
  obj.standing_oneway_id = '';
  for (let i=0;i<8;i++) {
    let hits = blockers(false).filter(r=>penetrates(aabb(obj),aabb(r)));
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
    const sorted=hits.sort((a,b)=>metricCompare(a,b,r=>dy>0?r.y-r.h/2:-(r.y+r.h/2)));
    const o = sorted[0];
    if (dy>0) obj.y = o.y-o.h/2-obj.h/2-EPS;
    if (dy<0) {
      obj.y = o.y+o.h/2+obj.h/2+EPS;
      obj.grounded=true;
      if (o.type==='OneWay') obj.standing_oneway_id=o.id;
    }
    obj.vy=0;
    collided = true;
  }
  if (dy!==0 && blockers(false).some(r=>penetrates(aabb(obj),aabb(r)))) {
    obj.x=prev.x; obj.y=prev.y; obj.vx=0; obj.vy=0;
    obj.grounded=false; obj.standing_oneway_id='';
    return true;
  }
  if (obj.y===prev.y && obj.x===prev.x && (dx!==0||dy!==0)) { obj.vx=0; obj.vy=0; }
  return collided;
}

function separation(obj,other) {
  const dx=(obj.w+other.w)/2-Math.abs(obj.x-other.x);
  const dy=(obj.h+other.h)/2-Math.abs(obj.y-other.y);
  const axis=dx<=dy+EPS?'x':'y';
  const direction=obj[axis]>=other[axis]?1:-1;
  return {axis,delta:direction*((axis==='x'?dx:dy)+EPS)};
}
function separateTerrain(obj,limit=8) {
  for(let i=0;i<limit;i++) {
    const hit=blockers().find(r=>penetrates(aabb(obj),aabb(r)));
    if(!hit)return true;
    const move=separation(obj,hit);obj[move.axis]+=move.delta;
    obj[move.axis==='x'?'vx':'vy']=0;
  }
  return !blockers().some(r=>penetrates(aabb(obj),aabb(r)));
}
function separatePlayerBodies() {
  const p=state.player;
  const actors=[...state.enemies.filter(e=>e.alive),...(state.boss.active&&state.boss.alive&&!state.boss.dead?[state.boss]:[])];
  for(const actor of actors) {
    if(!overlap(aabb(p),aabb(actor)))continue;
    const move=separation(p,actor);const direction=p[move.axis]>=actor[move.axis]?1:-1;
    p[move.axis]+=move.delta+direction*EPS;
    const blocked=blockers().some(r=>penetrates(aabb(p),aabb(r)));
    if(blocked) {
      separateTerrain(p,1);
      if(p.dash){p.dash=null;p.vx=0;p.vy=0;}
    }
  }
}
function setPlayerHeight(height) {
  const p=state.player;p.y+=(height-p.h)/2;p.h=height;
}
function canStandPlayer() {
  const p=state.player,standing={...p,h:2,y:p.y-p.h/2+1};
  return !blockers().some(r=>penetrates(aabb(standing),aabb(r)));
}
function finishSlide() {
  const p=state.player;p.slide=null;
  if(!m1BufferEnabled())p.vx=0; // opt-in: carry real slide exit velocity into ground steering
  p.crouch=input.S.down || !canStandPlayer();setPlayerHeight(p.crouch?1:2);
}
function prepareStance(input_x,pulling) {
  const p=state.player;
  if(pulling || p.dash)return;
  if(p.slide)return;
  const bufferedSlide=m1BufferEnabled() && (p.input_buffer?.slide??0)>0;
  const slidePressed=m1ControlsEnabled()?(input.Dash.just_pressed||bufferedSlide):input.S.just_pressed;
  // Buffered jump takes priority over a second, early ground-slide intent.
  if(p.grounded && input_x!==0 && slidePressed &&
     !(m1BufferEnabled() && p.input_buffer.jump>0)) {
    if(bufferedSlide)p.input_buffer.slide=0;
    p.slide={dir:p.facing,t:0,frames:0};p.crouch=false;
    setPlayerHeight(m1TimingEnabled()?M1_SLIDE_HEIGHT:1);
    if(m1TimingEnabled())p.iframe=Math.max(p.iframe,M1_SLIDE_IFRAMES*DT);
    return;
  }
  const crouch=(p.grounded && (m1ControlsEnabled() || input_x===0) && input.S.down) ||
    (p.crouch && input.S.down) || !canStandPlayer();
  p.crouch=crouch;setPlayerHeight(crouch?1:2);
}
function playerDied() {
  const p=state.player;return p.hp<=0 || p.x<-5 || p.x>365 || p.y>20 || p.y<-40;
}

// M1 jump experiment: one free air jump and one wall kick per contacted
// collider face until landing. Dash/grapple never refill these allowances.
// Prototype tuning reuses the existing jump impulse and slide air steering.
function resetM1JumpState() {
  return {air_available:true,walls:[],carry:false,last:'ground'};
}
function m1JumpWall() {
  const p=state.player,b=aabb(p),hits=[];
  for(const r of blockers(false)) {
    const box=aabb(r);
    const vertical=Math.min(b.max_y,box.max_y)-Math.max(b.min_y,box.min_y);
    if(vertical<=0.25)continue; // floors/ceilings and grazing corners are not walls
    for(const [gap,away] of [[box.min_x-b.max_x,-1],[b.min_x-box.max_x,1]]) {
      if(gap>=-EPS && gap<=0.02)hits.push({key:r.id+':'+away,gap,away});
    }
  }
  hits.sort((a,b)=>a.gap-b.gap||idCompare(a.key,b.key));
  return hits[0]||null;
}
function tryM1AirJump(pulling,downThrough) {
  const p=state.player,j=p.jump_extension;
  if(!m1JumpsEnabled() || !j || pulling || downThrough || p.grounded ||
     p.respawn_lock>0 || !input.Jump.just_pressed || !canStandPlayer() ||
     (m1BufferEnabled() && p.input_buffer.jump>0))return false;
  const wall=m1JumpWall();
  if(wall && !j.walls.includes(wall.key)) {
    j.walls.push(wall.key);j.last='wall';p.vx=wall.away*10;p.facing=wall.away;
  } else if(j.air_available) {
    j.air_available=false;j.last='double';
  } else return false;
  // A successful jump takes over Dash but does NOT refund Dash usage.
  // Inherit CURRENT horizontal speed, not any saved slide launch vector.
  p.dash=null;p.slide=null;p.slide_jump=null;p.grapple_inertia=false;
  if(m1BufferEnabled()){p.input_buffer.jump=0;p.input_buffer.slide=0;}
  p.crouch=false;setPlayerHeight(2);p.grounded=false;
  p.vy=53.334;p.jump_ascend=true;p.jump_t=0;j.carry=true;
  return true;
}

// Predict only a downward landing within 9 simulation ticks. Never convert
// a mid-air jump into a delayed ground jump when a valid wall kick is present.
// The platform's top must be crossed, and the player must be supported in X.
function m1LandingSoon() {
  const p=state.player;
  if(p.grounded || p.vy>0 || p.dash || grapplePulling())return false;
  const t=M1_BUFFER_FRAMES*DT;
  const foot=p.y-p.h/2,projected=foot+p.vy*t-90*t*t;
  const projectedX=p.x+p.vx*t;
  return state.rects.some(r=>{
    if(!['Solid','Wall','OneWay'].includes(r.type) && !(r.type==='Door'&&r.locked))return false;
    if(r.type==='OneWay' && p.ignore_oneway_id===r.id)return false;
    const top=r.y+r.h/2;
    const currentX=p.x+p.w/2>r.x-r.w/2 && p.x-p.w/2<r.x+r.w/2;
    const futureX=projectedX+p.w/2>r.x-r.w/2 && projectedX-p.w/2<r.x+r.w/2;
    return (currentX||futureX) && foot>=top+EPS && projected<=top+EPS;
  });
}
function updateLogic() {
  if(state.game_state!=='RUN')return;
  state.aim_input_locked=state.player.respawn_lock>0;
  sampleInput();
  const p=state.player;
  if(m1JumpsEnabled() && (!p.jump_extension || p.grounded))p.jump_extension=resetM1JumpState();
  if(m1BufferEnabled() && !p.input_buffer)p.input_buffer={jump:0,slide:0};
  const priorHint=state.hint;
  p.iframe=Math.max(0,p.iframe-DT);
  p.ignore_timer=fixedCountdown(p.ignore_timer); if (p.ignore_timer<=0){p.ignore_timer=0;p.ignore_oneway_id='';}

  let input_x = (input.A.down?-1:0)+(input.D.down?1:0); if (input.A.down&&input.D.down) input_x=0;
  if (input_x!==0) p.facing=input_x;
  const aim = playerAimDir();

  if(m1BufferEnabled()) {
    // A tap is eligible for the current tick and the next 8 ticks.
    const b=p.input_buffer;
    b.jump=Math.max(0,b.jump-1);
    b.slide=Math.max(0,b.slide-1);
    if(input.Jump.just_pressed && !p.grounded && p.respawn_lock===0 &&
       !grapplePulling() && m1LandingSoon()) {
      const wall=m1JumpWall();
      if(!wall || p.jump_extension.walls.includes(wall.key))b.jump=M1_BUFFER_FRAMES;
    }
    // A second Shift while Dash is already used should arm a ground slide
    // near landing, not consume ST or create another airborne Dash.
    if(input.Dash.just_pressed && !p.grounded && p.dash_used &&
       input_x!==0 && !grapplePulling() && m1LandingSoon())b.slide=M1_BUFFER_FRAMES;
    // S+Jump at a OneWay landing is not a request to auto-bounce upward.
    if(p.grounded && p.standing_oneway_id && input.S.down)b.jump=0;
  }
  if (input.RMB.just_released && state.grapple.mode!=='none') endGrapple('release');
  const pulling=grapplePulling();

  const downThrough = !pulling && p.grounded && p.standing_oneway_id && input.S.down && input.Jump.just_pressed;
  if (downThrough) { p.ignore_oneway_id = p.standing_oneway_id; p.ignore_timer = 0.2; }

  prepareStance(input_x,pulling);
  const bufferedJump=m1BufferEnabled() && p.input_buffer.jump>0;
  let jumpedThisFrame = !pulling && p.grounded &&
    (input.Jump.just_pressed || bufferedJump) && !downThrough && canStandPlayer();
  if (jumpedThisFrame) {
    if(m1BufferEnabled()){p.input_buffer.jump=0;p.input_buffer.slide=0;}
    const slideLaunch=slideJumpMomentumEnabled() && p.slide ? {vx:p.vx,dir:p.slide.dir,t:0} : null;
    p.crouch=false;p.slide=null;p.slide_jump=slideLaunch;setPlayerHeight(2);
    p.vy=53.334; p.jump_ascend=true; p.jump_t=0;
  }
  if(!jumpedThisFrame)jumpedThisFrame=tryM1AirJump(pulling,downThrough);
  if (p.jump_ascend) { p.jump_t+=DT; if (p.jump_t>0.3||p.vy<=0) p.jump_ascend=false; }

  // In the v1.1 profile, a second jump key can NEVER silently become Dash.
  // Shift has one input event and chooses slide on ground or Dash in air.
  const dashPressed=m1ControlsEnabled()?input.Dash.just_pressed:input.Jump.just_pressed;
  if (!jumpedThisFrame && !p.grounded && !p.dash && !pulling && dashPressed && !p.dash_used) {
    if (p.st>=30) { p.st-=30; p.dash_used=true;
      p.dash={dir:aim,left:m1TimingEnabled()?50*DT*M1_DASH_FRAMES:6};
      p.slide_jump=null;p.grapple_inertia=false;
      if(m1JumpsEnabled()){p.jump_extension.carry=false;p.jump_ascend=false;}
      if(m1BufferEnabled()){p.input_buffer.jump=0;p.input_buffer.slide=0;}
      p.vx=0; p.vy=0; }
    else { state.hint={text:'体力不足',t:0.5}; }
  }

  if (input.F.just_pressed && (!p.melee || p.melee.t<=0)) {
    if (p.st>=18) { p.st-=18; p.melee={t:1.0, hit:new Set(), window:0.45}; }
    else state.hint={text:'体力不足',t:0.5};
  }

  if (input.RMB.just_pressed && state.grapple.mode==='none' && spawnGrapple(aim)) {
    // A newly claimed grapple cancels earlier near-landing movement requests.
    if(m1BufferEnabled()){p.input_buffer.jump=0;p.input_buffer.slide=0;}
  }

  if (pulling) {
    moveGrapplePlayer(input_x,separatePlayerBodies);
    if(p.slide) {
      p.slide.t+=DT;
      if(p.slide.t>=0.9 || !p.grounded || p.vx===0){p.slide=null;p.crouch=p.h===1;}
    }
  } else if (p.dash) {
    const activeDash=p.dash;
    const step=Math.min(50*DT,activeDash.left);
    p.vx=activeDash.dir.x*50;p.vy=activeDash.dir.y*50;
    let blocked=false;
    if(m1TimingEnabled()){
      // At 50 units/s the 60Hz frame advances 0.833 units. Break this into
      // <=0.25-unit steps so thin walls and diagonal corners cannot tunnel.
      const dx=activeDash.dir.x*step,dy=activeDash.dir.y*step;
      const slices=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/0.25));
      for(let k=0;k<slices;k++){
        blocked=resolveAxis(p,dx/slices,dy/slices);
        if(blocked)break;
      }
    } else blocked=resolveAxis(p,activeDash.dir.x*step,activeDash.dir.y*step);
    activeDash.left-=step;
    if(activeDash.left<=EPS || blocked || (m1TimingEnabled() && p.grounded)) {
      p.dash=null;
      if(m1TimingEnabled()){
        // Let the collision resolver keep the unblocked tangent component.
        // On a normal dash expiry, inherit a capped exit impulse (8 units/s)
        // rather than stopping dead or resuming stale slide-jump velocity.
        if(!blocked && !p.grounded){
          p.vx=activeDash.dir.x*8;p.vy=activeDash.dir.y*8;
        }
        if(!p.grounded && p.jump_extension)p.jump_extension.carry=true;
        else if(p.jump_extension)p.jump_extension.carry=false;
        if(p.grounded)p.vy=0;
      } else {p.vx=0;p.vy=0;}
    }
  } else {
    if(m1JumpsEnabled() && p.jump_extension?.carry && !p.grounded) {
      if(!jumpedThisFrame) {
        const accel=input_x===0?5:90;
        p.vx+=clamp(input_x*8-p.vx,-accel*DT,accel*DT);
      }
    } else if(p.slide_jump && (jumpedThisFrame || !p.grounded)) {
      // Preserve launch speed on the jump tick. Thereafter steer from CURRENT velocity,
      // so D/A/D changes are acceleration-limited and cannot jump back to the launch vector.
      // Experimental tuning: 90 cm/s^2 directional acceleration, 5 cm/s^2 neutral air drag.
      if(jumpedThisFrame) p.vx=p.slide_jump.vx;
      else {
        p.slide_jump.t+=DT;
        const desired=input_x*8;
        const accel=input_x===0?5:90;
        p.vx+=clamp(desired-p.vx,-accel*DT,accel*DT);
      }
    } else if (p.slide) {
      p.slide.t=(p.slide.frames??Math.round(p.slide.t/DT))*DT;
      if(m1TimingEnabled()){
        // Start fast, leave at running speed instead of braking to zero.
        const progress=clamp((p.slide.frames??0)/(M1_SLIDE_FRAMES-1),0,1);
        p.vx=p.slide.dir*(10-2*progress);
      } else p.vx=p.slide.dir*Math.max(0,10-(10/0.9)*p.slide.t);
    } else if(grappleMomentumEnabled() && p.grapple_inertia && !p.grounded){
      const desired=input_x*8;
      const limit=(input_x===0?5:45)*DT;
      p.vx+=clamp(desired-p.vx,-limit,limit);
    } else if(m1BufferEnabled()) {
      // Velocity is continuous across the airborne/grounded boundary.
      // Ground acceleration / friction are tuned separately from air steering.
      const desired=p.crouch?0:input_x*8;
      // 8/70 = 0.114s to accelerate; neutral ground 8/100 = 0.08s to stop.
      const accel=p.grounded?(input_x!==0?70:(m1TimingEnabled()?100:45)):(input_x!==0?45:5);
      p.vx+=clamp(desired-p.vx,-accel*DT,accel*DT);
    } else p.vx=p.crouch?0:input_x*8;
    if (!p.jump_ascend) p.vy=Math.max(-15,p.vy-180*DT);
    if (p.jump_ascend) p.vy-=177.78*DT;
    const blocked=resolveAxis(p,p.vx*DT,p.vy*DT);
    if(p.slide) {
      p.slide.frames=(p.slide.frames??0)+1;
      if(!p.grounded || p.vx===0 || p.slide.frames>=(m1TimingEnabled()?M1_SLIDE_FRAMES:54))finishSlide();
    }
  }
  if(p.grounded){p.dash_used=false;if(p.slide_jump)p.slide_jump=null;p.grapple_inertia=false;
    if(m1JumpsEnabled())p.jump_extension=resetM1JumpState();
  }
  if(!pulling)separatePlayerBodies();
  updateCamera();
  attackQueue=[];
  updateEnemies();
  updateBoss();
  generateAttacks(playerAimDir());
  updateProjectiles();
  updateGrapple();
  resolveDamage();
  state.pending_respawn=playerDied();
  cleanup();
  postChecks();
  p.st=Math.min(100,p.st+12*DT);
  if(state.hint===priorHint && state.hint.t>0)state.hint.t=fixedCountdown(state.hint.t);
  if(state.hint.t<=0 && state.game_state!=='WIN')state.hint.text='';
  if(state.aim_input_locked && p.respawn_lock>0)p.respawn_lock--;
  if(state.pending_respawn)respawn();
}

function generateAttacks(aim) {
  const queued=attackQueue||[];attackQueue=null;
  const p=state.player;

  if (p.melee) {
    p.melee.t=fixedCountdown(p.melee.t);
    if (p.melee.window>0){
      p.melee.window=fixedCountdown(p.melee.window);
      for (const e of state.enemies.filter(e=>e.alive)) {
        if (p.melee.hit.has(e.id)) continue;
        const to={x:e.x-p.x,y:e.y-p.y};
        if (len(to)<=3.2+EPS && dot(norm(to),aim)>=0.5) {
          state.hits.push({src:'p_melee',id:e.id,damage:80});
          p.melee.hit.add(e.id);
        }
      }
      const b=state.boss;
      if (b.active && b.alive && !b.dead) {
        const to={x:b.x-p.x,y:b.y-p.y};
        if (!p.melee.hit.has('BOSS') && len(to)<=3.2+EPS && dot(norm(to),aim)>=0.5) { state.hits.push({src:'p_melee',id:'BOSS',damage:80}); p.melee.hit.add('BOSS'); }
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
        if (spawnProjectile({x:p.x+aim.x*0.8,y:p.y+aim.y*0.8,vx:aim.x*30,vy:aim.y*30,w:0.25,h:0.1,damage:9,owner:'player'})) p.ammo-=1;
      }
      state.p_fire_cd += interval;
    }
  } else state.p_fire_cd=Math.max(state.p_fire_cd,0);

  for(const pr of queued) {
    if(pr._source){pr.x+=pr._source.x-pr._origin_x;pr.y+=pr._source.y-pr._origin_y;}
    delete pr._source;delete pr._origin_x;delete pr._origin_y;
    spawnProjectile(pr);
  }
}

function spawnProjectile(pr) {
  if(attackQueue) {
    if(pr._source){pr._origin_x=pr._source.x;pr._origin_y=pr._source.y;}
    attackQueue.push(pr);return true;
  }
  delete pr._source;
  // Blueprint 13.4: backtrack at most 0.80 cm in 0.05 cm steps if spawned inside terrain.
  const blocked = () => blockers(true).some(r=>overlap(aabb(pr),aabb(r)));
  if (blocked()) {
    const speed = Math.hypot(pr.vx,pr.vy);
    if (speed<=0) return false;
    const ux=pr.vx/speed, uy=pr.vy/speed;
    let clear=false;
    for (let step=1;step<=16;step++) {
      pr.x-=ux*0.05; pr.y-=uy*0.05;
      if (!blocked()) { clear=true; break; }
    }
    if (!clear) return false;
  }
  pr.age=0; pr.destroyed=false; pr.spawn_seq=state.spawn_seq++;
  state.projectiles.push(pr);
  return true;
}

function sightBlocked(from,to) {
  for (const r of blockers(false)) {
    const a=aabb(r);
    let low=0,high=1,miss=false;
    for (const axis of ['x','y']) {
      const delta=to[axis]-from[axis];
      const lower=a['min_'+axis]-EPS,upper=a['max_'+axis]+EPS;
      if (Math.abs(delta)<=EPS*1e-3) {
        if (from[axis]<lower || from[axis]>upper) {miss=true;break;}
      } else {
        let t0=(lower-from[axis])/delta,t1=(upper-from[axis])/delta;
        if (t0>t1) [t0,t1]=[t1,t0];
        low=Math.max(low,t0);high=Math.min(high,t1);
        if (low>high) {miss=true;break;}
      }
    }
    if (!miss) return true;
  }
  return false;
}

function updateEnemies() {
  const p=state.player;
  const vis={x:state.cam.x,y:state.cam.y,w:32,h:18};
  for (const e of state.enemies.filter(e=>e.alive)) {
    e.vy=Math.max(-15,e.vy-180*DT);
    const inCam = overlap(aabb(e),aabb(vis));
    const discovered=inCam && (e.type==='melee_basic' || !sightBlocked(e,p));
    if (!e.discovered && discovered) e.exclaim_t=0.5;
    e.discovered = discovered;
    e.exclaim_t=Math.max(0,e.exclaim_t-DT);
    if (e.type==='melee_basic') {
      const dir = sign(p.x-e.x)||1;
      e.vx = e.discovered ? dir*5 : 0;
      if(e.grounded) {
        const foot_x=e.x+dir*e.w/2,foot_y=e.y-e.h/2-EPS;
        const support=state.rects.some(r=>['Solid','OneWay'].includes(r.type) &&
          foot_x>=r.x-r.w/2-EPS && foot_x<=r.x+r.w/2+EPS &&
          foot_y>=r.y+r.h/2-EPS && foot_y-0.3<=r.y+r.h/2+EPS);
        if(!support)e.vx=0;
      }
      e.melee_cd-=DT;
      if(e.discovered && Math.hypot(p.x-e.x,p.y-e.y)<=1.2+EPS) {
        while(e.melee_cd<=0){state.hits.push({src:'e_melee',damage:22,to:'player'});e.melee_cd+=1/1.1;}
      } else e.melee_cd=Math.max(0,e.melee_cd);
    } else {
      e.vx=0;
      const R = e.type==='ranged_rifle'?8:0.85;
      const interval=1/R;
      e.shoot_cd-=DT;
      if (e.discovered) {
        while (e.shoot_cd<=0) {
          let dir=norm({x:p.x-e.x,y:p.y-e.y});if(len(dir)<=EPS)dir={x:1,y:0};
          if (e.type==='ranged_rifle') spawnProjectile({x:e.x+dir.x*0.8,y:e.y+dir.y*0.8,vx:dir.x*26,vy:dir.y*26,w:0.22,h:0.1,damage:2,owner:'enemy',_source:e});
          else for (const deg of [-15,-7.5,0,7.5,15]) {
            const a=Math.atan2(dir.y,dir.x)+deg*Math.PI/180; spawnProjectile({x:e.x+Math.cos(a)*0.8,y:e.y+Math.sin(a)*0.8,vx:Math.cos(a)*20,vy:Math.sin(a)*20,w:0.18,h:0.18,damage:4,owner:'enemy',_source:e});
          }
          e.shoot_cd += interval;
        }
      } else e.shoot_cd = Math.max(e.shoot_cd,0);
    }
    resolveAxis(e,e.vx*DT,e.vy*DT);
  }
}

function fireBossVolley(shotgun) {
  const b=state.boss,p=state.player;
  let d=norm({x:p.x-b.x,y:p.y-b.y});
  if (len(d)<=EPS) d={x:1,y:0};
  const angles=shotgun?[-15,-7.5,0,7.5,15]:[0];
  for (const deg of angles) {
    const a=Math.atan2(d.y,d.x)+deg*Math.PI/180;
    const x=Math.cos(a),y=Math.sin(a),speed=shotgun?20:26;
    spawnProjectile({x:b.x+x*0.8,y:b.y+y*0.8,vx:x*speed,vy:y*speed,
      w:shotgun?0.18:0.22,h:shotgun?0.18:0.1,damage:shotgun?4:2,owner:'boss',_source:b});
  }
}

function updateBoss() {
  const b=state.boss,p=state.player;
  if (!b.active || !b.alive || b.dead) return;
  if(b.hp<=210){
    b.charge_frames=(b.charge_frames??Math.round(b.charge_t/DT))+1;
    while(b.charge_frames>=228){b.charge_frames-=228;b.charge_pending=true;}
    b.charge_t=b.charge_frames*DT;
  }
  b.phase_t=fixedCountdown(b.phase_t);
  b.shoot_cd -= DT;
  if (b.phase!=='rifle' && b.phase!=='shotgun') b.shoot_cd=Math.max(0,b.shoot_cd);
  if (b.phase==='rifle') {
    while (b.shoot_cd<=0){fireBossVolley(false);b.shoot_cd+=0.1;}
    if (b.phase_t<=0){b.phase='idleA';b.phase_t=0.5;}
  } else if (b.phase==='idleA' || b.phase==='idleB') {
    const next=b.phase==='idleA'?'shotgun':'rifle';
    if (b.charge_pending) {
      b.charge_next=next;b.phase='warn';b.phase_t=0.2;b.warning_t=0;b.charge_pending=false;
    } else if (b.phase_t<=0) {
      b.phase=next;b.phase_t=next==='rifle'?2:0;b.shot_count=0;
      // The first volley belongs to the tick in which the attack starts.
      fireBossVolley(next==='shotgun');
      b.shoot_cd=next==='rifle'?0.1:0.9;
      if (next==='shotgun') b.shot_count=1;
    }
  } else if (b.phase==='shotgun') {
    while (b.shoot_cd<=0 && b.shot_count<4) {
      fireBossVolley(true);b.shot_count++;b.shoot_cd+=0.9;
    }
    if (b.shot_count>=4){b.phase='idleB';b.phase_t=0.6;}
  } else if (b.phase==='warn') {
    b.warning_t+=DT;
    if (b.phase_t<=0) {b.phase='charge';b.charge={dir:p.x>b.x?1:-1,left:6};}
  }
  if (b.phase==='charge') {
    const step=Math.min(18*DT,b.charge.left);
    b.vx=b.charge.dir*18;b.vy=0;
    const blocked=resolveAxis(b,b.charge.dir*step,0);
    b.charge.left-=step;
    if (overlap(aabb(b),aabb(p))) state.hits.push({src:'boss_charge',to:'player',damage:18});
    if (b.charge.left<=EPS || blocked) {
      b.phase=b.charge_next||'rifle';b.phase_t=b.phase==='rifle'?2:0;
      b.shot_count=0;b.shoot_cd=0;b.charge=null;b.charge_next=null;b.vx=0;b.vy=0;
    }
  } else {b.vy=Math.max(-15,b.vy-180*DT);resolveAxis(b,0,b.vy*DT);}
}

function updateProjectiles() {
  for (const pr of state.projectiles.sort((a,b)=>a.spawn_seq-b.spawn_seq)) {
    if (pr.destroyed) continue;
    pr.x += pr.vx*DT; pr.y += pr.vy*DT;
    if (pr.owner==='player') {
      const ts = [...state.enemies.filter(e=>e.alive), ...(state.boss.active&&state.boss.alive&&!state.boss.dead?[state.boss]:[])].filter(t=>overlap(aabb(pr),aabb(t)));
      if (ts.length){
        ts.sort((a,b)=>Math.hypot(a.x-pr.x,a.y-pr.y)-Math.hypot(b.x-pr.x,b.y-pr.y)||idCompare(a.id,b.id));
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
      else { const e=state.enemies.find(x=>x.id===h.id&&x.alive); if (e) {
        e.hp -= h.damage;
        if (h.src==='p_melee') {
          const before={x:e.x,y:e.y};
          let dir=norm({x:e.x-p.x,y:e.y-p.y});
          if (len(dir)<=EPS) dir={x:p.facing,y:0};
          e.x=before.x+dir.x*0.6; e.y=before.y+dir.y*0.6;
          for (let n=1;n<=12 && blockers(false).some(r=>penetrates(aabb(e),aabb(r)));n++) {
            e.x=before.x+dir.x*(0.6-n*0.05); e.y=before.y+dir.y*(0.6-n*0.05);
          }
          if (blockers(false).some(r=>penetrates(aabb(e),aabb(r)))) Object.assign(e,before);
        }
      } }
    }
  }
  if (maxP>0 && p.iframe<=0) { p.hp -= maxP; p.iframe=0.45; }
  for(const e of state.enemies)if(e.alive && e.hp<=0)e.dead=true;
  const b=state.boss;
  if (b.active && b.alive && !b.dead && b.hp<=0) {
    b.dead=true; b.death_t=0.8; b.death_new=true;
  }
}

function cleanup() {
  state.projectiles = state.pending_respawn?[]:state.projectiles.filter(p=>!p.destroyed);
  for (const e of state.enemies) if (e.alive && e.hp<=0) e.alive=false;
  const b=state.boss;
  if (b.dead) {
    // Logical mode exit is cleanup-owned; camera/door/UI remain for 0.8s.
    state.boss_mode=false;
    if (b.death_new) b.death_new=false;
    else if (b.alive) {
      b.death_t=Math.max(0,b.death_t-DT);
      if (b.death_t<=0) {
        b.alive=false;
        const db=state.rects.find(r=>r.id==='DoorBoss');if (db) db.locked=false;
      }
    }
  }
  const g=state.grapple;
  if (g.local && (!g.target.alive || g.target.dead || g.target.hp<=0)) endGrapple();
  else if(g.local && !g.end) {
    refreshGrappleAnchor();
    if(g.mode!=='stuck' && Math.hypot(g.anchor.x-state.player.x,g.anchor.y-state.player.y)<=0.8+EPS)endGrapple();
  }
  if (g.end) state.grapple=emptyGrapple();
  state.hits = [];
}

function postChecks() {
  const p=state.player;
  const checkpoint=state.rects.find(r=>r.type==='Checkpoint'&&overlap(aabb(p),aabb(r)));
  if(checkpoint && state.checkpoint_inside!==checkpoint.id)state.hint={text:'检查点',t:0.8};
  state.checkpoint_inside=checkpoint?checkpoint.id:'';
  const trig = state.rects.find(r=>r.type==='Trigger'&&r.kind==='BossTrigger');
  if (trig && overlap(aabb(p),aabb(trig)) && !state.boss.active) {
    const db=state.rects.find(r=>r.id==='DoorBoss'); if (db) db.locked=true;
    state.boss.active=true; state.boss_mode=true;
    state.cam.x=clamp(state.cam.x,286,314);state.cam.y=clamp(state.cam.y,-21,-9);
  }
  const aliveNormals = state.enemies.some(e=>e.alive);
  if (!aliveNormals && !state.boss.alive) {
    const ex=state.rects.find(r=>r.id==='DoorExit'); if (ex && ex.locked){ex.locked=false; state.hint={text:'出口解锁',t:1.0};}
  }
  const goal=state.rects.find(r=>r.type==='Trigger'&&r.kind==='Goal');
  const ex=state.rects.find(r=>r.id==='DoorExit');
  if (!state.pending_respawn && goal && ex && !ex.locked && overlap(aabb(p),aabb(goal))) { state.win_aim=playerAimDir();state.game_state='WIN'; state.hint={text:'通关',t:99999}; }

}

function respawn() {
  state.grapple=emptyGrapple();
  const cp=state.rects.filter(r=>r.type==='Checkpoint').sort((a,b)=>Math.hypot(state.player.x-a.x,state.player.y-a.y)-Math.hypot(state.player.x-b.x,state.player.y-b.y))[0];
  const fallback=state.rects.find(r=>r.id==='CP0');
  const p=state.player;
  Object.assign(p,{vx:0,vy:0,w:1,h:2,hp:100,st:100,ammo:60,dash_used:false,dash:null,
    grounded:false,standing_oneway_id:'',iframe:0,ignore_oneway_id:'',ignore_timer:0,
    jump_ascend:false,jump_t:0,slide:null,slide_jump:null,crouch:false,melee:null,respawn_lock:1,grapple_inertia:false,jump_extension:null,input_buffer:null});
  function place(point) {
    p.x=point?.respawn_x??level.player_spawn.x;p.y=point?.respawn_y??level.player_spawn.y;
    p.facing=point?.respawn_facing??level.player_spawn.facing;
    return separateTerrain(p,8);
  }
  if(state.boss_mode) {
    state.boss_mode=false;
    const db=state.rects.find(r=>r.id==='DoorBoss');if(db)db.locked=false;
    Object.assign(state.boss,{active:false,phase:'rifle',phase_t:2,charge_pending:false,charge_t:0,charge_frames:0,
      charge:null,charge_next:null,warning_t:0,shot_count:0,shoot_cd:0,vx:0,vy:0});
  }
  if(!place(cp) && !place(fallback)) {p.x=level.player_spawn.x;p.y=level.player_spawn.y;p.facing=level.player_spawn.facing;}
  p.vx=0;p.vy=0;
  // In normal ticks all projectiles were already removed by cleanup.
  if(state.projectiles.length) {state.pending_respawn=true;cleanup();}
  state.pending_respawn=false;state.p_fire_cd=0;state.hint={text:'',t:0};state.checkpoint_inside='';
  state.cam.x=clamp(state.cam.x,16,344);state.cam.y=clamp(state.cam.y,-21,1);
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
  if (state.boss_mode || state.boss.dead && state.boss.alive){nx=clamp(nx,286,314);ny=clamp(ny,-21,-9);} else {nx=clamp(nx,16,344);ny=clamp(ny,-21,1);}
  state.cam.x=nx;state.cam.y=ny;
}

function render() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const toScreen=(x,y)=>({x:(x-(state.cam.x-VIEW_HW))*PX_PER_CM,y:(state.cam.y+VIEW_HH-y)*PX_PER_CM});
  const drawRect=(o,c)=>{const s=toScreen(o.x,o.y);ctx.fillStyle=c;ctx.strokeStyle='#000';ctx.lineWidth=2;ctx.fillRect(s.x-o.w*PX_PER_CM/2,s.y-o.h*PX_PER_CM/2,o.w*PX_PER_CM,o.h*PX_PER_CM);ctx.strokeRect(s.x-o.w*PX_PER_CM/2,s.y-o.h*PX_PER_CM/2,o.w*PX_PER_CM,o.h*PX_PER_CM);};
  for (const r of state.rects) {
    if(!['Solid','Wall','OneWay','Door'].includes(r.type))continue;
    if (r.type==='Door'&&!r.locked) continue;
    drawRect(r,r.type==='OneWay'?'rgba(120,200,120,1)':r.type==='Door'?'rgba(200,140,80,1)':'rgba(120,120,120,1)');
  }
  for (const e of state.enemies.filter(e=>e.alive)) drawRect(e,e.type==='melee_basic'?'rgba(255,120,120,0.8627450980392157)':e.type==='ranged_rifle'?'rgba(255,170,80,0.8627450980392157)':'rgba(180,120,255,0.8627450980392157)');
  const b=state.boss;
  const bossVisible=b.phase!=='warn' || Math.floor((b.warning_t+0.15)/0.25)%2===0;
  if (b.active && b.alive && !b.dead && bossVisible) drawRect(b,'rgba(255,200,80,0.8627450980392157)');
  for (const p of state.projectiles) drawRect(p,p.owner==='player'?'rgba(235,235,235,1)':(p.w<0.2?'rgba(220,180,255,1)':'rgba(255,240,160,1)'));
  drawRect(state.player,'rgba(80,180,255,0.8627450980392157)');
  const g=state.grapple;
  if (g.head && !g.end) {
    const from=toScreen(state.player.x,state.player.y),to=toScreen(g.head.x,g.head.y);
    ctx.strokeStyle='rgba(160,160,160,1)';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(from.x,from.y);
    if(m1RopeEnabled() && g.mode==='rope_slack'){
      const sag=clamp((g.rope_length-Math.hypot(g.anchor.x-state.player.x,g.anchor.y-state.player.y))*PX_PER_CM*0.6+8,8,42);
      ctx.quadraticCurveTo((from.x+to.x)/2,(from.y+to.y)/2+sag,to.x,to.y);
    } else ctx.lineTo(to.x,to.y);
    ctx.stroke();
    drawRect(g.head,'rgba(160,160,160,1)');
  }
  ctx.font='20px sans-serif';
  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.exclaim_t<=0) continue;
    const pos=toScreen(enemy.x,enemy.y+enemy.h/2);
    ctx.fillStyle='white';ctx.fillText('!',Math.round(pos.x),Math.round(pos.y-12));
  }
  const aim=playerAimDir();
  const s=toScreen(state.player.x,state.player.y), e=toScreen(state.player.x+aim.x*2,state.player.y+aim.y*2);
  ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(e.x,e.y);ctx.stroke();
  const fx=Math.round(s.x+state.player.facing*(state.player.w*PX_PER_CM/2+4)),fy=Math.round(s.y);
  ctx.fillStyle='rgba(80,180,255,0.8627450980392157)';ctx.strokeStyle='#000';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(fx+state.player.facing*4,fy);ctx.lineTo(fx-state.player.facing*4,fy-4);ctx.lineTo(fx-state.player.facing*4,fy+4);ctx.closePath();ctx.fill();ctx.stroke();

  ctx.fillStyle='white'; ctx.font='20px sans-serif';
  ctx.fillText(`HP ${Math.round(state.player.hp)} ST ${Math.round(state.player.st)} AMMO ${state.player.ammo}`, 24, 32);
  if (state.hint.text && state.hint.t>0) ctx.fillText(state.hint.text, 24, 64);
  if (state.boss.active && state.boss.alive) ctx.fillText(`BOSS HP ${Math.max(0,Math.round(state.boss.hp))}/420`,24,96);
}

let acc=0,last=performance.now();
function loop(now){
  if (state.game_state==='RUN') {
    acc += Math.min(0.25,(now-last)/1000); last=now;
    while (acc>=DT && state.game_state==='RUN') { updateLogic(); acc-=DT; }
  } else last=now;
  render();
  requestAnimationFrame(loop);
}

boot();
