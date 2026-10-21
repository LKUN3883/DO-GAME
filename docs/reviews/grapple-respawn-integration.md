> 历史联合交接；修复现已纳入最终候选，当前状态见 [最终验收](FINAL_ACCEPTANCE.md)。配套patch保留作证据，不应再次应用。

# 钩爪与重生／角色挤出：联合检查交接

本记录交给线程一处理联合整合。没有合并 PR，没有修改 main、PR #2 或重生审计分支。

检查对象固定为：

- 钩爪：`1a13b2dd2aae347a84d4a2ee8b1e509e362f6fe7`。
- 重生／角色挤出：`50debdf`（包含 `c5d132b` 的修复）。

在独立临时 worktree 合成这两个版本后，复现了两项真实兼容性问题。

## 1. 重生不能再调用延迟结束接口

重生分支的 `respawn()` 调用 `endGrapple()`。钩爪分支中，该函数的职责已变为标记结束，等待本帧 cleanup 实际清除。
重生现在位于 cleanup 之后，导致当帧仍保留 STUCK。机械整合后的 63 项 Node 测试中有两项失败，均为 `stuck !== none`。

冲突解法：保留重生分支完整的新 `respawn()`，仅将其中的 `endGrapple()` 改为：

```js
state.grapple=emptyGrapple();
```

保留 cleanup 对普通释放／死亡目标的清理职责；不要把 `endGrapple()` 改回全局立即清空，也不要恢复旧重生函数。

## 2. 角色挤出抵消拉拽后，STUCK 必须使用最终位置

复现场景：玩家拉向站在地面的步枪兵。地形移动阶段每帧前进，随后角色挤出又把玩家推回原位。
若先算 advance 再做角色挤出，连续 60 tick 玩家保持 x=10.898，却一直为 PULL，stuck_frames=0。

联合解法：`moveGrapplePlayer(input_x, separatePlayerBodies)` 在地形碰撞之后、advance 判定之前调用角色挤出；后面的公共 `separatePlayerBodies()` 仅对非 pulling 帧执行，避免同帧挤出两次。
STUCK／近锚点的提前返回也保留一次角色挤出。速度、距离和连续三帧阈值都不改变。

补丁见同目录 `grapple-respawn-integration.patch`。它针对**已解决文字冲突的联合副本**，不是对任一独立分支直接应用。先按以下原则处理三个文字冲突：

- `docs/game.js`：选择重生分支的新 `respawn()`，然后应用兼容补丁。
- `package.json`：Node 测试列表保留 `grapple.test.cjs` 和 `respawn-body.test.cjs`；保留双方浏览器与通关命令。
- `.github/workflows/game-smoke.yml`：保留双方分支触发项、双方测试和产物上传，不覆盖任何一组。

## 验证范围

修正后的临时联合副本：原有 63/63 项 Node 测试通过，并有两项联合专用回归测试。
从钩爪分支运行联合专用测试时，将环境变量指向联合副本：

```sh
GAME_REPO_ROOT=/path/to/combined node --test tests/integration/grapple-respawn.cjs
```

联合专用测试验证死亡当帧钩爪完全清空／下一帧右键输入屏蔽，以及角色阻挡后进入 STUCK／松开释放。
这两项测试依赖两个分支同时存在，不属于单独钩爪分支的默认测试命令。

**这份联合副本尚未执行 Chromium 或通关复验。** 线程一应用冲突解法后，应在最终联合提交上重跑 Node、双方 Chromium 和输入驱动通关。此前单独钩爪版本的 58 项 Node、16 项 Chromium 和通关成功记录，不能替代这次联合验收。
