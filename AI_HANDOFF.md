# 《炼剑》SwordForge · AI 接力工作手册

> **给 AI 的快速上手文档**：每次新开对话时，先读本文件 + `README.md` + `CHANGELOG.md`(最新版本段)，即可快速进入工作状态。
> 项目根还有 `/memories/repo/swordforge.md`(深层踩坑笔记，可参考)。
>
> **⚠️ 你的维护职责**：本手册由 AI 共同维护——**每完成一项功能/修复/平衡调整后，必须同步更新本文档**中受影响的部分，并在「十一、文档维护日志」顶部追加一条(详见「八.5」)。让这份文档永远是最新的事实来源。

---

## 一、这是什么

修仙题材 · 放置 · 进化 · 模拟 游戏(SRD v1.0 实现)。玩家扮演剑修弟子，十日内于「剑域」投放炉材、撒布庚金、择选剑潮，观凡铁剑意通过采气、搏杀、繁衍、突变进化，最终淬炼本命剑意赴宗门大比、冲击万剑榜。

## 二、技术栈与命令(重要)

| 项 | 值 |
| --- | --- |
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

**部署**：已接 **Vercel**(GitHub 仓库自动构建，push 即上线)。`base:'./'` 已配置，子路径托管(GitHub Pages 等)也兼容；静态资源引用一律用 `import.meta.env.BASE_URL` 拼接(见「十、注意事项」)。

## 三、必须看的文件(按重要性)

| 文件 | 为什么看 |
| --- | --- |
| `src/Game.ts` | **唯一编排者**：场景状态机(menu/embryo/forge/appraisal/tournament)、主循环、天劫、鉴定、大比、存档、解锁。多数跨模块逻辑都在这里 |
| `src/constants.ts` | 全部平衡参数(数值调整先看这里) |
| `src/simulation/World.ts` | 世界容器：网格/食物/火墙/剑意/分化/剑潮/天劫收缩/主循环 `tick()` |
| `src/simulation/SwordAgent.ts` | 剑意个体：感知→决策(NN+本能)→行动→精元/剑体结算→词条参悟 |
| `src/simulation/Duel.ts` | 宗门大比决斗引擎(AP 半即时制、剑诀、招式生成、MUD) |
| `src/simulation/Skills.ts` | 剑意技能系统(五行天赋 + 词条衍生) |
| `src/data/SaveManager.ts` | 存档结构 `GameSave`(改存档必看) |
| `src/ui/Renderer.ts` + `HUD.ts` | Pixi 画布渲染 + DOM 主界面 |

## 四、架构核心(30 秒版)

```text
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
8. **剑尘(遗蜕)**：**炼成**(天劫后有幸存者)即得 `hasSwordDust`，开局自动淬入剑胚(+0.5 四维)；**失败不得**。已从炉材移除 `sword_dust` 材料(无双轨)，`MaterialUnlock.firstCompletion` 类型保留备未来用。

**属性语义(v1.6.0 起)**：锋锐=攻击(含暴击)、坚韧=防御、感知=闪避率+视野、速度=蓄条/大比出手(世界内由 `speedBonus` 材料提供移动加速)、杀性=凶性(暴击)、策略=孤狼/合击。

**词条系统**(`AffixDB.ts`，存于 `Genome.affixes` 可遗传)：eat30 吞金(采气≥20) / kill5 斩念(击破≥3) / fight15 百炼(历经≥12战) / roam400 游历(足迹≥250) / poison 淬毒(rare，锋锐≥7 且杀性≥0.55 且存续≥2500且历经≥15战) / parasite 寄灵(rare，木行+合击+世代≥4)。判定在 `SwordAgent.recheckAffixes()` 每 tick 参悟。**v1.8.0 门槛放宽、v1.9.0 淬毒加行为要求(存续2500/15战)修正稀有度**。

**剑意技能**(`Skills.ts`)：五行天赋**每行 2 技**(主+辅，v1.8.0 扩充)——金[剑气斩+金罡体]/木[回春术+青藤缚]/水[瞬水步+惊涛斩]/火[焚天爆+烈焰甲]/土[磐石护+地脉震]；词条衍生 6 技。灵鉴「剑技」区块与宗门大比招式同源(`Duel.buildTechniques`，上限 5 招)。

## 六、炉材一览(RecipeDB)

| 材料 | 效果 | 次数 |
| --- | --- | --- |
| 千年寒铁 | 庚金生成 +40% | 4 |
| 扶桑火种 | 生成临时火墙 | 3 |
| 无根水 | **全体身法 +0.5(每 tick 有几率额外行动一步，移动更迅疾)** | 3 |
| 御风符 | 温度→清风(能耗 -40%) | 3 |
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

- **技术债(有意保留，勿贸然动)**：
  - `World⇄SwordAgent` 运行时循环依赖(ESM 延迟求值可跑，风险高未动)。
  - `RankingManager.submit`(合理工具方法，暂未接入 Game 内联排名逻辑)、`embryoElement`(存档字段，只写不读)。
- **素材 TODO**：音效(Web Audio 合成或等源)、字体(等 woff2)、水墨背景已接(`pic/` → `public/img/battle/`)。
- **观察项**：`randomWildGenome` 后期属性顶格同质化；`perceive()`(20 格)与 `nearestTarget()`(10 格)感知范围不一致；buff 技能触发率硬编码 0.01 vs `castChance` 0.05；「雷劫余生」标签用世界级开关(是否改个体经历待定)。

## 十、注意事项(踩过的坑)

- **Node v16**：Vite 4 是底线，别升级。
- **Pixi v7** `app.view` 类型是 `ICanvas`，需断言 `as unknown as HTMLCanvasElement`。
- **日志滚动**：`#app` 高度约束靠 `forge-screen` 类(height:100vh; overflow:hidden)，别删。
- **响应式**：Pixi 会给 canvas 写内联 `width/height`，CSS 需 `width:auto!important` + `aspect-ratio:1/1`；点击映射用 `rect.width` 归一化。
- **事件监听**：HUD/Renderer 都实现了 `destroy()`(字段级 handler 解绑)，新 UI 类请保持同款，避免监听器泄漏。
- **存档迁移**：`SaveManager.load()` 已做字段级迁移(缺 `origin` 补 seed/wild，含 `pendingAppraisal.winnerState`)；新增存档字段时记得同步 `defaultSave()` 与 `exportSave()`。
- **刷新续玩(v1.9.0)**：存档 `pendingScene`('appraisal'|'tournament'|null) + `pendingAppraisal`(鉴定数据) + `pendingBattlePlayerState`(玩家剑状态)——`continueRun()` 按阶段路由(restoreAppraisal/restoreTournament)；`endTribulation` 成功设 appraisal、`finishAppraisal` 设 tournament、`doStartNewRun` 清空、`showMenu`(booted 后)清空。`exportSave` 的 `activeRun` 是按 `scene==='forge'` 计算的，鉴定/大比阶段靠 pendingScene 驱动「继续炼剑」按钮(MenuScene 已含 pendingScene)。
- **部署路径**：JS 里引用 public 资源必须 `import.meta.env.BASE_URL + '...'` 拼接(BattleScene 大比背景、swordIcon 剑图)，别写死 `/img/...` 根绝对路径(子路径托管 404)；`src/vite-env.d.ts` 提供 `import.meta.env` 类型。
- **资源体积**：`bg_1.jpg`(168KB) 由原 `bg_1.png`(4.2MB) 压缩而来——大图先压再入库。
- **性能/移动端**：Pixi `resolution` 已钳制 `min(dpr, 2)`(手机 3x 背缓冲 1920² 每帧全量重绘开销大)；画布 `touch-action:none`；移动端用 `100dvh` + `env(safe-area-inset-bottom)`。
- **World 增量集合(v1.8.1)**：`World` 维护 `foodCells`/`wallCells` 两个 `Set<number>`(键=`y*width+x`)，渲染端只遍历集合而非全网格——**新增/移除食物或墙的逻辑必须同步维护这两个集合**(`spawnFood`/`removeFood`/`spawnCorpseFood`/`spawnMegaFood`/`spawnFireWalls`/`shrink`/`wallExpiry`/`restoreEcoState` 等处)。
- **特效系统(v1.9.0)**：野外 `Renderer` 三层特效——粒子 `spawnBurst` / `effects` 弹道环束(proj/ring/beam，`updateEffects`+`drawEffects`) / `floatTexts` 飘字(Pixi Text，上限8、destroy 清理)，**全部技能(projectile/aoe/line/heal/buff/teleport)施放均有技能名飘字**；buff 常驻光环与淬毒绿闪边在 `drawSword()` 直接读剑状态每帧绘制。大比 `BattleScene.playFx()` 按 `DuelFx` 播 DOM 特效(`.duel-fx` CSS)，strike 类(锋行/青藤缚等)也有基础斩击弧光。新增特效保持同款：字段级 handler、destroy 清理、飘字上限。
- **存档时机**：除 5s 自动 + 事件触发外，`pagehide`/`visibilitychange(hidden)` 会再存一次(iOS `beforeunload` 不可靠)，防关页丢进度。

## 十一、文档维护日志

> AI 每次维护本文件后，在**顶部**追加一条（日期 + 一句话说明）。

- 2026-08-10 v1.9.0：技能特效全面强化(野外 buff 常驻光环/全技能飘字/命中爆点/淬毒绿闪边；大比回春护盾淬毒寄灵天门破游龙重击与基础斩击全加强+飘字+受击闪光) + 暂停态点倍率自动恢复走时 + 灵鉴弹窗可滚动 + 刷新续玩(鉴定/大比可经「继续炼剑」恢复) + 淬毒词条门槛加行为要求(存续≥2500/历经≥15战)修正稀有度(凶潮 2.9→0.7 柄/局)。
- 2026-08-10 v1.8.1：修复击杀后攻方不占格/鉴定标签门槛与词条不一致/闪避反震回血/大比自伤不判负；性能优化(渲染增量集合 foodCells/wallCells、消除重复全盘扫描、洗牌复用、技能缓存)；Markdown lint 清理 + 新增 .markdownlint.json。
- 2026-08-10 v1.8.0：技能系统扩充(五行每行 2 技 + 大比招式上限 5) + 词条门槛放宽(eat30/kill5/fight15/roam400/淬毒/寄灵) + 修复鉴定命名 UI(标签/边框/点击反馈) + finishAppraisal 空名兜底 + 觅食本能 0.7→0.85 与惯性减半(修剑意兜圈/无视食物) + 鉴定页属性/评分/特质说明浮窗。
- 2026-08-10 v1.7.0：外测发布准备——DPR 钳制 2x + 画布 touch-action、移动端 100dvh/safe-area、pagehide 关闭前自动存档、BattleScene/swordIcon 改 BASE_URL 路径、bg_1.png(4.2MB)→bg_1.jpg(168KB)、favicon、新增 vite-env.d.ts；部署接 Vercel。
- 2026-08-10 v1.6.2：处理暂缓设计决策——剑尘改为「炼成才得、失败不得」并移除 `sword_dust` 炉材；清理 `randomSwordName`/`BehaviorTag` 死代码；`computeRankUnlocks(0)` 防御、`moveSword` 占用校验、`shrink` 清墙内食物、尸食设硬上限；删除已完成的 `bugfix.md`。
- 2026-08-10 v1.6.1：新增「八.5 自我维护约定」与本章节；记录无根水身法生效、淬毒门槛调整、僵尸剑意/剑诀/存档类修复、AI_HANDOFF.md 建立。
