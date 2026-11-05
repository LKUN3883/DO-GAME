# DO-GAME

固定 1280×720 逻辑分辨率的浏览器几何射击游戏。

## 公开试玩

[立即游玩 DO-GAME](https://lkun3883.github.io/DO-GAME/)

可直接分享上面的链接。页面中的键鼠操作说明位于游戏画布下方，可展开或收起。

## 键鼠操作

| 输入 | 操作 |
| --- | --- |
| A / D | 向左 / 向右移动 |
| S | 按住蹲下；地面移动时按下触发滑铲 |
| S + W / Space | 从单向平台下穿 |
| W / Space | 跳跃；空中再次按下可冲刺 |
| F | 近战攻击 |
| 鼠标移动 | 瞄准 |
| 按住鼠标左键 | 连续射击 |
| 按住鼠标右键 | 发射并维持钩爪；松开结束 |

鼠标射击和钩爪请在游戏画布内按下；键盘操作在页面获得焦点时生效。

## 当前版本与本地检查

PR #2 已于 2026-10-22 合并到 `main`，GitHub Pages 也已于当日成功部署。

PR #2 合并前的验收记录和未验证平台见 [最终验收记录](docs/reviews/FINAL_ACCEPTANCE.md)。此前审计报告作为修复历史保留。

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run test:browser
npm run test:browser:grapple
npm run test:playthrough
```
