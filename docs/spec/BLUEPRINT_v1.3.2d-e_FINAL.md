蓝图 v1.3.2d-e-web FINAL（CLOSED-ALL｜NO-DEVIATION｜零自由发挥｜唯一规范）
未写即禁止/不发生。本文为唯一实现与验收标准。
1.	总则（最高优先级）
0.1 本文为唯一规范；任何未写明行为一律视为禁止/不发生。
0.2 零自由发挥：不得擅自更改任何数值、判定、边界条件、优先级、更新顺序、容错策略、默认值、视觉/UI/音频表现。
0.3 确定性：同一输入序列（含鼠标位置序列）必须得到完全一致输出（位置/速度/状态/HP/ST/AMMO/门锁/镜头/事件日志）。
0.4 逻辑固定 60FPS：dt = 1/60；禁止用可变 dt 直接驱动物理、计时和冷却。
2.	运行环境与仓库结构（GitHub 锁死）
1.1 运行平台：浏览器（GitHub Pages）。
1.2 分辨率固定：1280×720。
1.3 单位：cm；换算：PX_PER_CM = 40。
1.4 强制路径与语义（缺失即不合格）：
docs/index.html（入口）
docs/game.js（主循环入口；可 import 其他模块，但最终行为必须与本文完全一致）
docs/level_train_v1.json（训练关数据；其内容必须与本文 22.5 字面完全一致）
docs/balance_v1_3_2d.json（可以不读取；若读取，数值必须与本文一致）
1.5 禁止依赖第三方物理/碰撞引擎替代本文 AABB/分轴解算（必须按本文算法实现）。
3.	坐标系与鼠标映射（强制）
2.1 世界坐标：X 向右为正，Y 向上为正（逻辑一律使用世界坐标）。
2.2 Canvas 像素坐标：左上(0,0)，向右/向下为正（仅渲染用）。
2.3 所有动态对象 position = AABB 中心点（Player/Enemy/Boss/Projectile/GrappleHead）。
2.4 鼠标像素坐标边界（强制）
每帧使用“最近一次收到的鼠标位置”作为整数 (mx,my)。
若鼠标在 canvas 外：将 (mx,my) clamp 到 [0,1279] × [0,719]。
若游戏启动后尚未收到鼠标移动事件：初始化 (mx,my)=(640,360)。
2.5 鼠标像素 → 世界坐标（唯一公式）
定义：
VIEW_W_CM=32, VIEW_H_CM=18
VIEW_HW=16, VIEW_HH=9
摄像机中心 cam=(cam_x,cam_y)（cm）
则：
mouse_world_x = cam_x - VIEW_HW + (mx / PX_PER_CM)
mouse_world_y = cam_y + VIEW_HH - (my / PX_PER_CM)
3.	时间推进与 RateTimer（强制）
3.1 固定步长：dt = 1/60。
3.2 渲染可变，但逻辑必须 accumulator 固定步推进（禁止用 render dt 直接推进）。
3.3 所有计时/冷却/频率内部必须用双精度浮点（JS number），以“秒”累计。
3.4 RateTimer（所有“每秒 R 次”行为唯一算法）
适用：玩家连射、敌射击、敌近战触发、Boss 步枪段射击、Boss 霰弹段触发。
每个行为有 cd（秒），初始 cd=0（可立即触发）。
每帧：
(1) cd = cd - dt
(2) 若本帧允许触发条件=true：
interval = 1 / R
while cd <= 0:
触发一次
cd = cd + interval
(3) 若本帧允许触发条件=false：
cd = max(cd, 0)（禁止在不允许触发时攒负冷却）
4.	数学、AABB、eps（工程歧义锁死）
4.1 AABB 由中心 (x,y) 与尺寸 (w,h) 定义；半尺寸 hw=w/2, hh=h/2：
min=(x-hw, y-hh)
max=(x+hw, y+hh)
4.2 全局 epsilon：eps = 0.001 cm（唯一）。
4.3 重叠判定（闭区间 + eps）：
overlap_x = (a.min_x <= b.max_x + eps) AND (a.max_x >= b.min_x - eps)
overlap_y = (a.min_y <= b.max_y + eps) AND (a.max_y >= b.min_y - eps)
overlap = overlap_x AND overlap_y
4.4 辅助定义（唯一）
clamp(x,a,b)=min(max(x,a),b)
sign(x)=(x>0)?1:(x<0)?-1:0
dot(u,v)=u.xv.x+u.yv.y
len(v)=sqrt(v.x^2+v.y^2)
dist(a,b)=len(b-a)
normalize(v)：若 len(v) <= eps 返回 (0,0)，否则 v/len(v)
4.5 字典序（tie-break）定义
“id 字典序最小” = 按 JS 字符串 Unicode code point 顺序比较的字典序。
5.	输入定义（强制）
5.1 键位锁死：
A/D：左右
S：蹲/滑
W 或 Space：跳 / 空中 Dash（同键）
F：近战
LMB 按住：连射
RMB 按住：钩爪
5.2 输入状态定义（唯一）：
down：本帧按住
just_pressed：本帧 down=true 且上一帧 down=false
just_released：本帧 down=false 且上一帧 down=true
5.3 触发型动作输入绑定（锁死）：
跳 / Dash：Jump.just_pressed（W 或 Space）
下穿：S.down == true 且 Jump.just_pressed == true
滑：S.just_pressed
近战：F.just_pressed
5.4 输入冲突：
A 与 D 同时按：input_x=0；Facing 保持最近一次 input_x != 0 的方向
启动时 Facing = player_spawn.facing
6.	运动积分（强制）
6.1 除“位移覆盖态”（Dash / Boss 冲撞）外，运动积分使用半隐式欧拉：
v = v + adt
pos = pos + vdt
6.2 位移覆盖态（Dash / Boss 冲撞）：
使用恒速位移推进；若途中发生阻挡碰撞修正 → 立即结束，剩余位移作废；
结束当刻设 vx=0,vy=0；本帧剩余时间丢弃（下一帧回普通物理）。
7.	地形类型、Door 语义、阻挡/遮挡集合（强制）
7.1 地形 type：Solid / Wall / OneWay / Door / Trigger / Checkpoint / Goal。
7.2 Door 运行时布尔 locked：初始化 locked=locked_initially。
locked=true：Door 视为 Wall（阻挡 + 遮挡）
locked=false：Door 视为不存在（不阻挡、不遮挡、投射物也不与其碰撞）
7.3 阻挡集合（角色）：Solid、Wall、Door(locked=true)
7.4 投射物阻挡集合：Solid、Wall、Door(locked=true)、OneWay（命中 OneWay 也消失）
7.5 视线遮挡集合：Solid、Wall、Door(locked=true)（OneWay/Trigger/Checkpoint/Goal/角色均不遮挡）
8.	地形碰撞解算（分轴｜核心锁死）
8.1 适用对象：Player/Enemy/Boss/Projectile/GrappleHead（凡与阻挡集合交互者）。
8.2 分轴顺序固定：先 X 后 Y。
8.3 “最先阻挡”选择规则（唯一）：
dx>0：选 corrected_x 最小者
dx<0：选 corrected_x 最大者
Y 同理
若 corrected 值相等（差≤eps）：取障碍 id 字典序最小者
8.4 “刚好不重叠”修正（使用 eps，且会置零速度）：
X 轴：
dx>0：pos.x = obstacle.min_x - mover_hw - eps 且 vx=0
dx<0：pos.x = obstacle.max_x + mover_hw + eps 且 vx=0
Y 轴：
顶头（dy>0）：pos.y = obstacle.min_y - mover_hh - eps 且 vy=0
落地（dy<0）：pos.y = obstacle.max_y + mover_hh + eps 且 vy=0
8.5 单轴修正后仍重叠：重复修正，最多 8 次；超过 8 次：回退到移动前位置并将 vx=0,vy=0。
8.6 grounded 与 standing_oneway_id（唯一）
完成 Y 轴碰撞解算后：
若发生落地修正（dy<0），且落地障碍属于 Solid/Wall/Door(locked=true) 或满足第9章的 OneWay 顶面阻挡：
grounded=true
否则 grounded=false
若落地障碍是 OneWay：standing_oneway_id=that.id；否则 standing_oneway_id=""
OneWay 顶面阻挡在判定上视为 Y 轴向下落地的一种，
因此当角色自上而下落至 OneWay 顶面并被阻挡时，
grounded 必须被判定为 true；
除此情况外，OneWay 不得影响 grounded 判定。
9.	OneWay（单向平台｜下穿闭合）
9.1 OneWay 仅在“从上向下穿越顶面”时阻挡，必须同时满足：
本帧 vy < 0
prev_bottom >= top + eps
curr_bottom <= top + eps
且 X 方向与平台 AABB 重叠
成立则：按第8章落地修正到顶面并设 vy=0，并判定 grounded。
9.2 prev_bottom / curr_bottom 的唯一取值（闭合）：
OneWay 判定发生在 Y 轴移动阶段
prev_bottom = 本帧 Y 轴移动前（已完成 X 轴修正后）的底边
curr_bottom = 本帧 Y 轴移动后（未修正前）的底边
9.3 从下向上：OneWay 永不阻挡（无论是否重叠）。
9.4 下穿（唯一实现）：
条件：grounded==true 且 standing_oneway_id != "" 且 S.down==true 且 Jump.just_pressed==true
结果：触发下穿，不触发跳；并进入忽略该 OneWay 0.20s：
ignore_oneway_id = standing_oneway_id
ignore_timer = 0.20
每帧：ignore_timer -= dt；若 ignore_timer <= 0 → ignore_oneway_id=""
9.5 OneWay “爬行/匍匐”闭合：
不存在任何匍匐/爬行移动。
CROUCH 状态下水平速度规则仍为 11.1，但 12.1 限制导致 CROUCH 不能移动。
10.	玩家基础（LOCKED）
10.1 数值：HP=100/100，ST=100/100，AMMO=60/60。
10.2 ST 回复：+12/s，执行时机固定在每帧逻辑末尾（在伤害结算、清理、门/通关检查后）：
ST = min(100, ST + 12*dt)
10.3 AABB：
站立：1.0×2.0
蹲/滑：1.0×1.0
10.4 Facing：仅由 A/D 的 input_x 决定。
10.5 Aim_dir（唯一）：
Aim_raw = mouse_world - player_center
若 len(Aim_raw) <= eps：Aim_dir = Facing_dir（(Facing,0)）
否则 Aim_dir = normalize(Aim_raw)
10.6 iFrame（受击无位移闭合）：
iframe_timer 初始 0
每帧逻辑步开始执行：iframe_timer = max(0, iframe_timer - dt)
若 iframe_timer > 0：玩家免伤、免击退、免受击位移（本游戏任何来源都不存在受击位移）
但敌方投射物若命中成立仍必须消失（见 21.3）
10.7 死亡条件：
HP ≤ 0，或进入死亡边界（18.1）
11.	玩家移动（LOCKED）
11.1 水平速度（瞬时设定，无加速度）：
A：vx=-8
D：vx=+8
无输入或 A+D：vx=0
11.2 垂直加速度默认值（闭合）：
非 JumpAscend、非 Dash、非 Grapple 拉拽时：ay=-180（无论 grounded 与否都计算；grounded 由碰撞把 vy 归零）
11.3 跳跃（固定高度，松键无效）：
触发：grounded==true 且 Jump.just_pressed==true 且未触发下穿
同帧设：vy = +53.334
JumpAscend：持续 ≤0.30s 或 vy<=0 先到；期间 ay=-177.78（不叠加重力）
结束后回到 11.2，且 vy >= -15（下落封顶）
11.4 跳键优先级：
站在 OneWay 顶面且同帧 S.down + Jump.just_pressed → 下穿，不跳。
12.	姿态与机动（LOCKED）
12.1 蹲（CROUCH）：
条件：grounded==true 且 vx==0 且 S.down==true
松开 S：若可站则站立，否则保持 CROUCH
可站定义：用站立 AABB 与阻挡集合（Solid/Wall/Door locked）做 overlap；若任何 overlap → 不可站
12.2 滑（SLIDE）：
条件：grounded==true 且 vx!=0 且 S.just_pressed==true
进入瞬间：slide_dir = Facing；slide_speed = 10
持续 0.9s 匀减速到 0：slide_speed = max(0, 10 - (10/0.9)*elapsed)
滑行速度：vx = slide_dir * slide_speed
期间不可转向；撞墙或离地立即结束
结束：仍按 S → CROUCH，否则尝试站立（顶头则 CROUCH）
12.3 空中 Dash（Jump.just_pressed）：
条件：grounded==false；不在 Grapple 拉拽/卡住；每次离地仅一次；Jump.just_pressed==true；ST≥30
ST<30：Dash 不发生，不消耗次数，提示“体力不足”0.5s
方向：Aim_dir（Aim=0 用 Facing_dir）
总位移 6cm，时长 0.12s，恒速 50cm/s
Dash 期间：不施加重力；不允许输入改方向
碰撞：仅 Solid/Wall/Door(locked) 阻挡；一旦发生修正 → Dash 立即结束，剩余位移作废
与 OneWay：从上方接触顶面阻挡；从下方穿过不阻挡
成功触发：ST -= 30，标记本次离地 Dash 已用；当 grounded 重新变 true 时复位为未用
Dash 结束闭合：结束当刻设 vx=0,vy=0，本帧剩余时间丢弃
13.	战斗系统（近战/远程/投射物｜硬直=无）
13.1 近战（F）
触发：F.just_pressed 且 ST≥18 且玩家不在近战后摇
ST<18：不发生、不进冷却；提示“体力不足”0.5s
消耗：ST -= 18
时序：判定期 0.45s + 后摇 0.55s（总 1.0s）
判定：判定期内每帧检查一次；同一敌同一次挥砍最多命中一次；一次挥砍可命中多个敌
几何：半径 3.2cm；夹角 120°（半角 60°）；边界包含
to = enemy_center - player_center
若 len(to) > 3.2 + eps → 不命中
否则 dot(normalize(to), Aim_dir_or_Facing) >= 0.5 → 命中
伤害：80
击退（闭合）
仅对普通敌（Enemy）生效；Boss 不击退
击退位移：敌沿远离玩家方向瞬移 0.6cm
若 len(enemy_center-player_center)<=eps：击退方向用 Facing_dir
击退只改位置，不改敌 vx/vy，不产生硬直，不改变敌AI节奏/冷却
若击退后敌与阻挡集合重叠：按 13.3 回退
13.2 远程（LMB 按住连射）
射速：10/s（RateTimer，R=10）
方向：Aim_dir（Aim=0 用 Facing_dir）
AMMO：每发 -1；AMMO=0 禁射并提示“弹药不足”0.6s
玩家子弹：AABB 0.25×0.10；速度 30；伤害 9
出生点：player_center + Aim_dir*0.8
第 1 帧忽略“子弹 vs 玩家AABB”（只忽略自己）
出生点卡墙：按 13.4；若最终不生成：不耗 AMMO，但仍消耗一次发射机会并进入射速冷却
命中优先级：先判 Enemy/Boss，再判地形；命中后子弹消失
13.3 击退回退（近战专用）
若击退后敌与地形（Solid/Wall/Door locked）重叠：
沿击退反方向每步 0.05cm 回退，最多 0.60cm
仍重叠 → 回到击退前位置（伤害仍生效）
13.4 投射物出生点卡墙（玩家/敌/Boss 共用）
定义“出生点在地形内部”：
将投射物 AABB 放在出生点中心，与投射物阻挡集合做 overlap（4.3）
若在内部：
沿反方向每步 0.05cm 回退，最多 0.80cm
仍在内部 → 本次不生成投射物
不生成投射物的后果：
玩家：不耗 AMMO，但进入射速冷却
敌/Boss：仍进入该次射击冷却
13.5 投射物更新与命中（唯一）
字段：pos, vel, w, h, damage, owner, age_frames, spawn_seq
生成当帧即更新：生成当帧参与移动与碰撞；该帧 age_frames==0
每帧顺序：
(1) pos = pos + vel*dt
(2) 先判命中目标
(3) 再判命中地形
(4) 再判越界销毁
目标命中：
玩家子弹：只命中 Enemy 与 Boss
敌/Boss 子弹：只命中 Player
同一投射物同时 overlap 多个 Enemy：取 dist 最小；仍相同取 enemy.id 字典序最小
命中成立后记录命中事件并标记 destroyed；本帧后续不再参与地形判断
硬直闭合：
子弹命中任何对象：不产生硬直、不改变被命中者 vx/vy、不改变其状态机（仅扣血与 iFrame 逻辑）
14.	钩爪（RMB 按住｜LOCKED）
14.1 场上最多 1 个 GrappleHead；AABB 0.30×0.30。
14.2 Aim_dir 同玩家；Aim=0 用 Facing_dir。
14.3 触发与结束（闭合）
RMB.just_pressed 且当前无钩爪（无头/无拉拽/无卡住）→ 尝试生成 GrappleHead
RMB.just_released：无论飞行/拉拽/卡住，立即结束钩爪（头消失，状态清零）
14.4 出生点：player_center + Aim_dir*0.9；第1帧忽略“钩爪头 vs 玩家AABB”。
14.5 钩爪出生点卡墙（仅钩爪用，参数不同）
若出生点在地形内部（Solid/Wall/Door locked/OneWay）：沿 -Aim_dir 每步 0.05cm 回退，最多 0.90cm
仍在内部：本次不生成钩爪；无冷却、无资源消耗
14.6 飞行：速度 28；最大距离 40（头中心与最终出生点中心直线距离）。超距未命中 → 结束。
14.7 命中对象：Solid / Wall / Door(locked) / OneWay / Enemy / Boss。
14.8 命中优先级（同帧同时 overlap）
Enemy/Boss > OneWay > Solid/Wall/Door
同优先级多目标：dist(head_center, target_center) 最小；仍相同取 id 字典序最小
14.9 锚点
anchor = clamp(头中心到目标AABB最近点)
若目标为 Enemy/Boss：记录 anchor_local = anchor - target_center；之后每帧 anchor = target_center + anchor_local
14.10 拉拽（速度覆盖态）
pull_dir = normalize(anchor - player_center)
v_pull = pull_dir * 10
v_adjust = (input_x * 3, 0)
v_final = v_pull + v_adjust
拉拽期间：允许攻击；禁止跳与Dash；不施加重力（玩家速度直接取 v_final，再进 8 碰撞）
14.11 卡住 GRAPPLE_STUCK
连续 3 帧出现“朝锚点方向位移为0”则进入 STUCK
判定：
prev_pos=本帧移动前玩家中心；pos=碰撞解算后玩家中心
pull_dir=normalize(anchor - prev_pos)
advance = dot(pos-prev_pos, pull_dir)
advance <= eps 计 1 次
STUCK：每帧强制 vx=0,vy=0（不移动）；仍可攻击；A/D 仅用于更新 Facing；仍禁止跳与Dash
14.12 结束
非 STUCK：dist(player_center, anchor) <= 0.8 + eps 或 RMB 松开 → 结束
STUCK：仅 RMB 松开可结束
若锚定目标 Enemy/Boss 本帧死亡并被移除：钩爪立即结束
15.	敌人（Enemies｜LOCKED，追击细节闭合）
15.1 通用物理
ay=-180；vy>=-15（封顶）
碰撞：同 8（先X后Y）
无 iFrame
AABB：melee_basic=1.0×1.6；ranged_rifle/ranged_shotgun=1.2×1.2
身体接触不伤人（伤害只来自：近战触发/投射物/Boss冲撞）
15.2 发现与遮挡（闭合）
摄像机可视矩形：AABB(center=cam, w=32, h=18)；与敌AABB overlap 用 4.3
ranged_rifle / ranged_shotgun 发现条件（必须同时满足）：
(1) 敌AABB与可视矩形 overlap
(2) enemy_center→player_center 线段无遮挡（遮挡集合 7.5，算法 17）
melee_basic 发现条件例外：仅要求(1)，不做射线遮挡
发现瞬间（false→true）显示“！”0.5s
遮挡时远程敌停止射击：发现条件不成立时，允许触发条件=false（RateTimer 按 3.4 钳 cd）
15.3 melee_basic（近战兵）
HP=110
追击速度 5
攻击频率 1.1/s（RateTimer R=1.1）
伤害 22
追击仅在 discovered==true：
discovered==false → vx=0
discovered==true → dir=sign(player.x-enemy.x)；若 dir==0 → dir=+1；默认 vx=dir*5
边缘检测（闭合）
仅当敌 grounded==true 才做：
foot_x = enemy.x + dir*enemy_hw
foot_y = enemy_bottom - eps
在区间 [foot_y, foot_y-0.3] 内检查是否存在可承接地面顶面：
Solid 顶面 top = solid.max_y
OneWay 顶面 top = oneway.max_y
可承接判定：foot_x 位于地面 [min_x,max_x]（含 eps），且 foot_y >= top 且 foot_y-0.3 <= top（含 eps）
若不存在可承接地面 → 本帧 vx=0
近战触发（闭合）
条件：discovered==true 且 dist(enemy_center, player_center) <= 1.2 + eps 且 RateTimer 触发一次
命中：若玩家 iframe_timer==0 扣 22 并设 iframe_timer=0.45；若 iframe>0 不扣血但触发仍消耗
15.4 ranged_rifle（步枪兵）
HP=95；射速 8/s（RateTimer R=8）
单发伤 2；弹速 26
子弹 AABB 0.22×0.10
fire_dir = normalize(player_center - enemy_center)，长度0则(1,0)
出生点 enemy_center + fire_dir*0.8
出生点卡墙：13.4；失败仍进入该次射击冷却
水平移动闭合：vx=0 恒定（不走位）
15.5 ranged_shotgun（霰弹兵）
HP=105；射速 0.85/s（RateTimer R=0.85）
每次 5 颗；相对 fire_dir 角度：-15°,-7.5°,0,+7.5°,+15°
单颗伤 4；弹速 20
颗粒 AABB 0.18×0.18
出生点/卡墙/命中同 15.4
水平移动闭合：vx=0 恒定
16.	Boss（boss_v1｜LOCKED）
16.1 AABB 2.6×2.6；HP=420；二阶段阈值=210。
16.2 物理同敌：ay=-180；vy>=-15；碰撞同 8。
16.3 初始 INACTIVE；TR_BOSS 触发后 ACTIVE。
16.4 预警闪烁（唯一波形）
进入预警后计时 t_warn 从 0 累计
visible = ( floor((t_warn + 0.15)/0.25) % 2 == 0 )
仅影响 Boss 本体渲染，不影响碰撞/命中
16.5 Boss 投射物尺寸与卡墙
步枪：0.22×0.10，伤2，速26
霰弹：0.18×0.18，伤4，速20
fire_dir/出生点同 15.4；卡墙同 13.4
16.6 阶段1循环（无限）
步枪段 2.0s：10/s（RateTimer R=10）
停 0.5s
霰弹段：4 连（首发立即，之后每 0.9s 一次，共4次）
停 0.6s
16.7 阶段2插入冲撞
在阶段1循环基础上，每 3.8s 插入一次冲撞（优先插入停顿段）
进入阶段2后 charge_timer 从0累计；每帧 charge_timer += dt
若 charge_timer >= 3.8：反复 charge_timer -= 3.8 并置 charge_pending=true
仅当处于停0.5或停0.6段且 charge_pending=true：立即进入预警0.2s，然后冲撞；该停顿段剩余时间作废；冲撞后进入下一个攻击段；charge_pending=false
16.8 冲撞（位移覆盖态，闭合）
冲撞方向仅水平：player.x > boss.x → (+1,0) 否则 (-1,0)
速度 18；目标位移 6；期间 vy=0 且不施加重力
碰撞：仅 Solid/Wall/Door(locked)；发生修正 → 立即结束，剩余位移作废；结束当刻设 vx=0,vy=0，本帧剩余时间丢弃
命中玩家：冲撞态 BossAABB 与 PlayerAABB overlap 即命中；若玩家 iframe==0 扣18并设 iframe=0.45；若 iframe>0 不扣血
命中不产生任何位移/硬直/速度改写（玩家受击位移=无）
16.9 Boss 死亡（闭合）
Boss HP≤0：立即进入 DEAD（不再移动/攻击/参与碰撞），启动 boss_death_timer=0.8
timer 到时同帧：解除镜头锁定、DoorBoss 解锁、BossBar 隐藏（并允许出口解锁检查，见 23）
Boss 模式的逻辑退出锚点以“死亡标记成立（HP ≤ 0）”为准；
任何延迟事件（如 0.8s 的 UI、门解锁或演出）仅为表现或状态延迟，
不得作为 Boss 模式退出的判定依据。
Boss 模式相关的相机、门锁与状态切换，
必须在清理阶段或其后执行。
17.	视线遮挡射线（slab 法｜LOCKED）
17.1 线段：enemy_center → player_center（含端点）。
17.2 遮挡集合：Solid/Wall/Door(locked)。
17.3 slab 判定（唯一）：
对每个遮挡 AABB 先做 eps 扩张：min-=eps, max+=eps
若线段与任一扩张后 AABB 相交（含端点在盒内）→ 遮挡
18.	边界与销毁（LOCKED）
18.1 玩家死亡边界（玩家中心）：
x < -5 或 x > 365 或 y > 20 或 y < -40 → 立即死亡（进入重生流程）
18.2 投射物越界销毁（投射物中心）：
x < -10 或 x > 370 或 y > 30 或 y < -50 → 立即销毁
19.	摄像机（LOCKED）
19.1 视野 32×18cm。
19.2 目标：
target = player_center + (Facing4, 0)
若 player_vy <= -8：target.y -= 2
19.3 平滑：
alpha = 1 - exp(-12dt)
cam = cam + (target - cam)alpha（分量分别计算）
19.4 限速（欧氏长度）：
delta = cam_new - cam_old
若 len(delta)/dt > 20：缩放 delta 使 len(delta)=20dt
19.5 clamp 顺序：先平滑+限速，再 clamp。
19.6 普通 clamp：
cam_x ∈ [16,344]
cam_y ∈ [-21,1]
19.7 Boss clamp：
cam_x ∈ [286,314]
cam_y ∈ [-13,-9]
19.8 模式切换：
TR_BOSS 触发后进入 Boss clamp
Boss 死亡计时满 0.8s 的那一帧切回普通 clamp
20.	UI / 视觉 / 音频（LOCKED）
20.1 UI 基础：
ui_scale = screen_h/720（本分辨率下恒为 1）
SafeMargin = 24px * ui_scale
所有 UI 坐标/尺寸 round 到整数像素
20.2 HintBanner 文本与时长（唯一）：
出口解锁 1.0s
检查点 0.8s
体力不足 0.5s
弹药不足 0.6s
通关 持续显示（无倒计时）
20.3 BossBar：
Boss 房期间显示；Boss 死亡满 0.8s 的那一帧隐藏
20.4 敌“！”：
发现瞬间显示 0.5s；位于敌顶中心上偏移 12px
20.5 闪烁波形（唯一）：
任意闪烁启用后计时 t 从0累计
visible = ( floor(t/0.25) % 2 == 0 )（2Hz）
20.6 视觉：
仅几何体；黑描边 2px；主体矩形与 AABB 一致
Facing 箭头 8×8 三角
Aim 线 2cm 白线
钩爪链条 直线
20.7 颜色（RGBA255，主体色）固定：
Player (80,180,255,220)
melee (255,120,120,220)
rifle (255,170,80,220)
shotgun (180,120,255,220)
Boss (255,200,80,220)
PlayerBullet (235,235,235,255)
RifleBullet (255,240,160,255)
ShotgunPellet (220,180,255,255)
GrappleHead (160,160,160,255)
Solid/Wall (120,120,120,255)
OneWay (120,200,120,255)
Door (200,140,80,255)
20.8 音频：本版本无（禁止任何音效/音乐）。
21.	每帧更新顺序（对象级锁死｜含“受击位移/硬直/速度改写”闭合）
21.1 大步骤（唯一）
1.	采样输入（含 just_pressed/just_released、鼠标坐标）
2.	iFrame 递减：iframe_timer = max(0, iframe_timer - dt)
3.	玩家状态切换（下穿/蹲滑/Dash触发/近战触发/钩爪触发）
4.	玩家速度/位移与地形碰撞（先X后Y；更新 grounded 与 standing_oneway_id）
5.	Player vs Enemy/Boss 挤出（21.1.5）
6.	摄像机更新（19）（用于本帧敌人发现判定）
7.	敌人更新（发现/移动/近战意图/远程开火）
8.	Boss 更新（段计时/开火/冲撞/死亡计时）
9.	生成攻击/投射物（按 21.2 顺序；生成当帧即参与更新）
10.	投射物与钩爪头移动/碰撞，生成命中事件（13.5/14）
11.	伤害结算（21.3）
12.	清理销毁（死亡敌/Boss、destroyed 投射物、结束钩爪）
13.	DoorExit 解锁检查 / 通关检查 / Hint 刷新
14.	ST 回复（10.2）与 UI 刷新
15.	若本帧触发死亡：执行重生流程（23）
21.1.5 角色挤出（闭合：不改玩家速度）
仅处理：Player vs 每个 Enemy/Boss 的 overlap（4.3）
只移动玩家，敌/Boss 不动
挤出轴：最小分离轴；穿透量相等（差≤eps）→ 优先 X
方向：player.x >= other.x 向 +X，否则向 -X（Y 同理）
挤出后再做一次地形碰撞修正（8，最多 1 次）
挤出不改玩家 vx/vy；只有随后的地形碰撞修正才可能置零速度
21.2 攻击/生成顺序（锁死）
1.	玩家近战：记录本帧命中列表
2.	玩家远程：生成子弹
3.	敌人近战：记录命中意图
4.	敌人远程：生成投射物
5.	Boss：生成投射物 / 开始冲撞（若当帧触发）
21.3 伤害结算顺序与同帧规则（锁死）
结算顺序：
(1) 玩家→敌/Boss（近战命中先于玩家子弹命中）
(2) 敌/Boss→玩家（敌近战意图 + 敌投射物命中 + Boss 冲撞命中）
同帧规则：
同一帧玩家被多个来源命中：只取最大伤害一次扣血并进入 iFrame
同一帧所有“命中玩家成立”的敌方投射物必须消失（即使玩家已在 iFrame）
受击位移/硬直闭合：对玩家与敌/Boss，任何伤害都不产生位移、不产生硬直、不改 vx/vy（除非该对象在 Dash/冲撞等位移覆盖态结束时按规则置零）
21.4 遍历顺序（强制）
rects：按 level_train_v1.json.rects 原数组顺序
enemies：按 id 字典序升序（E1..E8）
projectiles：按 spawn_seq 升序（全局递增，从0开始；仅成功生成时自增）
Boss 霰弹 5 颗生成顺序：角度从小到大（-15,-7.5,0,+7.5,+15）
22.	训练关 v1（唯一权威｜JSON 必须完整给出）
22.1 本关数据必须原样保存为 docs/level_train_v1.json；除 JSON 外无额外地形/触发/拾取。
22.2 顶层字段白名单：{level_id, units, world_bounds, player_spawn, rects, enemies, boss}；units="cm"。
22.3 rect 字段白名单：
Solid/Wall/OneWay：{id,type,x,y,w,h}
Door：{id,type,x,y,w,h,locked_initially}
Trigger：{id,type,kind,x,y,w,h}，kind 仅 "BossTrigger" 或 "Goal"
Checkpoint：{id,type,x,y,w,h,respawn_x,respawn_y,respawn_facing}
22.4 强制几何约束：
Solid / OneWay：h=1.000
Wall / Door：w=1.000
22.5 训练关 JSON（唯一权威｜必须与仓库文件字面一致）
（此处为上一条消息中的完整 JSON 原文；保持字面一致。为避免重复过长，你可直接复制上一条中 22.5 的 JSON 段落粘贴到这里；若你要求我再次完整输出，我会原样再贴一次。）
23.	关卡交互规则、死亡与重生（闭合“死亡对世界状态 / 重生重叠 / 输入窗口”）
23.1 启动初始化（LOCKED）
载入 train_v1 后同帧初始化：
Player pos = player_spawn；Facing=spawn.facing
HP=100, ST=100, AMMO=60
清空：所有冷却/状态（Dash已用=0、钩爪不存在、iFrame=0、ignore_oneway空、提示清空等）
初始化 Door：
DoorBoss.locked = locked_initially
DoorExit.locked = locked_initially
Boss：INACTIVE；HP=420；阶段计时/charge_timer/charge_pending 清零
23.2 TR_BOSS（首次触发）
首次玩家 overlap TR_BOSS 同帧执行：
DoorBoss.locked=true
camera 切 Boss clamp
Boss INACTIVE→ACTIVE（开始攻击循环）
TR_BOSS 仅处理首次进入
23.3 Boss 死后 0.8s
Boss HP≤0 后：
立即 DEAD + boss_death_timer=0.8
timer 到时同帧：
DoorBoss.locked=false
camera 回普通 clamp
BossBar 隐藏
23.4 DoorExit 解锁与 GOAL 通关
DoorExit 解锁条件：E1~E8 全灭 且 Boss 死亡完成（0.8s到时事件已执行）
→ DoorExit.locked=false 并提示“出口解锁”1.0s
GOAL：仅当 DoorExit.locked==false 且玩家 overlap GOAL 时通关
通关进入 WIN：
game_state=WIN
冻结所有更新（角色/投射物/钩爪/相机/AI/输入效果全冻结）
Aim 线也冻结
HintBanner 显示“通关”，持续显示
23.5 死亡与重生（闭合）
玩家死亡触发条件：HP≤0 或死亡边界（18.1）。
重生同帧执行顺序（唯一）：在 21 大步骤的最后执行重生（同帧完成）。
重生效果（唯一）：
选取最近 Checkpoint 的 respawn 点：pos=(respawn_x,respawn_y)，Facing=respawn_facing
资源补满：HP=100, ST=100, AMMO=60
清空玩家速度与状态：
vx=0,vy=0
Dash 已用=false
钩爪清零（头/拉拽/卡住全部清空）
ignore_oneway 清零
JumpAscend 清零
slide/crouch 清零（站立为默认姿态）
iframe_timer=0
Hint 清空
世界状态（闭合）
所有投射物（玩家/敌/Boss）全部清空
若同一逻辑帧内同时发生对象清理与重生流程，
所有投射物的实际移除以 21.1 中的「清理阶段」为唯一裁决点；
重生阶段中的“清空投射物”仅作为状态保证，
不得引入额外或重复的移除行为。
普通敌：不重置（HP/位置/冷却保持死亡前状态；已死亡则已被移除）
若死亡发生在 boss_mode 期间（防软锁）：
强制退出 boss_mode：camera 回普通 clamp
DoorBoss.locked=false
Boss 回 INACTIVE（Boss HP 不变；但阶段计时/charge_timer/charge_pending 重置为初始）
23.6 重生点重叠处理（闭合）
重生设置 pos 后，若玩家站立 AABB 与阻挡集合（Solid/Wall/Door locked） overlap：
执行最多 8 次“最小分离轴挤出”（轴 tie→X），每次推到“刚好不重叠”（用 eps）
8 次后仍重叠：本次重生改用 CP0 respawn 点，并重复上述检查一次；
若仍重叠则强制 pos=(6,-21)（player_spawn）并 vx=0,vy=0
23.7 重生后输入窗口（闭合）
重生完成后设置：respawn_input_lock_frames = 1
在 lock 生效的下一帧：
所有按键视为 not pressed（down=false/just_pressed=false/just_released=false）
鼠标坐标仍更新，但 Aim_dir 在该帧固定为 Facing_dir
该帧不允许触发任何动作（射击/近战/跳/Dash/钩爪/滑/下穿均禁止）
lock 帧结束后复位为 0
==================================================
24. 帧内时序与实现验收附录（NORMATIVE）
==================================================

本章为规范性附录（NORMATIVE）。
本章内容不引入任何新机制或新数值，
仅用于消除正文条文在工程实现中的语义歧义。
若本章与正文存在理解冲突，以本章为准。

--------------------------------------------------
24.1 帧与“同帧”的统一定义
--------------------------------------------------

本文中出现的以下表述：

- 同帧
- 当帧
- 立即
- 生成当帧即参与
- 到时同帧执行

统一定义为：

上述行为必须发生在同一个逻辑 tick（dt = 1/60）内，
且必须插入到 21.1 所定义的某一个明确子步骤中，
不允许跨越该子步骤的边界，
不允许延迟到下一帧，
也不允许提前到前一子步骤。

--------------------------------------------------
24.2 帧内事件插入点（唯一）
--------------------------------------------------

下列事件必须插入到指定的 21.1 子步骤中执行，
不得前移、后移或合并。

24.2.1 攻击与投射物生成  
插入点：21.1 → 攻击 / 投射物生成  
规则：
- 本步骤生成的攻击或投射物
- 必须在同一帧内参与后续的「投射物更新」与「伤害结算」
- 不允许延迟到下一帧生效

24.2.2 命中成立（Hit Confirm）  
插入点：21.1 → 投射物更新  
规则：
- 命中仅用于记录命中事件
- 不在该阶段扣血、不改变任何对象状态

24.2.3 伤害结算  
插入点：21.1 → 伤害结算  
规则：
- 统一处理上一阶段记录的命中事件
- 同一帧内来自多个来源的命中，仅结算一次最大伤害
- 伤害结算完成前，不得执行死亡清理

24.2.4 死亡判定  
插入点：伤害结算阶段的末尾  
规则：
- HP ≤ 0 时，标记对象为死亡状态
- 不在此阶段移除对象或清理资源

24.2.5 清理销毁  
插入点：21.1 → 清理  
规则：
- 销毁已被标记死亡的敌人或 Boss
- 销毁被标记为 destroyed 的投射物
- 本阶段为唯一允许移除对象的阶段

24.2.6 重生  
插入点：21.1 全部流程的最后  
规则：
- 若同一帧内触发死亡与重生，重生必须在该帧完成
- 重生后的对象状态不得参与本帧任何其他逻辑步骤

--------------------------------------------------
24.3 行为结束与剩余时间处理
--------------------------------------------------

当正文中出现以下语义：

- 立即结束
- 结束当刻
- 剩余时间丢弃

统一解释为：

在当前逻辑 tick 内，
立即停止该行为的位移或作用效果，
但仍继续执行本帧剩余的逻辑步骤，
不得提前终止本帧，
也不得跳过后续阶段。

--------------------------------------------------
24.4 状态词汇的工程语义
--------------------------------------------------

本文中使用的状态词统一定义如下：

- 记录：写入仅在当前帧有效的临时集合
- 标记：设置对象状态位，不立即产生销毁或清理效果
- 清空：在指定阶段整体重置对应状态或集合

上述词汇不得被解释为立即触发其他隐含行为。

--------------------------------------------------
24.5 实现验收清单（强制）
--------------------------------------------------

以下条目用于判定实现是否严格遵守蓝图规范，
不用于玩法测试，仅用于一致性裁决。

24.5.1 时序一致性  
- 同一帧生成的投射物，当帧可命中  
- 同一帧多命中，仅结算一次最大伤害  
- 命中成立不等于立即扣血  
- 死亡对象不会在伤害阶段立刻消失  
- 对象仅在清理阶段被移除  

24.5.2 死亡与重生  
- HP ≤ 0 当帧必定进入死亡流程  
- 重生必定发生在 21.1 最后  
- 重生后状态不参与当帧其他逻辑  
- 重生会清空所有投射物  
- Boss 模式下死亡必定强制退出 Boss 模式  

24.5.3 输入与状态  
- 重生后 1 帧内所有输入视为未按下  
- just_pressed 不得跨帧保留  
- Dash / 钩爪 / 滑行结束后速度归零  

24.5.4 判定唯一性  
- grounded 仅由 Y 轴落地判定  
- OneWay 仅自上而下阻挡  
- 挤出仅移动玩家，不改变速度  
- 所有 tie-break 必须按正文规定执行  

24.5.5 禁止项  
以下任一行为视为实现失败：  
- 自动补充动画或缓冲逻辑  
- 自动补充容错或体验优化  
- 改写更新顺序  
- 使用第三方物理或碰撞引擎  
- 以任何理由调整数值或判定条件  

通过本章全部检查的实现，
视为蓝图一致实现；
任一失败，视为发生自由发挥。
---

# Implementation Spec & Clarifications

Priority rule:
If any ambiguity exists between earlier sections and this section,
the rules defined here take precedence.

Status: FROZEN  
Consistency Audit: A–H PASSED

---

## Clarification Patch (Normative)

### C. Projectile cleanup vs respawn precedence

If object cleanup and respawn occur within the same logic frame,
the actual removal of all projectiles MUST be adjudicated exclusively
at the "Cleanup" stage defined in the update order (Section 21.1).

The clause "clear all projectiles on respawn" serves only as a state guarantee
and MUST NOT introduce additional or duplicated removal logic.

---

### D. OneWay top surface grounding rule

The top surface of a OneWay platform SHALL be treated as a valid
Y-axis downward landing surface.

Therefore, when an entity moves downward onto a OneWay top surface
and is blocked, grounded MUST be set to true.

No other contact with OneWay platforms SHALL affect grounded state.

---

### E. Boss mode exit anchor

The logical exit condition of Boss Mode is strictly the establishment
of the death mark (HP ≤ 0).

Any delayed events (e.g. 0.8s UI delay, door unlock animation, camera transition)
are considered presentation or deferred state changes only
and MUST NOT be used as the exit condition of Boss Mode.

All Boss-related camera, door lock, and state transitions
MUST occur during or after the Cleanup stage.

---

## Assertion Specification (A–H)

The implementation MUST satisfy all assertions below.
All assertions have been verified and PASSED during consistency audit.

### A. Update order determinism
All logic MUST follow the fixed update order defined in Section 21.1.
No reordering, merging, or skipping of stages is allowed.

### B. Hit vs damage separation
Hit detection MUST NOT directly apply damage.
Damage resolution MUST occur only during the damage resolution stage.

### C. Cleanup and respawn adjudication
Object and projectile removal MUST occur only during the Cleanup stage,
as clarified in the projectile cleanup precedence rule above.

### D. Grounded and OneWay determinism
Grounded state MUST be determined solely by Y-axis downward landing,
including valid OneWay top surface contact as clarified above.

### E. Boss mode lifecycle
Boss Mode activation and exit MUST follow the defined trigger and
death-mark-based exit anchor, without reliance on delayed events.

### F. Input lifecycle
just_pressed inputs MUST exist for exactly one frame
and MUST NOT persist across frames or respawn.

### G. Forbidden behaviors
The implementation MUST NOT introduce:
- implicit buffering
- automatic tolerance logic
- undocumented optimizations
- third-party physics engines
- inferred mechanics not defined in the blueprint

### H. Determinism
Given identical input sequences, the simulation MUST produce
identical results across runs.

---

End of Implementation Spec & Clarifications.

