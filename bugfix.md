# 《炼剑》SwordForge · Bug 审查清单

> 审查日期：2026-08-10
> 审查范围：三方向并行精读 —— 模拟层（`src/simulation/`、`src/types/`）、UI 层（`src/ui/`、`src/utils/`）、编排与数据层（`src/Game.ts`、`src/main.ts`、`src/data/`）
> 说明：本清单按严重程度分级，每项含位置、问题描述与修复方向，供后续修复时勾选。修复完成后请同步更新 `CHANGELOG.md` 版本说明。
>
> **修复状态（2026-08-10 更新）**：
> - ✅ 已修复：P0-1～P0-5、P1-1～P1-7、P1-10～P1-14，以及淬毒门槛调优、swordIcon 竞态、techTitle 定时器、`minimized` 死类、`npcHp` 死变量、`chooseDailyDrop` 全失败日志、`spawnFoodAt`/`spawnFoodAround` 死代码、reseed 空位兜底、场景切换销毁 renderer、`World.addSword` 占用校验/POP_CHANGE
> - ⏸ 暂缓（设计/平衡决策）：P1-8 无根水负面化、P1-9 剑尘发放规则（保留"每次完成必得"）、P1-15 循环依赖（ESM 延迟求值可跑，仅建议加注释）、`mutationMult`/`megaFood` 死类型字段、`RankingManager.submit`/`randomSwordName`/`embryoElement`/`BehaviorTag` 枚举等死代码清理

---

## 🔴 严重（P0）—— 数据安全 / 核心正确性

### P0-1 僵尸剑意：击杀后防御者不立即移除
- **位置**：`src/simulation/SwordAgent.ts`（`performMoveTo` 击杀分支，约 314-336 行）
- **问题**：击杀分支从未调用 `world.removeSword(defender.state.id)` 或 `defender.die()`。防御者 hp≤0 后仍残留在 `world.swords` Map 中，`World.tick()` 对 Map 快照遍历，僵尸在下个 tick 仍可获得**完整一轮行动**（移动/吃食/攻击）。
- **后果**：
  - 僵尸可**反杀活剑**（`resolveBattle` 从不检查攻击方 hp）；
  - `swords.size` 虚高 → 影响涌现判定、天劫 `isTribulationOver()`、本命血脉断绝判定；
  - `moveSword` 把僵尸写进 grid，造成 grid↔Map 失同步、双剑同格；渲染器会画出尸体。
- **修复方向**：在 `defenderDied` 分支末尾（取完尸体能量/寄灵之后）调用 `this.world.removeSword(defender.state.id)`。

### P0-2 剑诀在宗门大比中大部分失效
- **位置**：`src/simulation/SwordAgent.ts:49-56, 235-238, 377-379`（`battleMods`）；`src/simulation/Duel.ts:192, 351, 358`
- **问题**：`SwordAgent.battleMods`（`firstStrike/agile/quick/thunder/noCost`）**全代码库从未被赋值**，是纯死代码。大比已改由 `Duel.ts` 独立构造 `Fighter`，剑诀只剩 3 处残缺实现：
  - `strike`「前 50 回合攻 +20%」实际是开局白送 +50 AP（语义不符）；
  - `counter`「后手反击」**完全未实现**；
  - `thunder`「雷引」**完全未实现**；
  - `agile`「攻 -10%、能耗降」仅守方闪避 +0.12，攻方两项缺失；
  - `quick`「攻 +10%、能耗 -20%」仅能耗 ×0.7，攻击加成缺失。
- **后果**：玩家选「后手反击」「雷引」等于没选；`fast_sword`/`thunder_potion` 解锁的剑诀无实际收益，与大比玩法承诺不符。
- **修复方向**：把剑诀效果全部下沉到 `Duel`：`counter` 受击后挂反击标记（下次出招伤害 ×1.5）；`thunder` 按概率附加雷伤事件；`strike` 用 `battle.tick < 50` 实现攻 +20%；`agile`/`quick` 补齐攻方效果；删除 `SwordAgent.battleMods` 死代码。

### P0-3 开始新局直接覆盖活动存档，无确认
- **位置**：`src/Game.ts`（`startNewRun`，约 158-216 行）；`src/ui/MenuScene.ts:34-38`
- **问题**：有进行中的局（`save.activeRun === true`）时，「开始炼剑」与「继续炼剑」同时显示，点「开始炼剑」直接 `saveGame()` 覆盖旧档，**无确认弹窗**。
- **后果**：进行到第 8-9 天的局被静默清空，不可恢复。
- **修复方向**：`startNewRun` 开头若 `this.save.activeRun`，先 `openModal` 确认「将放弃当前炼剑之局，确定？」。

### P0-4 开局首存 `activeRun=false`（时序 bug）
- **位置**：`src/Game.ts:214-216`（`saveGame()` 在 `buildForgeScene()` 之前）；`exportSave`（`activeRun: this.scene === 'forge' && !!this.world`）
- **问题**：`startNewRun` 里第一次存档时 `scene` 仍是 `'embryo'`，导致 `activeRun=false`。要等 5 秒自动存档或后续投食/炉材动作才纠正。
- **后果**：开局后 5 秒内直接关页 → 重开菜单只显示「开始炼剑」，该局孤立丢失。
- **修复方向**：把 `saveGame()` 移到 `buildForgeScene()` 之后（`buildForgeScene` 先设 `scene='forge'`），或在 `exportSave` 之外单独维护 `activeRun`。

### P0-5 `save.history` 无限增长
- **位置**：`src/Game.ts:818, 953`（两处 `sort().slice(0, 20)`）；`src/data/RankingManager.ts:27`（`submit`）
- **问题**：`sort` 原地生效但 `slice(0,20)` 的**返回值被丢弃**，`history` 只增不减；`RankingManager.submit`（含正确的 `.slice(0, TOP_N)`）**从未被调用**，排名逻辑被 Game 内联重写且写错。
- **后果**：① 存档体积与内存随局数线性增长；② 排名 `rank = findIndex+1` 基于全量 history，与榜单只展示前 20 的口径不一致。
- **修复方向**：改用 `RankingManager.submit`，或两处改为 `this.save.history = this.save.history.sort(...).slice(0, 20)`（重新赋值）。

---

## 🟠 中等（P1/P2）—— 玩法正确性 / 体验 / 健壮性

### P1-1 HUD 日志监听器泄漏
- **位置**：`src/ui/HUD.ts:38`；`src/Game.ts:262`（`buildForgeScene` 每次开局 `new HUD`）
- **问题**：`HUD` 无 `destroy()`，匿名 `eventBus.on(EVT.LOG, ...)` 永不解绑；`buildForgeScene` 只销毁 renderer，从不销毁 HUD。
- **后果**：每开一局多一个 LOG 监听，`emit(LOG)` 触发 N 次重复 `addLog` 与**重复「悟得稀有词条」toast**；内存随局数线性增长。
- **修复方向**：仿 Renderer 用字段级 handler，给 HUD 加 `destroy()`（`eventBus.off(EVT.LOG, handler)`），`buildForgeScene` 里 `this.hud?.destroy?.()`。

### P1-2 剑名 HTML 注入（自 XSS）
- **位置**：`src/Game.ts:966-968` + `src/ui/BattleScene.ts:316`（`setResult` 用 `innerHTML` 拼 `opp.name`）；输入源 `src/ui/AppraisalScene.ts:111-112`（用户命名）
- **问题**：用户命名的剑名（`nameInput.value`）→ `RankedSword.name` → 历史名剑对手 `opp.name` → `innerHTML` 拼接。输入 `<img src=x onerror=...>` 作为剑名，该剑作为对手被击败/惜败时脚本执行。
- **后果**：自 XSS；`nameInput.maxLength=12` 只限长度不限字符。
- **修复方向**：`setResult` 改用 `textContent`（或先 `escapeHtml`）。其余名字展示处均已用 `textContent`，唯此一处是 `innerHTML`。

### P1-3 存档不恢复 `lineage` 历史 → 进化树断裂
- **位置**：`src/Game.ts:228-241`（`continueRun`）、`:184-186`（`startNewRun`）、`:420-427`（`reseedLineage`）；`src/simulation/World.ts:196, 230, 304`
- **问题**：① `continueRun` 只对**当前存活**的剑重建 lineage，已死祖先的条目不入档 → `buildEvolutionTree` 回溯到第一个已死祖先即断裂；② 种子剑 `addSword` 后**从不 `lineage.set`** → 胜者是本命剑胚时悟道之树只剩孤根节点。
- **修复方向**：存档持久化 lineage 表（或至少种子条目）；`startNewRun`/`reseedLineage` 补 `lineage.set`。

### P1-4 续玩时天劫（收缩边界/火墙/食物）状态全部丢失
- **位置**：`src/Game.ts:222-246`（`continueRun`）；`src/data/SaveManager.ts`（存档不含 `bounds`/`walls`/`food`）
- **问题**：存档只存剑状态，续玩时 `new World()` 得到全新满格世界再 `spawnInitialFood(10)`。若在第 10 天天劫中退出续玩，已收缩边界恢复全图、混沌墙消失、界外剑"复活"；食物经济重置。
- **修复方向**：持久化 `bounds`/`walls`/`food`（或至少 bounds），续玩时恢复 `isShrinking`/`spawnFood`；或禁止天劫中中断续玩。

### P1-5 行为统计不序列化 → 续档后评分/词条/涌现失真
- **位置**：`src/data/SaveManager.ts`（`GameSave` 无行为字段）；`src/Game.ts:747-756`（`computeTags` 读 `s.behavior`）
- **问题**：`continueRun` 重建 `SwordAgent` 时 `behavior` 全归零。
- **后果**：续档后 `computeTags` 的「斩念成性/吞金成性/百炼之体/游历万方/静若渊渟」全部丢失 → 鉴定评分 `behaviorBonus` 失效、名剑标签缺失。
- **修复方向**：把 `BehaviorStats` 并入 `SwordState` 序列化；`continueRun` 恢复。

### P1-6 存档 version 恒为 1，字段演进无迁移
- **位置**：`src/data/SaveManager.ts:53, 58`
- **问题**：项目在 v1 存档上持续新增字段却从未 bump version。其中 **`origin`（v5.5 新增）在旧档 `swords[]` 中缺失**。
- **后果**：旧档 `continueRun` 后所有剑 `origin===undefined` → `seedLineageExtinct()` 立即判「本命血脉已绝」并弹窗暂停；渲染端金色剑穗消失。静默功能降级，且无修复路径。
- **修复方向**：version 按需 bump，`load()` 内做字段级迁移（如 `swords` 缺 `origin` 时按 `id===rootId` 补 `'seed'`），缺失字段逐一 `??` 兜底（现仅顶层浅合并）。

### P1-7 自动存档计时用固定 16.6ms/帧
- **位置**：`src/Game.ts:624`（`this.saveTimer += 16.6`）
- **问题**：与真实 `dt` 无关，存档频率随设备帧率漂移（30fps 约 50 秒一次，120fps 约 2.5 秒一次）。
- **后果**：低帧率设备「关页丢进度」窗口大幅拉长（叠加 P0-4 更严重）。
- **修复方向**：改为 `this.saveTimer += dt * 1000`。

### P1-8 无根水（`allSpeedBonus`）实为负面效果
- **位置**：`src/data/RecipeDB.ts:31-37`（描述「身法 +0.5」）；`src/simulation/SwordAgent.ts:354-355`（`cost = BASE × (1 + (g.speed + mods.speedBonus) × 0.05 + ...)`）
- **问题**：世界内移动恒 1 格/tick，`speedBonus` 唯一作用是**抬高精元消耗**。玩家投 3 次「无根水」实际是削弱种群（更快饿死）。
- **修复方向**：要么让 speedBonus 真正影响世界内移动频率/闪避，要么改写文案为「身法 +0.5（耗神上升）」并重定平衡。

### P1-9 剑尘双轨：必得 + 空操作
- **位置**：`src/Game.ts:814`（`finishAppraisal` 成功）、`:698`（`endTribulation` 失败分支）都置 `hasSwordDust=true`；`:566-567`（`applyMaterial('swordDust')` 空操作）；`src/ui/DayPanel.ts:25-26`（面板跳过该材料）
- **问题**：任一结局都发剑尘 → 「+0.5×4」成为**每局永久福利**，弱化失败惩罚；`applyMaterial('swordDust')` 永不执行，但 `startNewRun` 仍把 `sword_dust` 计入 `materialCounts`（次数 1）→ 一份用不掉的「幽灵次数」。
- **修复方向**：二选一 —— 要么删除 `sword_dust` 材料与空分支（统一用 `hasSwordDust` 布尔），要么开局消耗 `materialCounts['sword_dust']` 而非布尔；并仅按品质授予（如 `score >= 阈值`）。

### P1-10 投食配额「空投也扣次数」
- **位置**：`src/Game.ts:525-532`
- **问题**：`feedDropped` 无论实际落下几团都 +`FOOD_DROP_BATCH`(3)。剑域近满（天劫收束期）`dropFoodAtRandom` 失败时 `dropped=0` 但配额照扣。
- **修复方向**：`this.save.feedDropped += dropped;`（按实际成功数计）。

### P1-11 「罢了」返回主菜单后残留死局入口
- **位置**：`src/Game.ts:368-384`（`promptReseed` 的 no 分支只 `showMenu()`，不清 `activeRun`、不 `saveGame`）
- **问题**：存档仍 `activeRun=true` 且世界内无 seed 血脉 → 菜单继续显示「继续炼剑」，点进去立即再弹「本命血脉已绝」，死循环入口。
- **修复方向**：「罢了」时置 `activeRun=false` 并 `saveGame()`（视为放弃本局）。

### P1-12 大比得分 `hpRatio` 用 /100 而非 maxHp
- **位置**：`src/Game.ts:949-951`；`src/simulation/Duel.ts`（`maxHp = 70 + 坚韧×8`，最高可达 150）
- **问题**：满血坚韧 10 的剑 `hpRatio=1.5` 白拿 450 分封顶加成，脆皮剑只能拿 300；得分与坚韧线性挂钩。Duel 时间耗尽「比剑体」比较的是绝对 hp 而非比例，高 maxHp 天然占优。
- **修复方向**：`const hpRatio = playerHp / b.duel.p.maxHp`（或 clamp 到 [0,1]）；时间耗尽改比 hp 比例。另：`Duel` 本地 `MAX_ENERGY=100/ACT_COST=100` 建议抽到 `constants.ts`。

### P1-13 炉材面板显示与实际消耗口径不一致
- **位置**：`src/ui/DayPanel.ts:26`（`counts[m.id] ?? m.count` 缺键回退满额）vs `src/Game.ts:550`（`materialCounts[id] ?? 0` 缺键回退 0）
- **问题**：旧存档（已解锁但 `materialCounts` 未初始化）会显示「可用 ×N」、可点击，点击后 `applyMaterial` 直接 return —— 弹窗关闭、材料没消耗、玩家无反馈。
- **修复方向**：两处回退口径统一（都回退 0 并标「已耗尽」，或都回退 `m.count`）。

### P1-14 Duel 终结事件顺序颠倒
- **位置**：`src/simulation/Duel.ts:421-423`（`act` 尾部：`checkDeath(d, ev)` 先 push 'end'，后 push 攻击事件）
- **问题**：玩家会先看到「××剑体崩解，剑意陨落！—— 你 胜!」，然后才看到「你使出『××』，造成 N 点剑伤」，击杀动画/文字与胜负横幅错位。
- **修复方向**：先 push 攻击事件，再 `checkDeath`，让终结行最后渲染。

### P1-15 World ⇄ SwordAgent 运行时循环依赖
- **位置**：`src/simulation/World.ts:5`（`import { SwordAgent }`）；`src/simulation/SwordAgent.ts:3`（`import { World }`）
- **问题**：两个类运行时互相 import 并实例化（ESM 靠延迟求值恰好能跑），一旦任何一方在模块顶层触碰对方即 TDZ 崩溃。
- **修复方向**：将一方改为 `import type` + 接口注入，或用工厂/注册表解耦；或保持现状加注释说明环依赖边界。
- **注**：此前怀疑的「SwordAgent import toast」**不属实**——模拟层已通过 `eventBus` 的 `rareToast` 字段解耦，无 toast 导入。

---

## 🟢 轻微（P3）—— 死代码 / 一致性 / 健壮性

- **`battleMods` 系死代码**（`SwordAgent.ts:235-238, 377-379`）：`firstStrike/agile/quick/thunder/noCost` 从未被赋值；`firstStrike` 用 `world.tickCounter < 50` 在 Duel 场景无意义。`counterReady` 不是死代码（野外反击 ×1.5 真实生效）。
- **`mutationMult` / `modifiers.megaFood` 死修饰器**（`types/Environment.ts:18`、`World.ts:70`）：`mutationMult` 无读取；`megaFood` 从未置 true/读取（材料只调 `spawnMegaFood` + `aggressionBonus`）。
- **`Duel.events` 字段只写不读**（`Duel.ts`）：Game/BattleScene 只用 `step()`/`playerChoose()` 返回值，`events` 字段死状态。
- **`emitSplitEvents` 的 `changed` 参数未使用**（`World.ts:320`、`SwordAgent.ts:428`）。
- **攻击方反震致死不钳制**（`BattleResolver.ts:27` vs `:52`）：命中分支 `attacker.state.hp -= recoil` 不钳制，可 ≤0；闪避分支有 `Math.max(1, ...)`。攻击方整场不会被 `resolveBattle` 判死。
- **`tryCastSkill` buff 分支硬编码 `0.01`**（`Skills.ts:144`）：磐石护/百炼守/游龙步触发率 1%/tick，其余分支用 `castChance`(0.05)。若非有意防刷屏，应统一。
- **buff 施放条件要求 atk/def buff 同时为空**（`Skills.ts:141-143`）：同剑同时持有磐石护+游龙步时，任一 buff 生效期间另一技能被锁死。
- **`perceive()` 与 `nearestTarget()` 感知范围不一致**（`SwordAgent.ts:103` vs `:132`）：NN 能看到 20 格，本能扫描上限 10/20；`instinctBias` 用魔法索引 `input[25]`，输入维度调整易错位。
- **`swordIcon` 异步重绘竞态 + 无效释放守卫**（`swordIcon.ts:67-79`）：`canvas.width === 0` 判定永不成立；同一 canvas 重复绘制时上一帧 SVG `onload` 可能晚触发覆盖成上一场五行剑。
- **涌现 toast 8 秒窗口可跨局误指**（`Game.ts:620-621`）：toast 存活期间开新局，点击旧 toast 聚焦**新局**的代表剑；`focusSword` 不校验 `scene`。
- **`minimized` 死类**（`BattleScene.ts:328`）：只 add 不 remove，且 `style.css` 无 `.minimized` 规则。
- **`techTitle` 隐藏定时器不清理**（`BattleScene.ts:349-355`）：每个 `techName` 事件追加 950ms 定时器，同帧多事件时标题提前消失。
- **toast 无堆叠管理**（`modals.ts:33-43`）：稀有词条/解锁连发时多个 toast 重叠，`z-index` 高于 modal 遮挡弹窗顶部。
- **场景切换不销毁 renderer**（`Game.ts:127/135/794/840`）：`showMenu/showAppraisal/showTournament` 只 `hideCanvas()` 不 `destroy()`，残留粒子/技能监听；用 `window.__game` 手动 tick 时残留监听会操作隐藏 canvas。
- **`computeTags` 与 `BehaviorTag` 枚举不一致**（`types/Sword.ts:17-29` vs `Game.ts:747-756`）：枚举「掠食者/噬金者/…」从未被引用，实际标签「斩念成性/吞金成性/…」，枚举死代码。
- **「雷劫余生」用世界级开关**（`Game.ts:755`）：只要该局投过雷劫液，所有幸存者都带此标签；应改按个体被雷击次数。
- **`reseedLineage` 空位兜底可致覆盖占位**（`Game.ts:395-417, 425`）：24 圈找不到空位时 `addSword` 无条件写 grid，原格剑从网格「消失」成幽灵。`World.addSword` 缺占用校验。
- **`npcHp` 死变量**（`Game.ts:947`）：计算后从未引用。
- **`rank=0` 时 `computeRankUnlocks(0)` 误解锁**（`Game.ts:956-957`）：`findIndex+1=0` → `evaluateUnlocks(0)` 误发 `rankTop10`。当前流程下 `appraisedRanked` 不可能为 null，属防御缺口。
- **死代码**：`RankingManager.submit`、`randomSwordName`（`mathUtils.ts:59`）、`embryoElement`（只写不读）、`spawnFoodAround`/`spawnFoodAt`（`World.ts`）、`EVT.DAY_CHANGE/BATTLE_END/SAVE/EMERGENCE`（定义未 emit）、`EVT.DAY_START/POP_CHANGE`（emit 无监听）。
- **`chooseDailyDrop` 投放全失败时无日志**（`Game.ts:515-517`）：网格饱和时玩家选剑潮却毫无反馈，建议补「剑域已无立足之地」日志。
- **淬毒续毒不叠加**（`SwordAgent.ts:318-320`）：每次命中重置 `poisonTicks=30` 而非累积，属「续毒」非 bug，但需知晓。
- **`World.addSword` 不发 POP_CHANGE**（`World.ts:128-133`，与 `removeSword` 不对称）；`moveSword` 不校验目标格占用。
- **`shrink()` 不清理墙格上的食物**（`World.ts:415-436`）：食物留在墙内不可达且占 `foodCount` 配额。
- **`spawnCorpseFood`/`spawnMegaFood` 不检查 `foodMax`**（`World.ts:252, 400`）：尸体化食可把 `foodCount` 临时推超上限。
- **`randomWildGenome` 后期封顶**：day 10 时 `1+day×0.18≈2.8`，四项属性几乎顶到 `GENE_MAX=10`，后期野生剑谱同质化。
- **`applyMaterial('swordDust')` 分支空操作 + `DayPanel` 跳过该材料**（见 P1-9，双轨冗余）。

---

## ✅ 已排除的疑点（验证后不成立，勿重复排查）

| 疑点 | 结论 |
|---|---|
| `spawnInitialFood(10)` 疑似失效 | **已修复**：现为确定性放置（每份 24 次重试），开局正常撒满 10 团，与概率性 `spawnFood` 无关 |
| `Renderer.destroy()` 解绑失败 | **已修复**：现用字段级 handler，`off` 传同名引用，`Set.delete` 可命中 |
| modal × 按钮与遮罩双重触发 `onClose` | **不成立**：遮罩监听有 `e.target === overlay` 守卫，恰好触发一次 |
| 灵鉴剑谱有效值计算 | **正确**：kill5 锋锐+1.5 / fight15 坚固+1.5 / roam400 感知+2，与模拟层 `effectiveSharpness/Toughness/Perception` 口径一致 |
| BattleScene AP 条 `fill(ap/20)` 硬编码 | **不成立**：实为 `/100` 且 `Duel.ACT_COST=100`，正确 |
| HUD 时辰计算 `dayTick/80`、`(dayTick%80)/10` | **正确**：1 时辰 = 80 tick = 8 刻，与「1 日 = 12 时辰」吻合 |
| `fightsSurvived` 只在防守方 +1 | **按设计**：与 `attackCount` 求和为「总经历战斗数」，灵鉴显示与词条门槛一致 |

---

## 修复优先级建议

1. **P0（数据安全/核心正确性）**：P0-1 僵尸剑意 → P0-3 新局覆盖确认 → P0-4 `activeRun` 时序 → P0-5 history 无限增长 → P0-2 剑诀体系接通
2. **P1（玩法正确性）**：P1-8 无根水负面化 → P1-9 剑尘双轨 → P1-7 存档计时 → P1-1 HUD 泄漏 → P1-2 注入
3. **P2（体验/健壮性）**：P1-3/P1-4/P1-5/P1-6 存档一致性（lineage/生态/行为/迁移）→ P1-10 投食扣次 → P1-11「罢了」流程 → P1-12 hpRatio → P1-14 事件顺序
4. **P3（清理）**：死代码、注入、竞态、一致性小项
