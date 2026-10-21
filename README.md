# DO-GAME

固定1280×720的浏览器几何射击游戏。入口为 `docs/index.html`，通过HTTP服务加载关卡JSON。

本轮统一修复移动/碰撞、姿态、战斗、Boss、钩爪及重生。PR #3/#4/#5的修复与测试已经纳入PR #2最终候选，合并时只需处理PR #2。

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run test:browser
npm run test:browser:grapple
npm run test:playthrough
```

完整核对、运行证据、合并建议和未验证平台见 [最终验收记录](docs/reviews/FINAL_ACCEPTANCE.md)。此前审计报告保留作为修复历史，当前状态以最终验收记录为准。
