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
| `src/audio/AudioManager.ts` + `sfxSynth.ts` | 音频管理器(BGM 切曲/暂停联动/静音) + Web Audio 合成音效 |
| `src/data/SaveManager.ts` | 存档结构 `GameSave`(改存档必看) |
| `src/ui/Renderer.ts` + `HUD.ts` | Pixi 画布渲染 + DOM 主界面 |

## 四、架构核心(30 秒版)

```text
src/
├── main.ts / Game.ts / constants.ts   # 入口 / 唯一编排者 / 全部平衡参数
├── audio/    # AudioManager(BGM/SFX/静音) + sfxSynth(Web Audio 合成音效)
├── types/    # Genome / Sword / Environment / Material
├── simulation/  # World / SwordAgent / NeuralNet / Genetics / BattleResolver / Duel / Skills / Chronicle(事件层) / SwordTale(剑谱) (完全 headless)
├── ui/       # Renderer / HUD / Menu / DayPanel / Appraisal / Battle / Ranking / Codex / SwordDetail / AchievementsPanel / taleView / swordIcon / modals / tooltip
├── data/     # RecipeDB / SwordArts / NPCs / SaveManager / RankingManager / AffixDB / Achievements
└── utils/    # mathUtils / eventBus / dom
```

**关键约定**：

- `src/simulation/` 完全 headless——**禁止直接 import DOM/toast**，一律走 `eventBus`(如 `rareToast` 字段)。
- 事件总线 `eventBus.ts`：`LOG/DAY_START/POP_CHANGE/TRIBULATION_END/BATTLE_HIT/SPLIT/DEATH/EAT/THUNDER/SKILL` 等；`emit` 已 try-catch 不中断主循环。
- 时间：1 日 = 12 时辰 = 960 tick；1x 速度 = 4 tick/秒(一天约 4 分钟)。主循环基于 `tickAccumulator` 节流。
- 战斗双轨：世界场 = 移动碰撞瞬间结算；大比 = Duel 引擎(数值×5)。

## 五、核心玩法机制

1. **择剑胚**：五行五选一，选后 `startNewRun(element)`。**v2.0.0 五行差异化**：初始剑谱按模板（上限 10）——火 8/4/5/5（爆发·杀性 0.55-0.8 嗜战追杀）、木 5/6/6/6（均衡·杀性 0.35-0.47 温和·**淬毒/毒木反噬专属**）、土 5/9/3/5（铁壁·慢·杀性 0.35-0.47 温和·**厚土反震**）、金 6/5/8/5（快剑·杀性 0.5-0.7 好战）、水 5/6/6/7（感知·杀性 0.4-0.55·**生生不息**：回血 ×2.0 WATER_REGEN_MULT + 采食回能 ×1.35（v2.1.0 已移除受击减免 15% 与耗神 -15%，食物效率已足够支撑水系立足））；游离剑意（剑潮）亦按模板+天数强度。伤害公式 `max(1, ceil(攻伐×0.35), 攻伐−坚韧×0.4)`（追击锁定再 +30%）；杀性驱动追击执着度，主动攻击门槛 0.4。**水存活关键**：死因多为饿死（能量耗尽），采食回能 ×1.35 是决定性修复（headless 水存活从垫底升至前列）。**土系厚土反震**：`BattleResolver` 守方土系时反震 = 伤害×0.8（不受追击减半），反震磨死攻击者计土系 killCount（被动击杀路径，headless 土系 3/3 局晋升、存活王）。
2. **炼剑十日**：随时**布霖**(原「投食」，v2.3.0 改名，每日 12 团)、炉材道具化(次数制)、每日子时剑潮(mild/tide/fierce/none/auto)——v1.10.0 起弹窗默认高亮上次选择 + 6 秒倒计时(超时沿用上次/首日静待天时)，可勾选「本局一直用此选择」免弹窗(存档 `dailyDropKind`/`dailyDropLocked`，新局重置、续玩保留)。v1.11.0 起 HUD 底栏新增「剑潮」按钮可随时改偏好(下次子时生效)、「重种本命」按钮(本命灭绝可手动种回)；「本命血脉已绝」弹窗三选项(重新种下/暂不重种/罢了)且同日内限弹 1 次。**v2.3.0**：HUD 新增「布阵」按钮（地图编辑：熔岩/深水/清除/奇遇种子，次数由炉材提供，天劫期禁用）；重种弹窗内嵌五行卡片（默认高亮当前五行，可改选，重种后同步 `embryoGenome`/存档）；每日子时奇遇种子低概率随机显现（`ENCOUNTER_SEED_DAILY_CHANCE=0.15`）。
3. **涌现**：剑意数 ≥20(`EMERGENCE_THRESHOLD`)且世代 ≥6(`EMERGENCE_MIN_GEN`)→「自成气候」，可点击聚焦。
4. **天劫**：第 10 日食物停生、边界向内收缩(每 8 tick 一格)至 **4×4**（v2.1.0：**最终留场**——给落雷/战斗特效展示空间；到 4×4 后不再缩墙、不再落雷，防天雷误杀决胜）；收缩同步**全领域天雷**（伤害 28/耗精元 12，道数受**场地面积钳制**：区域越小越稀疏）；边缘剑意**向内挤入**（不再墙杀：原位向中心退一步压缩，**挤入遇阻直接争斗**、败者弹开）；**天劫临时杀性**：`TRIBULATION_AGGRESSION_BONUS=0.4` + **恐惧本能失效**（`SwordAgent.instinctBias` 天劫收束期间不逃离）——困兽犹斗、谁都要争夺；**天劫期间血亲亦相争**（`kinProtected()` 在 isShrinking 时失效）；**斗至最后一柄**：只剩 1 柄即结束，`TRIBULATION_MAX_TICKS=1 日` 超时强制收束兜底（多幸存者时鉴定取最优）；幸存者评本命剑；v1.10.0 起失败(无幸存者)弹「剑意尽灭」界面(存活峰值/全灭日 + 重新炼剑快捷入口)，仍不得剑尘。headless：无干预/扶持 **18/18 恰好 1 柄胜出、零尽灭、零超时**；扶持胜者含忘我/洞玄。
5. **剑成鉴定**：评分 = 存续×10 + 血脉相承×20 + 剑谱总和×0.5 + 本性殊异(≤15)。
6. **宗门大比**：AP 半即时制 Duel，选对手 + 剑诀(strike/counter/agile/quick/thunder)，词条/技能联动。
7. **万剑榜**：前 20 名，`history.length>=3` 后按排名解锁新材料。
8. **剑尘(遗蜕)——v2.0.0 已下架**：整套移除（存档 `swordDust`/主菜单显示/开局淬入 +0.5 四维/炼成 +1 全删）。**重新设计待办**：主菜单「剑尘商店」，给本命剑兑换本局技能/自定义（大工程，见「九、待办」）。
9. **剑心境界(v2.0.0 / v2.1.0)**：凡心→通明→洞玄→忘我。**只看击破**（击杀数 ≥**2/3/5**，v2.1.0 由 1/3/6 调高、5 杀可达忘我）即开悟，不看历经（v2.0.0 由「历经或击破」→「历经且击破」→「仅击破」；配合**残血追击锁定**：`SwordAgent.huntTargetId`——接战未击杀锁定追杀、追击时每 tick 双动，至击杀/逃离视野/自身重伤，headless 扶持局 3/4 可见通明）。**v2.1.0 等级压制**：高境对低境攻击者每境差免伤 12%（`MIND_REALM_DMG_REDUCTION`，野外 `BattleResolver` + 大比 `Duel` 统一）；晋境瞬间**剑体回满 + 精元≥50**（顿悟回春）；击杀**以战养战回血 15% 上限**（原 +5）。`SimpleNN.expandHidden` 隐藏层 8→10→12→16（新权重置 0，靠突变调优），精元消耗 -5/-10/-15%、技能触发 ×1/×1/×1.25/×1.5；宗门大比四维 +0/+0.5/+1/+2 且剑体上限随加成后坚韧。**剑心绝技(v2.0.0)**：晋升奖励绝技——通明 3 选 1 / 洞玄 3 选 1（两池各 3 互不重复）/ 忘我固定大招（`MIND_SKILL_POOLS`/`MIND_SKILL_ULT`）。**本命血脉(origin=seed)晋升弹窗 3 选 1**（`SwordAgent.pendingMindPick` + `Game.promptMindPick`，Game.update 轮询检测；选完自动恢复走时）；**外来剑意随机抽**。绝技存 `SwordState.mindSkillIds`，随血脉遗传（`spawnChild`/`spawnParasite`），大比 `buildTechniques` 含绝技招式。**注意**：`exportSave` 从活 brain 取权重（剑心扩容后 state 快照过期）；`continueRun`/`agentFromState` 按 `mindRealm` 推导隐藏数重建 NN（`mindSizes`）；`skillsFor` 缓存 key 已含 mindSkillIds。
10. **血亲不相攻(v1.12.0)**：`World.isKin`（lineage 链根相等，`rootCache` 缓存）——本能/选敌/技能弹道/AoE 全部排除血亲，相撞视作阻挡绕行（不战斗、不寄灵）。注意：重种后的新本命是**新链根**，与旧血脉链不相亲；rootCache 依赖 lineage 只增不删。
11. **技能击杀计击破(v1.12.0)**：`Skills.damageSword(attacker,…)` 击杀时 `killCount++` + 尸身化食 + 以战养战回能回血 + 寄灵转化（与近战一致）；技能命中**不加** `attackCount`（护 fight15/淬毒稀有度）。
12. **宗门大比改版(v2.0.0)**：结算面板（胜负/分数/连胜/万剑榜排名/解锁），**失败「再战」**重打当前对手（`BattleUI.setResult` 加 actions 参数），连胜指示 `Game.battleStreak`（胜 +1、败断连）。
13. **万剑谱(v2.0.0)**：`GameSave.swordCodex`（独立收藏 ≤5 柄，默认 []，`SaveManager.load` 兜底）。大比**首胜**后本命剑入谱（`Game.addToCodex`，按 id 去重）；满 5 弹**5 槽位替换**（`promptCodexReplace`——已有槽点击替换、空位点击新增，被替换者从谱中消失）；谱中旧剑作为大比对手（`showTournament`/`findOpponent`，「旧我 · 万剑谱」难度 ×1.25，跨局持久）。万剑榜 `history`（前 20/排名/解锁）**保留不动**。
14. **灵鉴即暂停(v2.0.0)**：`Game.focusSword` 打开灵鉴=暂停，**关闭后保持暂停**（onClose 不再恢复），玩家点速度档恢复走时（`refreshHudControls` onSpeed 已有 `if(paused) paused=false`）。3 选 1 弹窗等晋升流程选完自动恢复（区别于灵鉴）。

**属性语义(v1.6.0 起；v2.0.0 攻击属性「锋锐」改名「攻伐」防与五行「金」混淆)**：攻伐=攻击(含暴击)、坚韧=防御、感知=闪避率+视野、速度=蓄条/大比出手(世界内由 `speedBonus` 材料提供移动加速)、杀性=凶性(暴击)、策略=孤狼/合击。

**词条系统**(`AffixDB.ts`，存于 `Genome.affixes` 可遗传)：eat30 吞金(采气≥20) / kill5 斩念(击破≥3) / fight15 百炼(历经≥25战) / roam400 游历(足迹≥350 且密度≥0.35/tick，即每时辰≥28 格) / poison 淬毒(**v2.0.0 木行专属**：木+存续≥2500+历经≥15战；毒伤 2/36tick；**毒木反噬**——淬毒木剑被攻击时攻击者反中毒，BattleResolver) / parasite 寄灵(rare，木行+合击+世代≥4)。判定在 `SwordAgent.recheckAffixes()` 每 tick 参悟。**v1.8.0 门槛放宽、v1.9.0 淬毒加行为要求(存续2500/15战)、v1.11.0 百炼 25 战 / 游历改足迹密度(苟活久者不悟)、v2.0.0 淬毒归木系**。

**剑意技能**(`Skills.ts`)：五行天赋**每行 2 技**(主+辅，v1.8.0 扩充)——金[剑气斩+金罡体]/木[回春术+青藤缚]/水[瞬水步+惊涛斩]/火[焚天爆+烈焰甲]/土[磐石护+地脉震]；词条衍生 6 技。灵鉴「剑技」区块与宗门大比招式同源(`Duel.buildTechniques`，上限 5 招)。**v2.3.0 机制差异化**（同类技能不再只是数值差）：青藤缚命中**定身**（`rootedTicks`）、惊涛斩**击退**（`knockback`）、焚天爆命中**灼烧**（`burningTicks`）+余烬化**火墙**（v2.4.0：自爆心扩散至半径 5、灼烧扫过之敌后消散——不留地形、不困自身）、地脉震**减速**（`slowedTicks`）、金罡体/百炼守**反震**（`reflectPct`）、磐石护**免控**（`immuneCCTicks`）、烈焰甲**附火**（`flameArmorTicks`）。控制字段全在 `SwordState`（运行时可选字段），`Skills.tickCombatStates` 递减；`BattleResolver`/`Skills.damageSword` 统一接入反震/附火。**v2.4.0 施放重构**：**独立冷却**（`agent.skillCds` 按技能各算、运行时字段不序列化，读档重置；不再共用 `skillCd` 饿死高等级技能）+ **情境智能评分选技**（`tryCastSkill`：多敌→范围、单敌→单体、残血→回血/逃跑优先；评分 = 等级优先级（忘我大招 3 > 通明/洞玄绝技 2 > 天赋/词条 1）×10 + 情境加成 + 抖动，选最高分，以最高分技能概率放行——高等级 CD 长但出手更勤）。

**剑域地形与奇遇(v2.3.0)**：`World.terrain` 层（`TerrainType='lava'|'deepwater'` + `terrainSet` 增量集合 + `terrainExpiry` 临时地形队列，随 `exportEcoState` 序列化）。**熔岩**=一步踏入即死（`performMoveTo` 顶部判定）、视作壁垒避让（`isWall` 含 lava）、饥饿执念小概率犯险（`LAVA_DESPERATION_CHANCE`）、瞬移/击退可渡（落地/被击入熔岩即死）、立于其上超一完整 tick 即死；**深水**=可通行但减速（`mired` 概率受阻）+ 耗精元 ×1.5（水行免疫）。**奇遇种子**=`World.encounterSeed`（单颗），`placeEncounterSeed`/`claimEncounterSeed`（`moveSword` 踏入/瞬移自动触发），取得 → `SwordAgent.grantMindRealm`（境界+1，复用 `applyMindPromotion`，忘我后化灵力补满）；剑意强吸引（instinctBias 权重 1.6）；瞬移技能在种子 6 格内直取种子格。**奇遇灵种是独立投入物**——`formationSeed` 炉材授予 1 次布阵之数（非直接放置），玩家在布阵模式（暂停）自主选位种下，可自选是否以熔岩/深水封锁。**布阵 UI**：HUD「布阵」→ `Game.toggleFormationMode`（暂停+单行紧凑工具栏+点画拖动），笔刷=熔岩/深水/恢复/奇遇种子（`FORMATION_TIPS` 悬浮说明）；**熔岩/深水/恢复均不限次**（`clearTerrain` 去熔岩/深水/临时火海），仅奇遇种子计次（`GameSave.formation.seed`）；**v2.4.0 恢复笔刷范围化**——一次清除 3×3 邻域；**布阵模式下画布下移让位（`.forge-screen.forming .canvas-host` padding-top），工具栏不遮挡剑域**；天劫期禁用。**手动天雷（v2.3.0 / v2.4.0 范围雷暴）**：雷劫液（**v2.4.0 初始拥有直接解锁**）→ `Game.lightningArmed` → 点击画布 → `World.strikeLightning`（**v2.4.0 半径 2 曼哈顿范围 AoE**：范围内剑意 -28/-12，致死 die、幸存标 `survivedThunder`「雷劫余生」；**v2.5.0 返回击杀数**供成就「雷神降世」；**闪电劈落 + 范围雷暴特效**，天劫落雷同享）。

**剑域纪事与剑谱（v2.5.0，事件采集层）**：`World.chronicle`（`src/simulation/Chronicle.ts`）结构化记录本局所有关键事件（birth/firstKill/kill/death/promotion/affix/mindSkill/encounter/thunderSurvive/nadir/emerge/tribulation + 玩家操作 feed/material/formation/lightning/tide/reseed），**纯数据 headless、只存内存不持久化**；**`SwordAgent.die(cause?, killerId?)`**——13 处调用点标注死因（starve/melee/skill/counter/lava/thunder/poison/burn/wound），反震致死经 `lastHitBy` 归因（counter），击杀经 `World.recordKill` 记录（含血亲标记/首杀）。**剑谱 `writeSwordTale`**（`src/simulation/SwordTale.ts`，seeded PRNG 选措辞、确定性稳定）：天劫收束后生成「出身→重大纪事（drama≥3 逐条一行）→总结评语（评分四档+经历维度）→完整纪事（可折叠）」；命名实时联动、随 `RankedSword.tale`/`PendingAppraisal.tale` 存档回看（`openTaleModal`）；败局 `writeDefeatNote` 生成「剑域札记」当场展示。**成就系统**（`src/data/Achievements.ts`，14 个，判定全部来自 chronicle + `GameSave.stats` 累计）：`Game.accumulateStats`/`Game.checkAchievements` 在 `endTribulation`（成败皆结算）与 `finishAppraisal`（万剑之王按 rank）调用；主菜单「成就」面板 `AchievementsPanel.ts`。**坑**：成就与现有规则冲突者一律不做（灭门惨案/五行逆转/师慈徒孝）；`RankedSword` 的 `tale` 字段非空时条目可点击回看；剑谱内容止于剑成、大比战绩不入谱。

## 六、炉材一览(RecipeDB)

| 材料 | 效果 | 次数 |
| --- | --- | --- |
| 千年寒铁 | 庚金生成 +40% | 4 |
| 无根水 | **全体身法 +0.5(每 tick 有几率额外行动一步，移动更迅疾)** | 3 |
| 御风符 | 温度→清风(能耗 -40%) | 3 |
| **奇遇灵种 (v2.3.0)** | **获得 1 次「奇遇种子」布阵之数（布阵模式自选位置种下，取得者剑心境界+1）；万剑榜前10 解锁** | 1 |
| 《快剑总纲》残篇 | 分化速度突变率 ×3 | 2 |
| 《重剑无锋诀》 | 分化坚固突变率 ×3、速度突变率降 | 2 |
| **雷劫液 (v2.3.0 / v2.4.0)** | **手动天雷（v2.4.0 初始拥有直接解锁）：使用后武装一次引雷，点击剑域任意处降雷——闪电劈落、范围雷暴（半径 2 内剑体-28/精元-12，可击杀；幸存者标「雷劫余生」）** | 2 |
| 陨星铁母 | 撒超高能量食物 + 攻击欲望 +0.3 | 1 |

> v2.3.0：「投食」改名「**布霖**」（全量替换按钮/日志/注释）；**熔岩/深水/恢复布阵不限次数**（已删「扶桑火种/赤地灵契/玄冥真水」）；「雷劫液」由全图被动雷劫改**手动天雷**（`World.strikeLightning`，废弃 `modifiers.thunderstorm`）；布阵系仅「奇遇灵种」计次（`GameSave.formation.seed`）。

## 七、调试

- `main.ts` 暴露 `window.__game`(Game 实例)，浏览器 console 可直接驱动：`g.startNewRun('fire')`、`g.world.tick()` 循环快进、`g.endTribulation()` 等私有方法运行时可访问。另暴露 `window.__audio`(音频单例：`playSfx(id)`/`setBgm(track)`/`bgmEl` 可读)、`window.__eventBus`(可 emit 事件测音效链路)。
- headless 验证：动态 `import('/src/simulation/World.ts')` 在浏览器 console 构造世界批量测试。

## 八、工作流约定(务必遵守)

1. **每次 git 提交** 必须先在 `CHANGELOG.md` 顶部新增版本说明，commit message 附版本号。
2. **版本号规则（v1.12.0 起定）**：**十进制滚动，9 进 1**——功能新增 → 末位递增（1.0→1.1→…→1.9→**2.0**），**不要出现 1.10/1.11/1.12 这类写法**；仅修复/微调 → 末位 +1（如 2.0.1）。历史 1.10~1.12 为旧规遗留，本次维持 v1.12.0，**下一功能版本为 2.0**。
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

- **剑尘商店（v2.0.0 构想，大工程）**：主菜单开「剑尘商店」——用剑尘（炼成/大比奖励）给本命剑兑换本局技能或自定义强化。当前剑尘系统已整套下架，待新设计落地（见「五.8」）。
- **技术债**：
  - ~~`World⇄SwordAgent` 运行时循环依赖~~ ✅ v1.9.2 已打破（`SwordAgent` 对 `World` 改 type-only import，编译期擦除）。
  - ~~`RankingManager.submit` 未接入~~ ✅ v1.9.2 已接入 `finishAppraisal`（`submit()` 现返回排序截断后的 `list`）；`finishBattle` 的「更新既有 entry 重排」语义不同，保持内联。
  - ~~`embryoElement` 只写不读~~ ✅ v1.9.2 已删除（`embryoGenome` 已含 element）。
- **素材 TODO**：字体(等 woff2)、水墨背景已接(`pic/` → `public/img/battle/`)。**音频 ✅ v2.2.0**：三场景 BGM(`public/audio/bgm/menu|forge|battle_theme`，带 `[前缀]` 文件名，代码 `encodeURI` 引用)+ Web Audio 合成 8 音效(`src/audio/sfxSynth.ts`)。**v2.3.0 音量设置 ✅**：`src/ui/AudioPanel.ts` 面板（主菜单/大比「音律」入口），背景乐/音效 开关+音量滑块，持久化 `swordforge-audio-v1`（`AudioManager.musicVolume/sfxVolume`，BGM 有效音量 = 开关×滑块×0.4）。
- **观察项**：~~`randomWildGenome` 后期属性顶格同质化~~ ✅ v1.9.1（scale 0.18→0.12：wild 顶格 67%→15%、fierce 去 day+1 且加成下调 54%→36%；平衡复验 无干预 6.83 / 扶持 14.25）；~~感知范围不一致~~ ✅ v1.9.1 提取 `INSTINCT_RANGE=10` 自文档化（行为不变）；~~buff 触发率硬编码 0.01~~ ✅ v1.9.1 提取 `BUFF_CAST_CHANCE=0.01`（行为不变）；~~「雷劫余生」世界级开关~~ ✅ v1.9.1 改个体 `survivedThunder`。
- **v1.10.0 新功能（已完成）**：失败弹窗（峰值/全灭日+重新炼剑快捷入口）；炼剑界面分类条（五行 + 本命/外来实时统计）；剑潮弹窗升级——本局记忆 `dailyDropKind`（默认高亮上次）+ 6 秒倒计时（超时沿用上次/首日静待天时）+ 免弹窗勾选 `dailyDropLocked`（存档字段，新局重置、续玩保留）。
- **v1.11.0（已完成）**：悟道之树不再把外来剑拼成本命后代（链根非 rootId 时树根显示「外来剑意」）；血脉断绝弹窗三选项+同日内限弹 1 次+HUD「重种本命」；HUD「剑潮」偏好面板（随时改选择/免弹窗）；词条重设——百炼 25 战、游历改足迹密度(≥350 且 ≥0.35/tick)（headless：无干预 avg 6 / 扶持 avg 13）。

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
- **World 增量集合(v1.8.1 / v2.3.0 加 terrainSet)**：`World` 维护 `foodCells`/`wallCells`/`terrainCells` 三个 `Set<number>`(键=`y*width+x`)，渲染端只遍历集合而非全网格——**新增/移除食物/墙/地形的逻辑必须同步维护这些集合**(`spawnFood`/`removeFood`/`spawnCorpseFood`/`spawnMegaFood`/`spawnFireWalls`/`shrink`/`wallExpiry`/`setTerrain`/`clearTerrain`/`terrainExpiry`/`restoreEcoState` 等处)。**熔岩**同时要顾及 `isWall`(视作壁垒)、`performMoveTo` 踏入即死、`SwordAgent.tick` 停留致死、生成逻辑避让。
- **特效系统(v1.9.0)**：野外 `Renderer` 三层特效——粒子 `spawnBurst` / `effects` 弹道环束(proj/ring/beam，`updateEffects`+`drawEffects`) / `floatTexts` 飘字(Pixi Text，上限8、destroy 清理)，**全部技能(projectile/aoe/line/heal/buff/teleport)施放均有技能名飘字**；buff 常驻光环与淬毒绿闪边在 `drawSword()` 直接读剑状态每帧绘制。大比 `BattleScene.playFx()` 按 `DuelFx` 播 DOM 特效(`.duel-fx` CSS)，strike 类(锋行/青藤缚等)也有基础斩击弧光。新增特效保持同款：字段级 handler、destroy 清理、飘字上限。
- **存档时机**：除 5s 自动 + 事件触发外，`pagehide`/`visibilitychange(hidden)` 会再存一次(iOS `beforeunload` 不可靠)，防关页丢进度。
- **剑心境界序列化(v1.12.0)**：`SwordState.mindRealm` 决定 NN 隐藏层容量——**`SimpleNN.sizes` 已改可变**；剑心扩容（`expandHidden`）后必须同步 `state.brainWeights/brainBiases`（`checkMindRealm` 内已做），且 `Game.exportSave` 从**活 brain** 取权重（不要用 state 快照，扩容后会过期）；重建 NN 一律用 `mindSizes(realm)`（Game.continueRun/agentFromState）。
- **全局浮窗(v1.12.0)**：`src/ui/tooltip.ts` 的 `initTooltips()` 在 main.ts 初始化一次——`.tip[data-tip]` 由 document 级委托接管，body 级单一 `fixed` 提示层（视口钳制、滚动/点击即隐藏）。新 `.tip` 元素无需额外处理；别再给 `.tip` 写 `::after` 伪元素浮窗（滚动容器内会被裁剪）。
- **血亲缓存(v1.12.0)**：`World.rootCache`（id→链根）依赖 lineage **只增不删**——勿清理 lineage 条目；重种本命产生新链根，与旧血脉链不相亲（语义如此）。

## 十一、文档维护日志

> AI 每次维护本文件后，在**顶部**追加一条（日期 + 一句话说明）。

- **v2.5.0（2026-08-13）**：剑谱叙事系统（剑成鉴定生成修仙风剑谱：出身/重大纪事逐条/总结评语/完整纪事折叠；seeded 措辞、命名联动并随名剑回看；败局「剑域札记」）+ 成就系统（14 个：叙事/运营/涌现/累计，主菜单面板 + 结算 toast）。共用事件采集层 Chronicle（`die(cause?, killerId?)` 死因溯源、`strikeLightning` 返回击杀数、出生/击杀/晋升/词条/绝技/奇遇/雷劫余生/濒死/涌现/天劫 + 玩家操作事件）。**v2.5.1 增强**：剑心绝技特效大场面化（rain 剑雨效果类型 + boltFx/ringsFx/rainFx，万剑朝宗全屏剑雨四重冲击环等 7 技各有专属）；剑谱文案修正（孤剑「走完十日」按存续≥0.9 才用、血脉后裔不叫「半途入局」、完整纪事只收本命剑事件 + 奇遇显现、击杀按方式描述且去「有主之剑/血亲相残」、分化注明母剑主语——新增 `split` 事件母剑视角）；重大纪事含每次分化/击杀（上限 18 条）；奇遇——`placeEncounterSeed` 补记显现 + `ENCOUNTER_SEED_DAILY_CHANCE` 0.15→0.25 + **奇遇灵种初始解锁（encounter_seed 入 START_UNLOCKED）+ 新局自带 1 次奇遇种子布阵之数**（Game.doStartNewRun formation.seed 初始=1）。headless：无干预 8-14 / 扶持 47-51；奇遇 5/5 显现即取得。

- **v2.4.0（2026-08-12）**：焚天爆余烬化火墙（自爆心扩散灼烧后消散，不留地形、不困自身）+ 恢复笔刷 3×3 + 雷劫液初始解锁 & 手动天雷范围雷暴（半径 2 AoE + 闪电劈落特效）+ 剑意技能重构（独立冷却 / 情境智能 / 高等级优先）。headless：无干预 7-8 / 扶持 53-73、天劫 3/3 一柄胜出。

- **v2.3.0（2026-08-12）**：剑域布阵（地形层 熔岩/深水 + 地图编辑 UI + 布阵次数炉材化）、奇遇种子（剑心境界+1、熔岩封锁瞬移可渡）、重种本命可选五行、布霖改名、技能机制差异化（定身/击退/灼烧+火海/减速/反震/免控/附火）、**音律设置**（主菜单/大比「音律」面板：背景乐/音效 开关+音量滑块，持久化 `swordforge-audio-v1`）。headless：无干预 avg 5.8 / 扶持 avg 50.8（与历史基准一致，零崩溃），完整十日+天劫 3/3 一柄胜出。

- **v2.2.1（2026-08-12）**：全量代码审计修复——炉材次数读档清零/技能垂直打偏/火墙永久存在/音效增益节点泄漏（高）；死亡判定提前（诈尸回春/僵尸剑）、近战与天劫击杀补发 DEATH、大比暴击率 clamp、剑心通明大比守御化、离场销毁 HUD 与舞台（中）；HUD 每帧 DOM 写入缓存、粒子 Graphics 显式销毁、榜单去重、存档版本宽容、灵鉴防重入、battleAccumulator 清零、死代码清理（低）。headless 冒烟 5 局全部天劫 1 柄胜出。

- **v2.2.0（2026-08-11）**：音频系统（三场景 BGM + 8 合成音效 + 静音开关 + 场景预载/弹窗不中断 + `__audio`/`__eventBus`）；**剑心升级上限 +50/境**（剑体/精元凡心 95/80→忘我 245/230，晋境补满，分化阈值随上限，子代继承）；**天外凶潮投洞玄剑意**（主动选凶潮：剑心 2 级 + 随机洞玄绝技 + 上限抬升，打破种群优势；auto 默许天意仍投凡心）；**击破可及**（碰撞伤害提高 0.4/0.35 + MAX_HP 95，野外可致死、剑心晋升可达）；**分化修复**（采食 clamp 致能量卡 79.98 永不分化——移除 clamp）。headless：无干预 2/3 涌现、天劫 3/3 一柄胜出。

- **v2.1.0（2026-08-11）**：剑心等级压制（门槛 2/3/5 + 高境免伤 12%/境 + 顿悟回春 + 以战养战 15%）；水系摘除受击减免/耗神 -15%（聚焦回血×2 + 采食×1.35）；天劫改版（向内挤入不再墙杀 + 挤入遇阻争斗 + 天劫血亲亦相争 + 天劫临时杀性 +0.4 & 恐惧失效 + 全领域天雷面积钳制 + 最终留场 4×4 + 斗至最后一柄 + 超时兜底）。
- **v2.0.1（2026-08-11）**：README 顶部「当前版本」同步至 v2.0.0（此前滞留 v1.12.0，纯文档同步、无代码改动）。
- **v2.0.0（已完成）**：剑心绝技系统（通明/洞玄 3 选 1 + 忘我大招，共 7 技 + 专属粒子 + 剑意随境界变大）；剑心晋升**只看击破**（击杀 ≥1/3/6，不看历经）+ 残血追击锁定（双动/反震减半/伤害 +30%/杀性驱动执着）；五行差异化（模板上限 10 + 杀性分层 + 伤害公式保底 + 土**厚土反震** + 木**淬毒/毒木反噬** + 水**生生不息**回血采食）+「锋锐」改名「攻伐」；宗门大比改版（结算面板 + 失败再战 + 连胜 + 首胜入**万剑谱** ≤5 可替换、旧剑作跨局对手）；灵鉴关闭后保持暂停（点速度档恢复）；剑尘整套下架 + 待办「剑尘商店」构想。
- **v1.12.0（已完成）**：剑心四境（NN 隐藏层 8→10→12→16 扩容 + 精元折扣 + 技能触发加成，大比四维 +N 战力优势，子代继承）；血亲不相攻（lineage 链根判定，本能/技能/AoE 排除）；技能击杀计入击破 + 尸身化食/以战养战/寄灵；剑潮免弹窗卡死修复 + 自动投放 toast；灵鉴浮窗改 body 级 tooltip（防裁剪）；剑尘改计数（上限 9，主菜单显示）；觅食调整（食物权重 1.0 + 近距强采食）；分化排查（条件=精元满 80，灵鉴注明；觅食增强后约半数剑意分化）。平衡新基线：无干预第 9 日存活 ~20-28 柄（用户不要求维持旧 6/14）。
- 2026-08-10 v1.11.0：悟道之树外来血脉不再拼接本命(rootId)（树根显「外来剑意」）；血脉断绝弹窗三选项+同日内限弹 1 次+HUD「重种本命」「剑潮」按钮；词条重设——百炼 25 战、游历改足迹密度(≥350 且 ≥0.35/tick)更稀有（headless：无干预 avg 6 / 扶持 avg 13）。
- 2026-08-10 v1.10.0：失败弹窗(峰值/全灭日+重新炼剑快捷入口)、炼剑界面五行+本命/外来分类条、剑潮弹窗升级(本局记忆上次选择+6 秒倒计时超时沿用/首日静待+免弹窗勾选)、存档新增 `dailyDropKind`/`dailyDropLocked`。
- 2026-08-10 v1.9.2：技术债——打破 `World⇄SwordAgent` 循环依赖(type-only import)、`finishAppraisal` 接入 `RankingManager.submit`(现返回 list)、删除只写不读字段 `embryoElement`。
- 2026-08-10 v1.9.1：wild 顶格同质化修复(scale 0.18→0.12，wild 67%→15%、fierce 54%→36%；平衡复验 无干预 6.83/扶持 14.25)、「雷劫余生」改个体 `survivedThunder`、感知/本能范围(`INSTINCT_RANGE`)与 buff 触发率(`BUFF_CAST_CHANCE`)提取常量自文档化。
- 2026-08-10 v1.9.0：技能特效全面强化(野外 buff 常驻光环/全技能飘字/命中爆点/淬毒绿闪边；大比回春护盾淬毒寄灵天门破游龙重击与基础斩击全加强+飘字+受击闪光) + 暂停态点倍率自动恢复走时 + 灵鉴弹窗可滚动 + 刷新续玩(鉴定/大比可经「继续炼剑」恢复) + 淬毒词条门槛加行为要求(存续≥2500/历经≥15战)修正稀有度(凶潮 2.9→0.7 柄/局)。
- 2026-08-10 v1.8.1：修复击杀后攻方不占格/鉴定标签门槛与词条不一致/闪避反震回血/大比自伤不判负；性能优化(渲染增量集合 foodCells/wallCells、消除重复全盘扫描、洗牌复用、技能缓存)；Markdown lint 清理 + 新增 .markdownlint.json。
- 2026-08-10 v1.8.0：技能系统扩充(五行每行 2 技 + 大比招式上限 5) + 词条门槛放宽(eat30/kill5/fight15/roam400/淬毒/寄灵) + 修复鉴定命名 UI(标签/边框/点击反馈) + finishAppraisal 空名兜底 + 觅食本能 0.7→0.85 与惯性减半(修剑意兜圈/无视食物) + 鉴定页属性/评分/特质说明浮窗。
- 2026-08-10 v1.7.0：外测发布准备——DPR 钳制 2x + 画布 touch-action、移动端 100dvh/safe-area、pagehide 关闭前自动存档、BattleScene/swordIcon 改 BASE_URL 路径、bg_1.png(4.2MB)→bg_1.jpg(168KB)、favicon、新增 vite-env.d.ts；部署接 Vercel。
- 2026-08-10 v1.6.2：处理暂缓设计决策——剑尘改为「炼成才得、失败不得」并移除 `sword_dust` 炉材；清理 `randomSwordName`/`BehaviorTag` 死代码；`computeRankUnlocks(0)` 防御、`moveSword` 占用校验、`shrink` 清墙内食物、尸食设硬上限；删除已完成的 `bugfix.md`。
- 2026-08-10 v1.6.1：新增「八.5 自我维护约定」与本章节；记录无根水身法生效、淬毒门槛调整、僵尸剑意/剑诀/存档类修复、AI_HANDOFF.md 建立。
