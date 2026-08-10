# 《炼剑》SwordForge · AI 接力工作手册

> **给 AI 的快速上手文档**：每次新开对话时，先读本文件 + `README.md` + `CHANGELOG.md`(最新版本段)，即可快速进入工作状态。
> 项目根还有 `bugfix.md`(待修复清单)、`/memories/repo/swordforge.md`(深层踩坑笔记，可参考)。

> **⚠️ 你的维护职责**：本手册由 AI 共同维护——**每完成一项功能/修复/平衡调整后，必须同步更新本文档**中受影响的部分，并在「十一、文档维护日志」顶部追加一条(详见「八.5」)。让这份文档永远是最新的事实来源。

---

## 一、这是什么

修仙题材 · 放置 · 进化 · 模拟 游戏(SRD v1.0 实现)。玩家扮演剑修弟子，十日内于「剑域」投放炉材、撒布庚金、择选剑潮，观凡铁剑意通过采气、搏杀、繁衍、突变进化，最终淬炼本命剑意赴宗门大比、冲击万剑榜。

## 二、技术栈与命令(重要)

| 项 | 值 |
|---|---|
| 语言 | TypeScript(严格模式) |
| 构建 | **Vite 4**(^4.5.3)——**本机 Node 是 v16.20.0,不能升 Vite 5** |
| 渲染 | PixiJS 7 |
| 持久化 | localStorage(`SAVE_KEY='swordforge-save-v1'`) |

```bash
npm install          # 装依赖
npm run dev          # 开发 → http://127.0.0.1:5173
npm run build        # tsc --noEmit && vite build (改完必跑!)
npm run preview      # 预览生产构建
```

**改代码后必须**：`npm run build` 通过类型检查 + 构建；涉及 UI 用浏览器实测。

## 三、必须看的文件(按重要性)

| 文件 | 为什么看 |
|---|---|
| `src/Game.ts` | **唯一编排者**：场景状态机(menu/embryo/forge/appraisal/tournament)、主循环、天劫、鉴定、大比、存档、解锁。多数跨模块逻辑都在这里 |
| `src/constants.ts` | 全部平衡参数(数值调整先看这里) |
| `src/simulation/World.ts` | 世界容器：网格/食物/火墙/剑意/分化/剑潮/天劫收缩/主循环 `tick()` |
| `src/simulation/SwordAgent.ts` | 剑意个体：感知→决策(NN+本能)→行动→精元/剑体结算→词条参悟 |
| `src/simulation/Duel.ts` | 宗门大比决斗引擎(AP 半即时制、剑诀、招式生成、MUD) |
| `src/simulation/Skills.ts` | 剑意技能系统(五行天赋 + 词条衍生) |
| `src/data/SaveManager.ts` | 存档结构 `GameSave`(改存档必看) |
| `src/ui/Renderer.ts` + `HUD.ts` | Pixi 画布渲染 + DOM 主界面 |

## 四、架构核心(30 秒版)

```
src/
├── main.ts / Game.ts / constants.ts   # 入口 / 唯一编排者 / 全部平衡参数
├── types/    # Genome / Sword / Environment / Material
├── simulation/  # World / SwordAgent / NeuralNet / Genetics / BattleResolver / Duel / Skills (完全 headless)
├── ui/       # Renderer / HUD / Menu / DayPanel / Appraisal / Battle / Ranking / Codex / SwordDetail / swordIcon / modals
├── data/     # RecipeDB / SwordArts / NPCs / SaveManager / RankingManager / AffixDB
└── utils/    # mathUtils / eventBus / dom
```

**关键约定**：
- `src/simulation/` 完全 headless——**禁止直接 import DOM/toast**，一律走 `eventBus`(如 `rareToast` 字段)。
- 事件总线 `eventBus.ts`：`LOG/DAY_START/POP_CHANGE/TRIBULATION_END/BATTLE_HIT/SPLIT/DEATH/EAT/THUNDER/SKILL` 等；`emit` 已 try-catch 不中断主循环。
- 时间：1 日 = 12 时辰 = 960 tick；1x 速度 = 4 tick/秒(一天约 4 分钟)。主循环基于 `tickAccumulator` 节流。
- 战斗双轨：世界场 = 移动碰撞瞬间结算；大比 = Duel 引擎(数值×5)。

## 五、核心玩法机制

1. **择剑胚**：五行五选一，选后 `startNewRun(element)`。
2. **炼剑十日**：随时投食(每日 12 团)、炉材道具化(次数制)、每日子时剑潮(mild/tide/fierce/none/auto)。
3. **涌现**：剑意数 ≥20(`EMERGENCE_THRESHOLD`)且世代 ≥6(`EMERGENCE_MIN_GEN`)→「自成气候」，可点击聚焦。
4. **天劫**：第 10 日食物停生、边界向内收缩(每 8 tick 一格)至 4×4，幸存者评本命剑。
5. **剑成鉴定**：评分 = 存续×10 + 血脉相承×20 + 剑谱总和×0.5 + 本性殊异(≤15)。
6. **宗门大比**：AP 半即时制 Duel，选对手 + 剑诀(strike/counter/agile/quick/thunder)，词条/技能联动。
7. **万剑榜**：前 20 名，`history.length>=3` 后按排名解锁新材料。

**属性语义(v1.6.0 起)**：锋锐=攻击(含暴击)、坚韧=防御、感知=闪避率+视野、速度=蓄条/大比出手(世界内由 `speedBonus` 材料提供移动加速)、杀性=凶性(暴击)、策略=孤狼/合击。

**词条系统**(`AffixDB.ts`，存于 `Genome.affixes` 可遗传)：eat30 吞金 / kill5 斩念 / fight15 百炼 / roam400 游历 / poison 淬毒(rare，锋锐≥8 且杀性≥0.65 且久历) / parasite 寄灵(rare，木行+合击+世代≥5)。判定在 `SwordAgent.recheckAffixes()` 每 tick 参悟。

## 六、炉材一览(RecipeDB)

| 材料 | 效果 | 次数 |
|---|---|---|
| 千年寒铁 | 庚金生成 +40% | 4 |
| 扶桑火种 | 生成临时火墙 | 3 |
| 无根水 | **全体身法 +0.5(每 tick 有几率额外行动一步，移动更迅疾)** | 3 |
| 御风符 | 温度→清风(能耗 -40%) | 3 |
| 剑尘 | 开局淬入剑胚(+0.5 四维，走 `hasSwordDust` 布尔轨) | 1 |
| 《快剑总纲》残篇 | 分化速度突变率 ×3 | 2 |
| 《重剑无锋诀》 | 分化坚固突变率 ×3、速度突变率降 | 2 |
| 雷劫液 | 天雷(速度越慢越易被击) | 2 |
| 陨星铁母 | 撒超高能量食物 + 攻击欲望 +0.3 | 1 |

## 七、调试

- `main.ts` 暴露 `window.__game`(Game 实例)，浏览器 console 可直接驱动：`g.startNewRun('fire')`、`g.world.tick()` 循环快进、`g.endTribulation()` 等私有方法运行时可访问。
- headless 验证：动态 `import('/src/simulation/World.ts')` 在浏览器 console 构造世界批量测试。

## 八、工作流约定(务必遵守)

1. **每次 git 提交** 必须先在 `CHANGELOG.md` 顶部新增版本说明，commit message 附版本号。
2. **版本号规则**：功能新增 → 次版本 +1(x.y.0)；仅修复/微调 → 修订号 +1(x.y.z)。
3. 改完跑 `npm run build`。
4. 涉及玩法平衡的改动，先用 headless 批量测试验证(参考 `swordforge.md` 里的调参方法与基准：无干预 avg~6 / 扶持 avg~15)。
5. **【AI 自动维护本文件】**——这是本手册的自我更新机制，务必遵守：
   - 每完成一项功能 / 修复 / 平衡调整后，**必须**同步更新本文件（`AI_HANDOFF.md`）中受影响的部分，让下一位 AI 接手时看到的是最新事实。
   - 具体更新范围（按需）：
     - 新增了机制/玩法 → 更新「四、架构核心」或「五、核心玩法机制」；
     - 改动了数值/平衡/材料/词条 → 更新「五/六」中对应条目（如属性语义、词条门槛、炉材效果）；
     - 新增/删除了文件 → 更新「三、必须看的文件」与「四、架构」目录树；
     - 新增了坑/约定 → 更新「十、注意事项」；
     - 完成了某项待办/暂缓 → 从「九、已知待办」中划掉或标注；
     - 有任何一次维护动作 → 在「十一、文档维护日志」顶部追加一条（日期 + 一句话）。
   - 保持简洁：不要长篇大论，只改事实变化的部分；该文档的价值在于“最新 + 精简”。

## 九、已知待办 / 暂缓项

- **暂缓(设计决策)**：
  - 剑尘发放规则：当前每局完成必得(成功/失败都发)，是否按品质授予待定。
  - `World⇄SwordAgent` 运行时循环依赖(ESM 延迟求值可跑，风险高未动)。
  - 纯死代码清理：`RankingManager.submit`、`randomSwordName`、`embryoElement`、`BehaviorTag` 枚举、未用 EVT 事件。
- **素材 TODO**：音效(Web Audio 合成或等源)、字体(等 woff2)、水墨背景已接(`pic/` → `public/img/battle/`)。
- **观察项**：`randomWildGenome` 后期属性顶格同质化；`perceive()`(20 格)与 `nearestTarget()`(10 格)感知范围不一致；buff 技能触发率硬编码 0.01 vs `castChance` 0.05。

## 十、注意事项(踩过的坑)

- **Node v16**：Vite 4 是底线，别升级。
- **Pixi v7** `app.view` 类型是 `ICanvas`，需断言 `as unknown as HTMLCanvasElement`。
- **日志滚动**：`#app` 高度约束靠 `forge-screen` 类(height:100vh; overflow:hidden)，别删。
- **响应式**：Pixi 会给 canvas 写内联 `width/height`，CSS 需 `width:auto!important` + `aspect-ratio:1/1`；点击映射用 `rect.width` 归一化。
- **事件监听**：HUD/Renderer 都实现了 `destroy()`(字段级 handler 解绑)，新 UI 类请保持同款，避免监听器泄漏。
- **存档迁移**：`SaveManager.load()` 已做字段级迁移(缺 `origin` 补 seed/wild)；新增存档字段时记得同步 `defaultSave()` 与 `exportSave()`。

## 十一、文档维护日志

> AI 每次维护本文件后，在**顶部**追加一条（日期 + 一句话说明）。

- 2026-08-10 v1.6.1：新增「八.5 自我维护约定」与本章节；记录无根水身法生效、淬毒门槛调整、僵尸剑意/剑诀/存档类修复、AI_HANDOFF.md 与 bugfix.md 建立。

