import { Application } from 'pixi.js';
import type { Element, Genome, RankedSword, SwordState, MaterialUnlock } from './types';
import { World } from './simulation/World';
import { SwordAgent } from './simulation/SwordAgent';
import { SimpleNN } from './simulation/NeuralNet';
import { WorldRenderer } from './ui/Renderer';
import { HUD, type FormationBrush, type MaterialItem } from './ui/HUD';
import { buildMenu, buildEmbryoSelect, buildElementCard } from './ui/MenuScene';
import { buildMaterialAura, openDailyDropPanel, openTidePanel, type DailyDropKind } from './ui/DayPanel';
import { openAudioPanel } from './ui/AudioPanel'; // v2.6.1：炼剑界面音律面板（背景乐/音效 开关+滑块合一）
import { buildAppraisal, type AppraisalData } from './ui/AppraisalScene';
import { writeSwordTale, writeDefeatNote } from './simulation/SwordTale';
import { buildTournament, type BattleUI, type OpponentInfo } from './ui/BattleScene';
import { openSwordDetail } from './ui/SwordDetail';
import { openRanking } from './ui/RankingView';
import { openCodex } from './ui/CodexView';
import { openAchievements } from './ui/AchievementsPanel';
import { ACHIEVEMENTS, evaluateNewAchievements, type AchievementCtx } from './data/Achievements';
import { SaveManager, defaultSave, buildGameSave, type GameSave } from './data/SaveManager';
import { getMaterial, RECIPES, recipesSorted, unlockLabel } from './data/RecipeDB';
import { RankingManager } from './data/RankingManager';
import { SWORD_ARTS } from './data/SwordArts';
import { NPC_OPPONENTS } from './data/NPCs';
import { getMap, MAPS, type ElementAffinity } from './data/MapDB'; // v2.8.0：剑域地图（择剑域）
import { randomGenome, ELEMENT_LABEL } from './simulation/Genetics';
import { computeAppraisal } from './simulation/Appraisal'; // v2.8.2：剑成鉴定纯逻辑
import { dropDailyTide } from './simulation/Tide'; // v2.8.2：剑潮投放纯逻辑
import { computeRankUnlocks as computeRankUnlocksPure, applyUnlocks as applyUnlocksPure, accumulateStats as accumulateStatsPure } from './data/Progression'; // v2.8.2：解锁/累计纯逻辑
import { eventBus, EVT } from './utils/eventBus';
import { audio } from './audio/AudioManager';
import { uid, nowDateStr, randomInt } from './utils/mathUtils';
import { openModal, toast } from './ui/modals';
import { el, clearNode } from './utils/dom';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  MAX_DAYS,
  TICKS_PER_DAY,
  TICKS_PER_SECOND,
  SHRINK_INTERVAL_TICKS,
  TRIBULATION_MAX_TICKS,
  NN_LAYERS,
  MIND_REALMS,
  TICKS_PER_SHICHEN,
  START_ENERGY,
  START_HP,
  BATTLE_TICK_LIMIT,
  BATTLE_TPS,
  BATTLE_WIN_SCORE,
  BATTLE_LOSE_SCORE,
  SAVE_INTERVAL_MS,
  DAILY_FOOD_DROP,
  FOOD_DROP_BATCH,
  EMERGENCE_THRESHOLD,
  EMERGENCE_MIN_GEN,
  mindSizes,
  ENCOUNTER_SEED_DAILY_CHANCE,
} from './constants';
import { Duel } from './simulation/Duel';
import { MIND_SKILL_BY_ID } from './simulation/Skills';

type SceneName = 'menu' | 'embryo' | 'forge' | 'appraisal' | 'tournament';

interface BattleRun {
  ui: BattleUI;
  opp: OpponentInfo;
  artId: string;
  duel: Duel;
  tick: number;
  ended: boolean;
}

/** 游戏主控：场景编排、天数循环、天劫、鉴定、大比、存档与解锁 */
export class Game {
  readonly host: HTMLElement;
  readonly app: Application;
  save: GameSave = defaultSave();

  scene: SceneName = 'menu';
  world: World | null = null;
  renderer: WorldRenderer | null = null;
  hud: HUD | null = null;

  paused = true;
  speed = 1;
  tribulationEnded = false;
  lastShrinkTick = 0;
  /** v2.1.0：天劫开始 tick（超时兜底计时） */
  tribulationStartTick = 0;
  embryoGenome: Genome | null = null;
  emergenceCelebrated = false;
  selectedSwordId: string | null = null;
  emergenceTargetId: string | null = null;
  /** v2.8.0：布阵笔刷（常驻；null=未武装，点击画布聚焦灵鉴） */
  formationBrush: FormationBrush | null = null;
  /** v2.3.0：手动天雷——武装后点击剑域任意处降雷 */
  lightningArmed = false;
  /** v2.6.0：奇遇灵种——炉材使用后武装，点击剑域自选位置种下（与天雷一致的选位交互） */
  seedArmed = false;
  /** 本命血脉断绝后是否已弹过「重新种下剑胚」的提示 */
  seedExtinctPrompted = false;
  /** v1.11.0：上次「本命血脉已绝」弹窗所在日 (同日重种又死不再弹，避免弹窗疲劳) */
  private lastReseedPromptDay = -1;
  private tickAccumulator = 0;
  private battleAccumulator = 0;
  /** v2.7.1：打开剑潮/音律面板前的暂停态（关闭时恢复） */
  private panelWasPaused = false;

  appraisedRanked: RankedSword | null = null;
  battlePlayerState: SwordState | null = null;
  battle: BattleRun | null = null;
  /** v2.0.0：大比连胜场数（首胜入万剑谱；失败断连） */
  battleStreak = 0;
  private appraisalData: AppraisalData | null = null;

  private saveTimer = 0;
  private frame = 0;
  /** 是否已完成启动 (区分构造期的 showMenu 与用户主动返回主菜单) */
  private booted = false;

  constructor() {
    this.host = document.getElementById('app')!;
    // 手机 DPR 常为 3：背缓冲达 1920² 且每帧全量重绘，钳到 2x 显著降渲染开销
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.app = new Application({
      width: 640,
      height: 640,
      backgroundColor: 0x0b0e14,
      antialias: true,
      resolution: dpr,
      autoDensity: true,
    });
    document.body.appendChild(this.canvas);
    this.canvas.style.display = 'none';
    this.save = SaveManager.load();
    this.app.ticker.add(() => this.update());
    // 关闭/切后台前存档：pagehide 覆盖移动端（iOS 上 beforeunload 不可靠），1s 去重防双触发
    let lastFlush = 0;
    const flushSave = () => {
      const now = Date.now();
      if (now - lastFlush < 1000) return;
      lastFlush = now;
      this.saveGame();
    };
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave();
    });
    // 点击剑意 → 查看灵鉴（v2.3.0：布阵模式下由 pointer 事件处理；手动天雷优先）
    this.canvas.addEventListener('click', (e) => {
      if (this.scene !== 'forge' || !this.world) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_WIDTH);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_HEIGHT);
      // v2.3.0：手动天雷——点击即降雷
      if (this.lightningArmed) {
        this.releaseLightning(x, y);
        return;
      }
      // v2.6.0：奇遇灵种——点击自选位置种下（与天雷互斥，armed 时优先）
      if (this.seedArmed) {
        this.placeEncounterSeedAt(x, y);
        return;
      }
      if (this.formationBrush) return;
      const id = this.world.swordIdAt(x, y);
      this.focusSword(id);
    });
    // v2.3.0：布阵——点按 + 拖动绘制地形
    let painting = false;
    let lastPaintKey: string | null = null;
    const toCell = (e: PointerEvent | MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: Math.floor(((e.clientX - rect.left) / rect.width) * GRID_WIDTH),
        y: Math.floor(((e.clientY - rect.top) / rect.height) * GRID_HEIGHT),
      };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.formationBrush) return;
      painting = true;
      const c = toCell(e);
      lastPaintKey = `${c.x},${c.y}`;
      this.paintFormation(c.x, c.y);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!painting) return;
      const c = toCell(e);
      const k = `${c.x},${c.y}`;
      if (k !== lastPaintKey) {
        lastPaintKey = k;
        this.paintFormation(c.x, c.y);
      }
    });
    const stopPaint = () => {
      painting = false;
      lastPaintKey = null;
    };
    window.addEventListener('pointerup', stopPaint);
    this.host.addEventListener('pointerleave', stopPaint);
    this.showMenu();
    this.booted = true;
  }

  /** Pixi 画布 (断言为 HTMLCanvasElement) */
  private get canvas(): HTMLCanvasElement {
    return this.app.view as unknown as HTMLCanvasElement;
  }

  // ================= 场景 =================
  showMenu(): void {
    audio.setBgm('menu'); // 主菜单 BGM
    this.scene = 'menu';
    this.host.classList.remove('forge-screen');
    this.leaveFormation(); // v2.3.0
    this.paused = true;
    this.battle = null;
    // 玩家主动返回主菜单 (大比「返回主菜单」等) → 清除鉴定/大比续玩标记，刷新后不再回跳
    if (this.booted) {
      this.save.pendingScene = null;
      this.save.pendingAppraisal = null;
      this.save.pendingBattlePlayerState = null;
      this.saveGame();
    }
    this.hideCanvas();
    // P3：离开炼剑/大比场景时销毁渲染器与 HUD，解绑其监听
    this.renderer?.destroy?.();
    this.renderer = null;
    this.hud?.destroy?.(); // v2.2.1：销毁 HUD，解绑 LOG 订阅（此前仅 buildForgeScene 销毁，离场后残留）
    this.hud = null;
    // v2.2.1：清空并销毁 Pixi 舞台残留（Pixi v7 removeChildren 只接受索引，需手动 destroy 返回的子对象）
    for (const child of this.app.stage.removeChildren()) child.destroy();
    buildMenu(this.host, this);
  }

  showEmbryoSelect(): void {
    audio.preload('forge'); // 预载剑意曲，进入炼剑立即出声
    this.scene = 'embryo';
    this.host.classList.remove('forge-screen');
    this.leaveFormation(); // v2.3.0
    this.hideCanvas();
    // v2.7.1：与 showMenu 一致——销毁渲染器/HUD/舞台残留，解绑旧订阅（防剑胚选择期间事件进旧 HUD）
    this.renderer?.destroy?.();
    this.renderer = null;
    this.hud?.destroy?.();
    this.hud = null;
    for (const child of this.app.stage.removeChildren()) child.destroy();
    buildEmbryoSelect(this.host, this);
  }

  showRanking(): void {
    openRanking(this);
  }

  showCodex(): void {
    openCodex(this);
  }

  showAchievements(): void {
    openAchievements(this);
  }

  // ================= 开局 =================
  /** P0-3：有进行中的局/鉴定/大比时，先确认是否放弃再开新局 */
  startNewRun(element: Element, mapId: string): void {
    if (this.save.activeRun || this.save.pendingScene) {
      const body = el('div', '');
      body.appendChild(el('p', '', '当前仍有一局炼剑未竟。'));
      body.appendChild(el('p', 'reseed-sub', '开始新局将放弃当前进度（不可恢复），确定吗？'));
      const btnRow = el('div', 'modal-actions');
      const cancel = el('button', 'btn btn-ghost', '取消');
      const confirm = el('button', 'btn btn-gold', '放弃并开新局');
      btnRow.append(cancel, confirm);
      body.appendChild(btnRow);
      const overlay = openModal('开始新的炼剑之局？', body, { width: 440 });
      cancel.addEventListener('click', () => overlay.remove());
      confirm.addEventListener('click', () => {
        overlay.remove();
        this.doStartNewRun(element, mapId);
      });
      return;
    }
    this.doStartNewRun(element, mapId);
  }

  /** v2.8.0：择剑域——五行剑胚选定后选择本局地图（已解锁可点选；锁定显示解锁成就名） */
  openMapSelect(element: Element): void {
    const body = el('div', 'map-select');
    const grid = el('div', 'map-grid');
    const mapName = (id: string | null): string => {
      const a = id ? ACHIEVEMENTS.find((x) => x.id === id) : null;
      return a ? a.name : '';
    };
    // v2.8.0：五行相性展示
    const ELEM_ICON: Record<string, string> = { fire: '🔥', water: '💧', metal: '⚙️', wood: '🌳', earth: '⛰️' };
    const affParts = (a: ElementAffinity): string => {
      const p: string[] = [];
      if (a.atkBonus) p.push(`攻伐${a.atkBonus > 0 ? '+' : ''}${a.atkBonus}`);
      if (a.aggressionBonus) p.push(`杀性${a.aggressionBonus > 0 ? '+' : ''}${a.aggressionBonus}`);
      if (a.costMult) p.push(`耗神×${a.costMult}`);
      if (a.regenMult) p.push(`回血×${a.regenMult}`);
      if (a.energyGainMult) p.push(`采气回能×${a.energyGainMult}`);
      return p.join(' ');
    };
    for (const m of MAPS) {
      const card = el('div', 'map-card');
      const unlocked = !m.unlockAchievementId || this.save.achievements.includes(m.unlockAchievementId);
      const theme = m.theme;
      const swatch = el('div', 'map-swatch');
      swatch.style.background = `linear-gradient(135deg, #${theme.bg.toString(16).padStart(6, '0')} 0%, #${theme.lava.toString(16).padStart(6, '0')} 100%)`;
      swatch.appendChild(el('span', 'map-swatch-char', m.char)); // v2.8.0：主题大字（荒/焰/寒）
      card.appendChild(swatch);
      card.appendChild(el('div', 'map-name', m.name));
      card.appendChild(el('div', 'map-desc', m.desc));
      // v2.8.0：五行相性区块
      const affBox = el('div', 'map-affinity');
      if (m.affinity) {
        (Object.keys(m.affinity) as Element[]).forEach((e) => {
          const a = m.affinity![e]!;
          affBox.appendChild(el('div', 'map-aff-row', `${ELEM_ICON[e] ?? ''} ${ELEMENT_LABEL[e]}行·${a.label}　${affParts(a)}`));
        });
      } else {
        affBox.appendChild(el('div', 'map-aff-row neutral', '诸行平等，无增无减'));
      }
      card.appendChild(affBox);
      if (unlocked) {
        card.appendChild(el('div', 'map-state', '✔ 已解锁'));
        card.addEventListener('click', () => {
          overlay.remove();
          this.startNewRun(element, m.id);
        });
      } else {
        card.classList.add('locked');
        card.appendChild(el('div', 'map-state locked', `🔒 需成就「${mapName(m.unlockAchievementId)}」`));
      }
      grid.appendChild(card);
    }
    body.appendChild(grid);
    body.appendChild(el('p', 'map-hint', '不同剑域地形、氛围、天象与五行相性各异——先炼成可解锁之图，再入新域。'));
    const overlay = openModal('择 剑 域', body, { width: 640 });
  }

  private doStartNewRun(element: Element, mapId: string): void {
    this.embryoGenome = randomGenome(element);

    const world = new World({ mapId });
    const cx = Math.floor(world.config.width / 2);
    const cy = Math.floor(world.config.height / 2);
    const st: SwordState = {
      id: uid('sw'),
      name: '',
      genome: this.embryoGenome,
      brainWeights: new SimpleNN(NN_LAYERS).getWeights(),
      brainBiases: new SimpleNN(NN_LAYERS).getBiases(),
      energy: START_ENERGY,
      hp: START_HP,
      age: 0,
      birthTick: 0,
      position: { x: cx, y: cy },
      facing: { x: 0, y: -1 },
      parentId: '',
      generation: 1,
      origin: 'seed',
      mindRealm: 0, // v1.12.0：剑胚之剑心，起于凡心
    };
    const brain = new SimpleNN(NN_LAYERS, false);
    brain.setFromFlat(st.brainWeights, st.brainBiases);
    const agent = new SwordAgent(st, brain, world);
    world.addSword(agent, cx, cy);
    world.rootId = st.id;
    world.lineage.set(st.id, { parentId: '', day: 1, generation: 1, element: this.embryoGenome.element });
    // v2.5.0：剑域纪事——本命剑胚诞生
    world.chronicle.record('birth', {
      actorId: st.id,
      data: { via: 'seed', generation: 1, origin: 'seed', element: this.embryoGenome.element },
    });
    world.spawnInitialFood(10); // 荒域孤剑，生死由天

    this.world = world;
    this.tribulationEnded = false;
    this.lastShrinkTick = 0;
    this.tribulationStartTick = 0;
    this.appraisalData = null;
    this.appraisedRanked = null;
    this.battlePlayerState = null;
    this.emergenceCelebrated = false;
    this.seedExtinctPrompted = false;
    this.selectedSwordId = null;
    this.emergenceTargetId = null;
    // 新局弃用任何续玩阶段标记
    this.save.pendingScene = null;
    this.save.pendingAppraisal = null;
    this.save.pendingBattlePlayerState = null;

    // 炉材次数初始化 (已解锁材料按可用次数)
    this.save.materialCounts = {};
    for (const m of RECIPES) {
      if (this.save.unlockedMaterialIds.includes(m.id)) {
        this.save.materialCounts[m.id] = m.count;
      }
    }
    this.save.feedDropped = 0;
    // v2.6.0：布阵纯地形（熔岩/深水/恢复均不限次）；奇遇改由炉材「奇遇灵种」直接武装选位，不再有布阵次数
    // v2.8.0：布阵笔刷常驻（null=未武装；熔岩/深水/恢复均不限次）
    this.formationBrush = null;
    this.lightningArmed = false;
    this.seedArmed = false;

    this.save.activeRun = true;
    this.save.embryoGenome = this.embryoGenome;
    this.save.day = 1;
    this.save.mapId = mapId; // v2.8.0：本局剑域地图（续玩恢复）
    // v1.10.0：新局重置剑潮记忆 (本局内语义)
    this.save.dailyDropKind = null;
    this.save.dailyDropLocked = false;
    this.save.tickCounter = 0;

    this.buildForgeScene();
    this.saveGame(); // P0-4：先切场景为 forge 再存档，避免 activeRun 被存为 false
    this.paused = true;
    this.openDailyDropPanelForDay(1); // 第1日子时剑潮
    eventBus.emit(EVT.LOG, `${ELEMENT_LABEL[element]}行剑胚落入剑域，凡铁自此而始。`);
  }

  continueRun(): void {
    // 鉴定/大比续玩：刷新后回到原界面
    if (this.save.pendingScene === 'appraisal') {
      this.restoreAppraisal();
      return;
    }
    if (this.save.pendingScene === 'tournament') {
      this.restoreTournament();
      return;
    }
    if (!this.save.activeRun || !this.save.embryoGenome) {
      this.showMenu();
      return;
    }
    const world = new World({ currentDay: this.save.day, mapId: this.save.mapId ?? undefined }); // v2.8.0：续玩恢复剑域地图
    world.tickCounter = this.save.tickCounter;
    world.maxGeneration = this.save.maxGeneration;
    world.rootId = this.save.rootId;
    this.embryoGenome = this.save.embryoGenome;

    for (const st of this.save.swords) {
      // v1.12.0：按剑心境界推导隐藏层容量重建 NN（扩容后的 brainWeights 长度已变化）
      const brain = new SimpleNN(mindSizes(st.mindRealm ?? 0), false);
      brain.setFromFlat(st.brainWeights, st.brainBiases);
      const agent = new SwordAgent(st, brain, world);
      world.addSword(agent, st.position.x, st.position.y);
      world.lineage.set(st.id, {
        parentId: st.parentId,
        day: this.save.day,
        generation: st.generation,
        element: st.genome.element,
      });
    }
    // P1-3：为根剑胚补 lineage 条目，避免悟道之树在种子处断裂 (若已存在则不覆盖)
    if (world.rootId && !world.lineage.has(world.rootId)) {
      world.lineage.set(world.rootId, {
        parentId: '',
        day: 1,
        generation: 1,
        element: this.embryoGenome.element,
      });
    }
    // v2.7.1：整体恢复血统链（含已陨落祖先）——隔代血亲判定/悟道树续档不裂
    if (Array.isArray(this.save.lineage)) {
      for (const [id, node] of this.save.lineage) {
        if (!world.lineage.has(id)) world.lineage.set(id, node);
      }
    }
    // v2.7.1：恢复剑域纪事（刷新续玩不丢前半局事件，成就/剑谱口径完整）
    if (Array.isArray(this.save.chronicle)) {
      world.chronicle.restore(this.save.chronicle);
    }
    // P1-4：续档恢复生态状态 (边界/庚金/火墙/天劫开关)，避免剑域回春
    if (this.save.eco) world.restoreEcoState(this.save.eco);
    else world.spawnInitialFood(10);

    this.world = world;
    this.tribulationEnded = false;
    this.lastShrinkTick = world.tickCounter;
    this.tribulationStartTick = world.tickCounter;
    this.appraisalData = null;
    this.emergenceCelebrated = false;
    this.seedExtinctPrompted = false;
    this.buildForgeScene();
    this.paused = false;
  }

  /** 由存档剑意状态重建 SwordAgent (鉴定/大比续玩，仅需 .state) */
  private agentFromState(st: SwordState): SwordAgent {
    const w = new World({ currentDay: this.save.day, mapId: this.save.mapId ?? undefined }); // v2.8.0：剑域地图
    w.tickCounter = this.save.tickCounter;
    // v1.12.0：按剑心境界推导隐藏层容量重建 NN
    const brain = new SimpleNN(mindSizes(st.mindRealm ?? 0), false);
    brain.setFromFlat(st.brainWeights, st.brainBiases);
    return new SwordAgent(st, brain, w);
  }

  /** 续玩：回到「剑成鉴定」命名界面 (刷新恢复) */
  private restoreAppraisal(): void {
    const pa = this.save.pendingAppraisal;
    if (!pa?.winnerState) {
      this.save.pendingScene = null;
      this.saveGame();
      this.showMenu();
      return;
    }
    const data: AppraisalData = {
      winner: this.agentFromState(pa.winnerState),
      score: pa.score,
      breakdown: pa.breakdown,
      tags: pa.tags,
      tree: pa.tree,
      populationHistory: pa.populationHistory,
      totalTicks: pa.totalTicks,
      tale: pa.tale ?? null,
    };
    this.appraisalData = data;
    this.showAppraisal(data);
  }

  /** 续玩：回到「试剑台」宗门大比 (刷新恢复，可重新选对手开战) */
  private restoreTournament(): void {
    const pState = this.save.pendingBattlePlayerState;
    const ranked = pState ? this.save.history.find((h) => h.id === pState.id) : null;
    if (!pState || !ranked) {
      this.save.pendingScene = null;
      this.saveGame();
      this.showMenu();
      return;
    }
    this.appraisedRanked = ranked;
    this.battlePlayerState = pState;
    this.showTournament();
  }

  // ================= 炼剑主界面 =================
  private buildForgeScene(): void {
    audio.setBgm('forge'); // 剑意阶段 BGM
    this.scene = 'forge';
    this.host.classList.add('forge-screen');
    clearNode(this.host);
    // P1-1：销毁旧 HUD，解绑其 LOG 监听，防止多局重复触发
    this.hud?.destroy?.();
    this.hud = new HUD(this.host);
    this.hud.onTideClick(() => this.openTidePanel()); // v1.11.0
    this.hud.onReseedClick(() => this.tryReseed()); // v1.11.0
    this.hud.onAudioClick(() => this.openAudioPanel()); // v2.6.1 音律（开关+滑块合一）
    this.hud.focusHandler = (id) => this.focusSword(id);
    // v2.8.0：顶栏显示本局剑域名（辨识当前剑域）
    this.hud.setMapName(getMap(this.world?.config.mapId)?.name ?? '荒域');
    this.refreshHudControls();
    this.mountCanvas(this.hud.canvasSlot); // v2.8.1：画布挂到两侧栏之间的中央容器
    this.renderer?.destroy?.();
    // v2.2.1：先销毁旧渲染器再清空并销毁舞台残留（Pixi v7 removeChildren 只接受索引）
    for (const child of this.app.stage.removeChildren()) child.destroy();
    // v2.8.0：画布主题随本局剑域地图（荒域 = 原配色）
    this.renderer = new WorldRenderer(this.app.stage, GRID_WIDTH, GRID_HEIGHT, 10, false, getMap(this.world?.config.mapId)?.theme);
    this.frame = 0;
    if (this.world) {
      this.renderer.render(this.world, 0);
      this.hud.update(this.world);
    }
  }

  private refreshHudControls(): void {
    this.hud?.setSpeedControl(
      this.speed,
      this.paused,
      (s) => {
        this.speed = s;
        // 暂停态点倍率 → 自动恢复走时（模态遮罩全屏挡住速度栏时点不到，安全）
        if (this.paused) this.paused = false;
        this.refreshHudControls();
      },
      () => this.togglePause(),
    );
    this.hud?.setFeedState(this.feedRemaining(), () => this.dropFood());
    // v2.8.0：布阵笔刷常驻高亮
    this.hud?.setBrush(this.formationBrush, (b) => this.onBrushClick(b));
  }

  /** v2.8.0：炉材常驻按钮数据（剩余次数/解锁态/说明） */
  private materialItems(): MaterialItem[] {
    const unlocked = new Set(this.save.unlockedMaterialIds);
    return recipesSorted().map((m) => ({
      id: m.id,
      name: m.name,
      count: unlocked.has(m.id) ? (this.save.materialCounts[m.id] ?? 0) : 0,
      unlocked: unlocked.has(m.id),
      desc: m.description,
      lock: unlockLabel(m.unlock),
    }));
  }

  /** 当前仍可布霖的庚金之气团数 */
  feedRemaining(): number {
    return DAILY_FOOD_DROP - this.save.feedDropped;
  }

  // ================= 布阵（地图编辑 v2.8.0 常驻化） =================
  /** v2.8.0：布阵笔刷——点击拿起/收起（与天雷/奇遇武装互斥；不暂停走时） */
  private onBrushClick(b: FormationBrush): void {
    if (this.scene !== 'forge' || !this.world) return;
    if (this.world.config.isShrinking) {
      toast('天劫收束之际，剑域壁垒已固，不可布阵。');
      return;
    }
    if (this.formationBrush === b) {
      this.formationBrush = null; // 再点同一笔刷 → 收起（恢复点击聚焦灵鉴）
    } else {
      this.formationBrush = b;
      this.lightningArmed = false; // 与天雷/奇遇互斥，防点击冲突
      this.seedArmed = false;
    }
    this.refreshHudControls();
  }

  /** 离开炼剑界面：收起布阵笔刷与武装（场景切换时清理） */
  private leaveFormation(): void {
    this.formationBrush = null;
    this.lightningArmed = false; // 离场取消武装天雷
    this.seedArmed = false; // 离场取消奇遇待放置
  }

  /** 在网格 (x,y) 处执行当前笔刷（熔岩/深水/恢复，v2.6.0 起纯地形编辑） */
  private paintFormation(x: number, y: number): void {
    const w = this.world;
    if (!w || this.scene !== 'forge' || !this.formationBrush) return;
    if (w.config.isShrinking) return;
    if (!w.inBounds(x, y)) return;
    // 壁垒不可布阵（熔岩自身不在此列——恢复熔岩需放行）
    if (w.isWall(x, y) && w.terrainAt(x, y) !== 'lava') {
      toast('此处壁垒坚固，不可布阵。');
      return;
    }
    switch (this.formationBrush) {
      case 'lava':
        // v2.3.0：熔岩/深水不限制次数
        if (w.terrainAt(x, y) === 'lava') return;
        w.setTerrain(x, y, 'lava');
        w.chronicle.record('formation', { data: { brush: 'lava' } }); // v2.5.0：剑域纪事
        break;
      case 'deepwater':
        if (w.terrainAt(x, y) === 'deepwater') return;
        w.setTerrain(x, y, 'deepwater');
        w.chronicle.record('formation', { data: { brush: 'deepwater' } }); // v2.5.0：剑域纪事
        break;
      case 'clear':
        // v2.4.0：恢复笔刷范围化——一次清除 3×3 邻域地形（熔岩/深水/临时火海）
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            w.clearTerrain(x + dx, y + dy);
          }
        }
        w.chronicle.record('formation', { data: { brush: 'clear' } }); // v2.5.0：剑域纪事
        break;
    }
    this.saveGame();
  }

  /** v2.6.0：奇遇灵种——待放置状态点击选位种下（与天雷一致；世界已有奇遇则退还次数） */
  private placeEncounterSeedAt(x: number, y: number): void {
    const w = this.world;
    if (!w || this.scene !== 'forge' || !this.seedArmed) return;
    if (w.config.isShrinking) {
      toast('天劫收束之际，剑域壁垒已固，不可种下奇遇。');
      return;
    }
    if (w.encounterSeed) {
      // 剑域已有奇遇灵光（每日随机或他处显现）→ 退还次数并解除待放置
      this.seedArmed = false;
      this.save.materialCounts['encounter_seed'] = (this.save.materialCounts['encounter_seed'] ?? 0) + 1;
      toast('剑域已有奇遇灵光显现，灵种已收回炉府。');
      this.saveGame();
      return;
    }
    if (!w.placeEncounterSeed(x, y)) {
      toast('此处不可种下奇遇灵种（已有地形/壁垒/剑意）。');
      return; // 保持待放置，可另择他处
    }
    this.seedArmed = false;
    this.refreshHudControls();
    this.saveGame();
  }

  /** v2.3.0：手动天雷——在点击处降下雷霆，与天劫天雷同伤害/特效 */
  private releaseLightning(x: number, y: number): void {
    const w = this.world;
    if (!w || this.scene !== 'forge' || !this.lightningArmed) return;
    this.lightningArmed = false;
    const sid = w.swordIdAt(x, y);
    // v2.5.0：手动天雷——返回本次雷暴击杀数（剑域纪事「lightning」事件，成就「雷神降世」数据源）
    const kills = w.strikeLightning(x, y);
    w.chronicle.record('lightning', { data: { kills } });
    eventBus.emit(
      EVT.LOG,
      sid ? `你引下天雷，正中一道剑意（${x},${y}）！` : `你引下天雷，剑域（${x},${y}）轰然炸响。`,
    );
    this.refreshHudControls();
    this.saveGame();
  }

  /** 聚焦某道剑意：高亮选中框 + 打开灵鉴 */
  focusSword(id: string | null): void {
    // P1-2 相关：仅炼剑界面可聚焦，避免跨场景/跨局误弹灵鉴
    if (this.scene !== 'forge') return;
    const w = this.world;
    this.selectedSwordId = id;
    this.renderer?.setSelected(id);
    if (id && w) {
      const agent = w.swords.get(id);
      if (agent) {
        this.paused = true;
        this.refreshHudControls();
        openSwordDetail(this, agent, () => {
          // v2.0.0：灵鉴即暂停——关闭后保持暂停，玩家点速度档恢复走时
          if (this.scene === 'forge') {
            this.refreshHudControls();
          }
        });
      } else {
        // 指向已陨落的剑意 (如点击「悟得词条」日志但该剑已死) → 明确反馈
        toast('该剑意已陨落，无从聚焦。');
      }
    }
  }

  /** v2.0.0：剑心晋升 3 选 1（仅本命血脉弹窗；外来剑意随机，见 checkMindRealm） */
  private promptMindPick(agent: SwordAgent): void {
    const candidates = agent.pendingMindPick;
    if (!candidates || candidates.length === 0) return;
    this.paused = true;
    this.refreshHudControls();
    const realmName = MIND_REALMS[agent.state.mindRealm ?? 0]?.name ?? '';
    const body = el('div', 'mindpick-modal');
    body.appendChild(el('p', 'mindpick-title', `本命剑意剑心晋入「${realmName}」——择一剑心绝技：`));
    const grid = el('div', 'mindpick-grid');
    for (const id of candidates) {
      const s = MIND_SKILL_BY_ID[id];
      if (!s) continue;
      const card = el('div', 'mindpick-card tip');
      card.setAttribute('data-tip', `耗 ${s.energyCost} 精元 · 冷却 ${Math.max(1, Math.round(s.cooldown / TICKS_PER_SHICHEN))} 时辰`);
      card.append(el('div', 'mindpick-name', s.name), el('div', 'mindpick-desc', s.desc));
      card.addEventListener('click', () => {
        overlay.remove();
        agent.pickMindSkill(s.id);
        this.saveGame();
        // 选完绝技即继续走时（3 选 1 是晋升流程，非灵鉴式主动暂停）
        this.paused = false;
        this.refreshHudControls();
      });
      grid.appendChild(card);
    }
    body.appendChild(grid);
    const overlay = openModal('剑心 · 绝技', body, {
      width: 540,
      // v2.7.1：点 ×/遮罩关闭 → 放弃本次候选并恢复走时，防「不选就永远重弹」死循环
      onClose: () => {
        agent.pendingMindPick = null;
        if (this.scene === 'forge') {
          this.paused = false;
          this.refreshHudControls();
        }
      },
    });
  }

  /** 涌现时选定代表剑意 (世代最深 / 存续最久) */
  private pickRepresentativeSword(): SwordAgent | null {
    const w = this.world;
    if (!w || w.swords.size === 0) return null;
    let best: SwordAgent | null = null;
    for (const s of w.swords.values()) {
      if (
        !best ||
        s.state.generation > best.state.generation ||
        (s.state.generation === best.state.generation && s.state.age > best.state.age)
      ) {
        best = s;
      }
    }
    return best;
  }


  /** 本命血脉 (origin='seed') 是否已全部断绝 */
  private seedLineageExtinct(): boolean {
    const w = this.world;
    if (!w) return false;
    for (const s of w.swords.values()) {
      if (s.state.origin === 'seed') return false;
    }
    return true;
  }

  /** 弹窗：本命血脉断绝，询问是否重新种下剑胚（v2.3.0 支持改选五行） */
  private showReseedModal(mode: 'auto' | 'manual'): void {
    const w = this.world;
    if (!w) return;
    this.lastReseedPromptDay = w.config.currentDay; // v1.11.0：记录弹窗日，同日不再重复弹
    const curElement: Element = this.embryoGenome?.element ?? 'metal';
    const body = el('div', 'reseed-modal');
    if (mode === 'auto') {
      body.appendChild(el('p', '', '本命血脉已然断绝，剑域之中再无你的剑胚一脉。'));
    }
    body.appendChild(
      el(
        'p',
        'reseed-sub',
        mode === 'auto' ? '择五行，重新种下一道本命剑胚，再续凡铁？' : '择五行，重新种下一道本命剑胚？'
      )
    );

    // v2.3.0：五行可选（默认高亮当前开局/上次所选）
    const grid = el('div', 'embryo-grid');
    const elements: Element[] = ['metal', 'wood', 'water', 'fire', 'earth'];
    let selected: Element = curElement;
    const cards = new Map<Element, HTMLElement>();
    for (const e of elements) {
      const card = buildElementCard(e, {
        compact: true,
        selected: e === selected,
        onClick: (picked) => {
          selected = picked;
          for (const [k, c] of cards) c.classList.toggle('selected', k === picked);
        },
      });
      cards.set(e, card);
      grid.appendChild(card);
    }
    body.appendChild(grid);

    const btnRow = el('div', 'modal-actions');
    const later = el('button', 'btn btn-ghost', '暂不重种');
    const no = el('button', 'btn btn-ghost', '罢了');
    const yes = el('button', 'btn btn-gold', '重新种下');
    btnRow.append(later, no, yes);
    body.appendChild(btnRow);

    const closeAndResume = () => {
      if (this.scene === 'forge') {
        this.paused = false;
        this.refreshHudControls();
      }
    };
    const overlay = openModal(mode === 'auto' ? '本命血脉已绝' : '重种本命', body, {
      width: 620,
      onClose: closeAndResume,
    });
    yes.addEventListener('click', () => {
      overlay.remove();
      this.reseedLineage(selected);
      closeAndResume();
    });
    later.addEventListener('click', () => {
      overlay.remove();
      // v1.11.0：暂不重种 → 本局不再自动弹，HUD「重种本命」可随时手动种回
      this.seedExtinctPrompted = true;
      eventBus.emit(EVT.LOG, {
        text: '你决定暂不重种本命血脉，剑域唯外来剑意自谋生路。',
        important: true,
      });
      this.saveGame();
      closeAndResume();
    });
    no.addEventListener('click', () => {
      overlay.remove();
      // P1-11：放弃本局 → 清 activeRun 并保存，避免「继续炼剑」死循环入口
      this.save.activeRun = false;
      this.saveGame();
      this.showMenu();
    });
  }

  /** 重新种下一道本命剑胚 (血统重启，仅此一柄；v2.3.0 可选五行) */
  private reseedLineage(element: Element): void {
    const w = this.world;
    if (!w) return;
    const cx = Math.floor(w.config.width / 2);
    const cy = Math.floor(w.config.height / 2);
    // 中心附近寻一空位 (占位判定：墙 / 有食 / 有剑)
    const occupied = (x: number, y: number) => w.isWall(x, y) || w.foodAt(x, y) !== 0 || !!w.swordIdAt(x, y);
    let px = cx;
    let py = cy;
    if (occupied(cx, cy)) {
      for (let r = 1; r < 24; r++) {
        const nx = cx + randomInt(-r, r);
        const ny = cy + randomInt(-r, r);
        if (w.inBounds(nx, ny) && !occupied(nx, ny)) {
          px = nx;
          py = ny;
          break;
        }
      }
    }
    // v2.3.0：同五行 → 继承原剑谱（清词条）；换五行 → 全新生成
    const genome: Genome =
      this.embryoGenome && element === this.embryoGenome.element
        ? { ...this.embryoGenome, affixes: [] }
        : randomGenome(element);
    const st: SwordState = {
      id: uid('sw'),
      name: '',
      genome,
      brainWeights: new SimpleNN(NN_LAYERS).getWeights(),
      brainBiases: new SimpleNN(NN_LAYERS).getBiases(),
      energy: START_ENERGY,
      hp: START_HP,
      age: 0,
      birthTick: w.tickCounter,
      position: { x: px, y: py },
      facing: { x: 0, y: -1 },
      parentId: '',
      generation: 1,
      origin: 'seed',
      mindRealm: 0, // v1.12.0：重种剑胚亦起于凡心
    };
    const brain = new SimpleNN(NN_LAYERS, false);
    brain.setFromFlat(st.brainWeights, st.brainBiases);
    const agent = new SwordAgent(st, brain, w);
    w.addSword(agent, px, py);
    if (!w.swords.has(st.id)) {
      // P3：找不到空位 (天劫收束期) → 明确反馈而非静默失败
      toast('剑域已无立足之地，本命剑胚无法种下。');
      return;
    }
    w.rootId = st.id;
    w.lineage.set(st.id, { parentId: '', day: w.config.currentDay, generation: 1, element: genome.element });
    // v2.5.0：剑域纪事——重种剑胚诞生 + 玩家重种记录
    w.chronicle.record('birth', {
      actorId: st.id,
      data: { via: 'reseed', generation: 1, origin: 'seed', element: genome.element },
    });
    w.chronicle.record('reseed', { data: { id: genome.element } });
    // v2.3.0：重种后五行即本局本命五行基准（鉴定「血脉相承」/悟道之树根元素同步）
    this.embryoGenome = genome;
    this.save.embryoGenome = genome;
    this.seedExtinctPrompted = false; // 未来再绝，仍可再问
    eventBus.emit(EVT.LOG, {
      text: `你重新种下一道【${ELEMENT_LABEL[genome.element]}】行本命剑胚，凡铁再续。`,
      focusId: st.id,
      important: true,
    });
    toast('🌱 本命剑胚重新种下');
    this.saveGame();
  }

  /** HUD 手动重种本命 (v1.11.0)：本命血脉已绝时可调（v2.3.0 弹窗可选五行） */
  tryReseed(): void {
    if (this.scene !== 'forge' || !this.world) return;
    if (!this.seedLineageExtinct()) {
      toast('本命血脉尚在，无需重种。');
      return;
    }
    this.showReseedModal('manual');
  }

  /** 剑潮偏好面板 (v1.11.0)：随时修改本局剑潮选择/免弹窗，不立即投放 */
  openTidePanel(): void {
    if (this.scene !== 'forge') return;
    this.panelWasPaused = this.paused; // v2.7.1：记住进入前暂停态
    this.paused = true;
    this.refreshHudControls();
    openTidePanel(this, () => {
      if (this.scene === 'forge') {
        this.paused = this.panelWasPaused; // v2.7.1：恢复进入前暂停态
        this.refreshHudControls();
      }
    });
  }

  /** v2.6.1：音律面板（背景乐/音效 开关+滑块合一）——暂停调音，关闭恢复走时 */
  private openAudioPanel(): void {
    if (this.scene !== 'forge') return;
    this.panelWasPaused = this.paused; // v2.7.1：记住进入前暂停态
    this.paused = true;
    this.refreshHudControls();
    openAudioPanel(() => {
      if (this.scene === 'forge') {
        this.paused = this.panelWasPaused; // v2.7.1：恢复进入前暂停态
        this.refreshHudControls();
      }
    });
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.refreshHudControls();
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.refreshHudControls();
  }

  /** 每日子时剑潮投放 (玩家选择或默许天意) */
  private openDailyDropPanelForDay(day: number): void {
    if (this.scene !== 'forge') return;
    // v1.10.0：勾选「本局一直用此选择」后不再弹窗，直接按上次选择投放
    if (this.save.dailyDropLocked && this.save.dailyDropKind) {
      this.chooseDailyDrop(this.save.dailyDropKind);
      // v1.12.0：免弹窗自动投放后恢复走时（原：checkDay 已置 paused=true，此处不恢复导致卡死）
      this.paused = false;
      this.refreshHudControls();
      toast(`第${day}日子时，剑潮已按本局选择自动投放。`);
      return;
    }
    this.paused = true;
    this.refreshHudControls();
    openDailyDropPanel(this, day, () => {
      if (this.scene === 'forge') {
        this.paused = false;
        this.refreshHudControls();
      }
    });
  }

  chooseDailyDrop(kind: DailyDropKind): void {
    const w = this.world;
    if (!w) return;
    this.save.dailyDropKind = kind; // v1.10.0：记住本局选择 (超时沿用/免弹窗投放依据)
    const day = w.config.currentDay;
    const { spawned, label } = dropDailyTide(w, kind, day);
    if (spawned > 0) eventBus.emit(EVT.LOG, `第${day}日子时，${label}降下${spawned}道游离剑意。`);
    else if (kind === 'none') eventBus.emit(EVT.LOG, `第${day}日子时：你未投剑意，剑域唯余余波自涌。`);
    else eventBus.emit(EVT.LOG, `第${day}日子时：剑域已无立足之地，${label}竟无处落脚。`); // P3：网格饱和时也给出反馈
    // v2.5.0：剑域纪事——玩家择选剑潮
    w.chronicle.record('tide', { data: { id: kind } });
    if (this.hud && this.world) this.hud.update(this.world);
    this.saveGame(); // v1.10.0：剑潮选择即时落盘 (防刷新丢失记忆/勾选)
  }

  /** 布霖（手动布霖：随时可施，每日限量） */
  dropFood(): void {
    const w = this.world;
    if (!w || this.tribulationEnded) return;
    if (this.feedRemaining() <= 0) return;
    let dropped = 0;
    for (let i = 0; i < FOOD_DROP_BATCH; i++) {
      if (w.dropFoodAtRandom()) dropped++;
    }
    this.save.feedDropped = Math.min(DAILY_FOOD_DROP, this.save.feedDropped + dropped); // P1-10：按实际落下的团数计，空投不扣配额
    if (dropped > 0) {
      eventBus.emit(EVT.LOG, `你于剑域布下一片金霖，${dropped}团庚金之气落入。`); // v2.3.0：改名「布霖」
      // v2.5.0：剑域纪事——玩家布霖
      w.chronicle.record('feed', { data: { count: dropped } });
    }
    this.refreshHudControls();
    this.saveGame();
  }

  /** 使用炉材 (道具次数，改变炼剑炉属性) */
  applyMaterial(id: string): void {
    const m = getMaterial(id);
    const w = this.world;
    if (!m || !w) return;
    const remaining = this.save.materialCounts[id] ?? 0;
    if (remaining <= 0) return;
    this.save.materialCounts[id] = remaining - 1;
    switch (m.effect.type) {
      case 'foodRegenRate':
        w.modifiers.foodRegenMult += m.effect.multiplier;
        toast(`庚金生成 ×${w.modifiers.foodRegenMult.toFixed(1)}（+${Math.round((w.modifiers.foodRegenMult - 1) * 100)}%）`);
        break;
      case 'allSpeedBonus':
        w.modifiers.speedBonus += m.effect.value;
        toast(`全体剑意身法 +${w.modifiers.speedBonus}`);
        break;
      case 'temperature':
        w.modifiers.temperature = m.effect.value;
        toast(`节气：${m.effect.value === 'breeze' ? '清风·灵力消耗降低' : '严寒'}`);
        break;
      case 'mutationBias':
        w.modifiers.mutationBias = { stat: m.effect.stat, rateMult: m.effect.rateMult, sideEffect: m.effect.sideEffect };
        toast(m.effect.sideEffect === 'speedDown'
          ? `分化突变：${m.effect.stat === 'speed' ? '速度' : '坚固'} ×${m.effect.rateMult}·速度突变下降`
          : `分化突变：${m.effect.stat === 'speed' ? '速度' : '坚固'} ×${m.effect.rateMult}`);
        break;
      case 'megaFood':
        w.spawnMegaFood(m.effect.count);
        w.modifiers.aggressionBonus += 0.3;
        toast('陨星真金坠落，剑意杀性 +0.3');
        break;
      // v2.6.0：奇遇灵种——武装选位（不再经布阵模式）
      case 'encounterSeed':
        this.formationBrush = null; // v2.8.0：与布阵笔刷互斥
        this.lightningArmed = false;
        this.seedArmed = true;
        toast('🌱 奇遇灵种已启，点击剑域自选位置种下！');
        break;
      case 'manualLightning':
        // v2.3.0：天雷——武装一次引雷，点击剑域任意处降下雷霆（与天劫天雷同伤/特效）
        this.lightningArmed = true;
        this.formationBrush = null; // v2.8.0：与布阵笔刷互斥
        this.seedArmed = false;
        toast('⚡ 天雷已引，点击剑域任意处降下雷霆！');
        break;
    }
    eventBus.emit(EVT.LOG, `炉府中加入「${m.name}」，剑域气象随之而变。`);
    // v2.5.0：剑域纪事——玩家使用炉材
    w.chronicle.record('material', { data: { id } });
    this.refreshHudControls();
    this.saveGame();
  }

  // ================= 主循环 (基于时间的节流，1x 即 TICKS_PER_SECOND) =================
  private update(): void {
    this.frame++;
    const dt = Math.min(0.1, (this.app.ticker.deltaMS || 0) / 1000); // 秒，钳制防卡顿爆量

    if (this.scene === 'forge' && this.world) {
      // 粒子始终推进 (暂停时也淡出，避免冻结残点)
      this.renderer?.updateParticles(dt);
      // v2.7.1：暂停且无活跃粒子/特效/飘字 → 跳过全量重绘（画面静止，省每帧数千条图形命令）
      if (!this.paused || this.renderer?.hasActiveFx()) {
        this.renderer?.render(this.world, this.frame);
      }
      if (!this.paused) {
        const tps = TICKS_PER_SECOND * this.speed;
        this.tickAccumulator += dt;
        let budget = Math.floor(this.tickAccumulator * tps);
        if (budget > 0) {
          // v2.7.1：先钳位再扣减——原「先扣后钳」会把超限 tick 静默吞掉
          budget = Math.min(budget, 120);
          this.tickAccumulator -= budget / tps;
          for (let i = 0; i < budget; i++) {
            this.runTick();
            // v2.7.1：弹窗弹出（如每日剑潮）后不再在模态背后继续跑 tick
            if (this.tribulationEnded || this.paused) break;
          }
        }
        // 本命血脉断绝：提示玩家是否重新种下剑胚
        if (
          !this.tribulationEnded &&
          !this.seedExtinctPrompted &&
          this.world.config.currentDay !== this.lastReseedPromptDay && // v1.11.0：同日不重复弹
          this.seedLineageExtinct()
        ) {
          this.seedExtinctPrompted = true;
          eventBus.emit(EVT.LOG, {
            text: `第${this.world.config.currentDay}日：本命血脉已然断绝，剑域之中再无剑胚一脉。`,
            important: true,
          });
          this.paused = true;
          this.refreshHudControls();
          this.showReseedModal('auto');
        }
        // v2.0.0：剑心晋升 3 选 1——本命血脉候选待选，弹选择面板（暂停等玩家）
        if (!this.tribulationEnded && this.world) {
          for (const a of this.world.swords.values()) {
            if (a.pendingMindPick && a.pendingMindPick.length > 0) {
              this.promptMindPick(a);
              break;
            }
          }
        }
        // 涌现惊喜：出现能自续的稳定血脉 (数量达标且世代够深)
        if (
          !this.emergenceCelebrated &&
          this.world.swords.size >= EMERGENCE_THRESHOLD &&
          this.world.maxGeneration >= EMERGENCE_MIN_GEN
        ) {
          this.emergenceCelebrated = true;
          const rep = this.pickRepresentativeSword();
          this.emergenceTargetId = rep ? rep.state.id : null;
          // v2.5.0：剑域纪事——涌现
          this.world.chronicle.record('emerge', {
            actorId: this.emergenceTargetId ?? undefined,
            data: { population: this.world.swords.size, gen: this.world.maxGeneration },
          });
          eventBus.emit(EVT.LOG, {
            text: '万剑相杀之中，有一股血脉自成气候——自采气、自分灵，剑意存续之道初显端倪！',
            focusId: this.emergenceTargetId ?? undefined,
            important: true,
          });
          eventBus.emit(EVT.EMERGENCE, null); // 音频：涌现庆祝
          toast('✨ 涌现：一道能自续的稳定剑意血脉诞生了！点击聚焦', 8000, () => {
            // P1-2 相关：捕获当时的代表剑 id，避免跨局误聚焦新局的剑
            const targetId = this.emergenceTargetId;
            if (targetId) this.focusSword(targetId);
          });
        }
        this.saveTimer += dt * 1000; // P1-7：按真实帧时长累计，而非固定 16.6ms
        if (this.saveTimer >= SAVE_INTERVAL_MS) {
          this.saveTimer = 0;
          this.saveGame();
        }
      }
      if (this.frame % 6 === 0) {
        this.hud?.update(this.world);
        // v2.8.0：剑域气象 + 炉材常驻（不再弹窗）
        this.hud?.setAura(buildMaterialAura(this));
        this.hud?.setMaterials(this.materialItems(), (id) => this.applyMaterial(id));
      }
      this.hud?.setFeedState(this.feedRemaining(), () => this.dropFood());
    } else if (this.scene === 'tournament' && this.battle && !this.battle.ended) {
      // 玩家选招时暂停蓄条
      if (!this.battle.duel.pNeedsChoice) {
        this.battleAccumulator += dt;
        let budget = Math.floor(this.battleAccumulator * BATTLE_TPS);
        if (budget > 0) {
          // v2.7.1：先钳位再扣减（同 forge 分支）
          budget = Math.min(budget, 60);
          this.battleAccumulator -= budget / BATTLE_TPS;
          for (let i = 0; i < budget; i++) {
            const events = this.battle.duel.step();
            this.battle.tick++;
            if (events.length > 0) {
              this.battle.ui.pushEvents(events, this.battle.duel.p, this.battle.duel.n);
            }
            if (this.battle.duel.pNeedsChoice) {
              this.battle.ui.showTechniqueChoice(this.battle.duel.playerTechniques(), (id) => this.chooseTechnique(id));
              break;
            }
            if (this.checkBattleEnd()) break;
          }
        }
      }
    }
  }

  private runTick(): void {
    const w = this.world;
    if (!w) return;
    w.tick();
    this.checkDay();
  }

  private checkDay(): void {
    const w = this.world;
    if (!w) return;
    const day = Math.min(MAX_DAYS, Math.floor(w.tickCounter / w.config.dayTickLimit) + 1);
    if (day !== w.config.currentDay) {
      w.config.currentDay = day;
      this.save.feedDropped = 0; // 新一日，布霖之量恢复
      // v2.6.0：天雷每日 5 次——每日子时恢复（仅已解锁时）
      if (this.save.unlockedMaterialIds.includes('thunder_potion')) {
        this.save.materialCounts['thunder_potion'] = 5;
      }
      this.saveGame();
      eventBus.emit(EVT.DAY_START, day);
      // v2.3.0：奇遇种子——每日子时低概率随机显现（玩家也可用炉材主动放置）
      if (day < MAX_DAYS && !w.encounterSeed && Math.random() < ENCOUNTER_SEED_DAILY_CHANCE) {
        if (w.placeEncounterSeed()) {
          toast('🌱 剑域深处一缕奇遇灵光悄然显现……');
        }
      }
      if (day < MAX_DAYS) {
        this.paused = true;
        this.openDailyDropPanelForDay(day);
      }
    }
    // 第10天：天劫收束——斗至最后一柄（场地缩到 4x4 后靠临时杀性决胜；超时兜底强制收束防卡死）
    if (day >= MAX_DAYS && !this.tribulationEnded) {
      if (!w.config.isShrinking) this.tribulationStartTick = w.tickCounter;
      w.config.spawnFood = false;
      w.config.isShrinking = true;
      if (w.tickCounter - this.lastShrinkTick >= SHRINK_INTERVAL_TICKS) {
        this.lastShrinkTick = w.tickCounter;
        w.shrink();
        if (w.isTribulationOver()) this.endTribulation();
      }
      // v2.1.0 兜底：天劫超时（>1 日）仍未分胜负 → 强制收束（多幸存者时鉴定取最优）
      if (!this.tribulationEnded && w.tickCounter - this.tribulationStartTick > TRIBULATION_MAX_TICKS) {
        this.endTribulation();
      }
    }
  }

  private endTribulation(): void {
    this.tribulationEnded = true;
    this.paused = true;
    eventBus.emit(EVT.TRIBULATION_END, null);
    const data = this.world ? computeAppraisal(this.world, this.embryoGenome, this.save.finishedGames) : null;
    // v2.5.0：累计统计（本局 Chronicle → save.stats）
    if (this.world) accumulateStatsPure(this.save.stats, this.world);
    if (!data) {
      // 炼剑失败：剑意尽灭，无遗蜕可拾 → 不得剑尘 (仅炼成才得)
      this.save.finishedGames++;
      this.save.activeRun = false;
      this.saveGame();
      // v2.5.0：败局同样结算成就（百炼成钢等累计项）
      this.checkAchievements({ world: this.world, champion: null, score: null, rank: 0 });
      this.showDefeatModal();
      return;
    }
    // v2.5.0：结算成就（叙事/运营/涌现/累计）
    this.checkAchievements({ world: this.world, champion: data.winner.state, score: data.score, rank: 0 });
    this.appraisalData = data;
    // 持久化鉴定阶段：刷新后可回到「剑成鉴定」命名界面
    this.save.pendingScene = 'appraisal';
    this.save.pendingAppraisal = {
      winnerState: data.winner.state,
      score: data.score,
      breakdown: data.breakdown,
      tags: data.tags,
      tree: data.tree,
      populationHistory: data.populationHistory,
      totalTicks: data.totalTicks,
      tale: data.tale,
    };
    this.saveGame();
    this.showAppraisal(data);
  }

  /** 天劫失败弹窗：本局简况 + 快捷重开 (v1.10.0) */
  private showDefeatModal(): void {
    const w = this.world;
    const hist = w?.populationHistory ?? [];
    const peak = hist.length > 0 ? Math.max(...hist) : 0;
    let lastDay = 1;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i] > 0) {
        lastDay = Math.min(MAX_DAYS, Math.floor(i / (w?.config.dayTickLimit ?? TICKS_PER_DAY)) + 1);
        break;
      }
    }
    const body = el('div', 'defeat-modal');
    body.appendChild(el('p', '', '十日内一无所获，天劫之下剑意尽灭。'));
    body.appendChild(el('p', 'defeat-summary', `剑域曾至多 ${peak} 道剑意并存，第 ${lastDay} 日终归寂灭。`));
    // v2.5.0：败局札记——天劫尽灭亦有故事可述
    if (w) {
      const note = el('div', 'defeat-note');
      note.style.whiteSpace = 'pre-line';
      note.textContent = writeDefeatNote(w);
      body.appendChild(note);
    }
    body.appendChild(el('p', 'defeat-note', '剑意尽灭、无遗蜕可拾——剑尘需「炼成」方得，下次炼成自动淬入剑胚。'));
    const btnRow = el('div', 'modal-actions');
    const toMenu = el('button', 'btn btn-ghost', '返回主菜单');
    const again = el('button', 'btn btn-gold', '重新炼剑');
    btnRow.append(toMenu, again);
    body.appendChild(btnRow);
    const close = () => this.showMenu();
    toMenu.addEventListener('click', () => {
      overlay.remove();
      close();
    });
    again.addEventListener('click', () => {
      overlay.remove();
      this.showEmbryoSelect();
    });
    // v2.7.1：败局弹窗期间清掉渲染器/HUD/舞台——不再后台满帧渲染（胜利路径 showAppraisal 早已销毁）
    this.renderer?.destroy?.();
    this.renderer = null;
    this.hud?.destroy?.();
    this.hud = null;
    for (const child of this.app.stage.removeChildren()) child.destroy();
    const overlay = openModal('天劫之下 · 剑意尽灭', body, { width: 460, onClose: close });
  }

  // ================= 剑成鉴定 (评分/特质/悟道之树已迁至 simulation/Appraisal.ts, v2.8.2) =================
  private showAppraisal(data: AppraisalData): void {
    audio.setBgm(null); // 鉴定：静默仪式感
    audio.preload('battle'); // 预载大比曲，进入试剑台立即出声
    this.scene = 'appraisal';
    this.host.classList.remove('forge-screen');
    this.leaveFormation(); // v2.3.0
    this.hideCanvas();
    this.renderer?.destroy?.();
    this.renderer = null;
    this.hud?.destroy?.(); // v2.2.1：销毁 HUD，解绑 LOG 订阅
    this.hud = null;
    // v2.2.1：清空并销毁舞台残留（Pixi v7 removeChildren 只接受索引）
    for (const child of this.app.stage.removeChildren()) child.destroy();
    buildAppraisal(this.host, this, data);
  }

  finishAppraisal(name: string): void {
    const data = this.appraisalData;
    // v2.7.1：防重入——非鉴定场景或已结算（appraisalData 置空）直接忽略
    if (!data || this.scene !== 'appraisal') return;
    const winner = data.winner;
    const finalName = (name || '').trim() || '无名剑';
    // v2.5.0：以最终剑名定稿剑谱——世界仍在（炼成路径）→ 确定性重生成（仅名字不同）；
    // 刷新续玩路径（world 为 null，无法重生成）→ 直接注入剑名到已存剑谱
    let tale = data.tale;
    if (this.world) {
      tale = writeSwordTale(this.world, winner.state, this.save.finishedGames + 1, data.score, finalName);
    } else if (tale) {
      tale = { ...tale, heroName: finalName };
    }
    const ranked: RankedSword = {
      id: winner.state.id,
      name: finalName, // 防御：空名兜底，防历史数据 undefined 名剑
      element: winner.state.genome.element,
      genome: winner.state.genome,
      score: Math.round(data.score),
      tags: data.tags,
      date: nowDateStr(),
      dayReached: this.world?.config.currentDay ?? 10,
      wins: 0,
      tale: tale ?? undefined,
    };

    this.save.finishedGames++;
    this.save.activeRun = false;
    // v1.9.2：复用 RankingManager.submit (插入+排序+截断+排名+解锁计算)，消除内联重复
    const res = RankingManager.submit(ranked, this.save.history, this.save.unlockedMaterialIds);
    this.save.history = res.list;
    this.save.bestScore = Math.max(this.save.bestScore, ranked.score);
    const rank = res.rank;
    if (rank === 1) this.save.stats.totalFirstRanks++; // v2.5.0：登顶统计
    this.applyUnlocks(computeRankUnlocksPure(rank, this.save.history.length, this.save.unlockedMaterialIds));
    // v2.5.0：结算成就（万剑之王等榜单类）
    this.checkAchievements({ world: this.world, champion: winner.state, score: data.score, rank });
    // 持久化大比阶段：刷新后可回到试剑台
    const playerState = JSON.parse(JSON.stringify(winner.state)) as SwordState;
    this.save.pendingScene = 'tournament';
    this.save.pendingAppraisal = null;
    this.save.pendingBattlePlayerState = playerState;
    this.saveGame();

    this.appraisedRanked = ranked;
    this.battlePlayerState = playerState;
    this.battleStreak = 0; // v2.0.0：新剑入试剑台，连胜清零
    this.appraisalData = null; // v2.7.1：结算完成即清，防重复触发重复累加统计
    this.showTournament();

    if (rank > 0 && rank <= 20) {
      toast(`本命剑「${name}」登临万剑榜第 ${rank} 名！`);
    } else {
      toast('本命剑已炼成，且赴试剑台一决高下！');
    }
  }

  // ================= 宗门大比 =================
  private showTournament(): void {
    audio.setBgm('battle'); // 宗门大比 BGM
    this.scene = 'tournament';
    this.host.classList.remove('forge-screen');
    this.leaveFormation(); // v2.3.0
    this.hideCanvas();
    this.renderer?.destroy?.();
    this.renderer = null;
    this.hud?.destroy?.(); // v2.2.1：销毁 HUD，解绑 LOG 订阅
    this.hud = null;
    // v2.2.1：清空并销毁舞台残留（Pixi v7 removeChildren 只接受索引）
    for (const child of this.app.stage.removeChildren()) child.destroy();
    const player = this.appraisedRanked;
    if (!player) {
      this.showMenu();
      return;
    }
    const opponents: OpponentInfo[] = [
      ...NPC_OPPONENTS.map((o) => ({ ...o, isNPC: true })),
      // v2.0.0：万剑谱旧剑——与旧我论剑（跨局持久）
      ...this.save.swordCodex
        .filter((c) => c.id !== player.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          title: '旧我 · 万剑谱',
          difficulty: 1.25,
          genome: c.genome,
          tags: [...c.tags, '旧我论剑'],
          isNPC: false,
        })),
      ...this.save.history
        .filter((h) => h.id !== player.id)
        .slice(0, 3)
        .map((h) => ({
          id: h.id,
          name: h.name,
          title: '名剑',
          difficulty: 1.2,
          genome: h.genome,
          tags: h.tags,
          isNPC: false,
        })),
    ];
    const arts = SWORD_ARTS.filter((a) => !a.requireMaterial || this.save.unlockedMaterialIds.includes(a.requireMaterial));
    const ui = buildTournament(this.host, this, opponents, player.genome, player.name, arts);
    ui.setStreak(this.battleStreak);
  }

  startTournament(oppId: string, artId: string, ui: BattleUI): void {
    this.battleAccumulator = 0; // v2.2.1：开战清零，防上一战残量折算到首帧多步
    const opp = this.findOpponent(oppId);
    const playerState = this.battlePlayerState;
    const playerName = this.appraisedRanked?.name ?? '本命剑';
    if (!opp || !playerState) {
      ui.setResult(false, '缺少对阵数据。');
      ui.setRunning(false);
      return;
    }

    const duel = new Duel(
      {
        name: playerName,
        element: playerState.genome.element,
        genome: playerState.genome,
        art: artId,
        mindRealm: playerState.mindRealm ?? 0, // v1.12.0：剑心境界计入大比战力
      },
      {
        name: opp.name,
        element: opp.genome.element,
        genome: opp.genome,
      },
    );

    this.battle = { ui, opp, artId, duel, tick: 0, ended: false };

    ui.showDuel(
      {
        name: playerName,
        element: playerState.genome.element,
        affixes: playerState.genome.affixes ?? [],
        art: artId,
        isPlayer: true,
      },
      {
        name: opp.name,
        element: opp.genome.element,
        affixes: opp.genome.affixes ?? [],
        title: opp.title,
      },
    );

    // 开战仪式
    ui.pushEvents(
      [{ text: `试剑台上，${opp.name}抱剑而立，剑意如虹：「请！」`, kind: 'info', actor: 'npc' }],
      { hp: duel.p.hp, maxHp: duel.p.maxHp, energy: duel.p.energy, ap: duel.p.ap },
      { hp: duel.n.hp, maxHp: duel.n.maxHp, energy: duel.n.energy, ap: duel.n.ap },
    );
  }

  /** 玩家选择招式 */
  chooseTechnique(techId: string): void {
    const b = this.battle;
    if (!b) return;
    b.ui.hideTechniqueChoice();
    const events = b.duel.playerChoose(techId);
    if (events.length > 0) {
      b.ui.pushEvents(events, b.duel.p, b.duel.n);
    }
    this.checkBattleEnd();
  }

  private checkBattleEnd(): boolean {
    const b = this.battle;
    if (!b) return false;
    if (!b.duel.over && b.tick < BATTLE_TICK_LIMIT) return false;
    b.ended = true;
    this.finishBattle(b);
    return true;
  }

  private finishBattle(b: BattleRun): void {
    const playerWin = b.duel.winner === 'player';
    const playerHp = Math.max(0, b.duel.p.hp);
    // P1-12：hpRatio 按实际剑体上限而非硬编码 100，坚韧高者不再白拿分
    const hpRatio = Math.min(1, playerHp / Math.max(1, b.duel.p.maxHp));
    const points = playerWin
      ? Math.round(BATTLE_WIN_SCORE * b.opp.difficulty + hpRatio * 300)
      : Math.round(BATTLE_LOSE_SCORE * b.opp.difficulty);

    // v2.0.0：连胜——胜利 +1，失败断连；首胜本命剑入万剑谱
    if (playerWin) {
      this.battleStreak++;
      if (this.battleStreak === 1 && this.appraisedRanked) this.addToCodex(this.appraisedRanked);
    } else {
      this.battleStreak = 0;
    }

    if (this.appraisedRanked) {
      this.appraisedRanked.score += points;
      if (playerWin) this.appraisedRanked.wins++;
      const entry = this.save.history.find((h) => h.id === this.appraisedRanked!.id);
      if (entry) {
        entry.score = this.appraisedRanked.score;
        entry.wins = this.appraisedRanked.wins;
      }
      this.save.history = this.save.history.sort((a, c) => c.score - a.score).slice(0, RankingManager.TOP_N); // P0-5：截断结果重新赋值
      this.save.bestScore = Math.max(this.save.bestScore, this.appraisedRanked.score);
    }

    const rank = this.save.history.findIndex((h) => h.id === this.appraisedRanked?.id) + 1;
    this.applyUnlocks(computeRankUnlocksPure(rank, this.save.history.length, this.save.unlockedMaterialIds));

    if (playerWin && !this.save.hasBeatenFirstOpponent) {
      this.save.hasBeatenFirstOpponent = true;
      this.applyUnlocks(['beatFirstOpponent']);
    }
    this.saveGame();

    // v2.0.0：结算面板——胜负/分数/排名/连胜 + 失败「再战」重打当前对手
    b.ui.setStreak(this.battleStreak);
    const rankNote = rank > 0 && rank <= 20 ? ` · 万剑榜第 ${rank} 名` : ' · 未入万剑榜';
    b.ui.setResult(
      playerWin,
      playerWin ? '胜！' : '败。',
      playerWin
        ? `击败 ${b.opp.name}（难度 ×${b.opp.difficulty}）· +${points} 分 · 连胜 ${this.battleStreak} 场${rankNote}`
        : `惜败于 ${b.opp.name} · +${points} 分${rankNote}`,
      playerWin
        ? undefined
        : [
            {
              label: '再战',
              onClick: () => {
                // 重打当前对手（可反复挑战，直至胜过）
                b.ui.setRunning(true);
                this.startTournament(b.opp.id, b.artId, b.ui);
              },
            },
          ],
    );
    b.ui.setRunning(false);
  }

  /** v2.0.0：大比胜利后本命剑入万剑谱（≤5；满 5 弹 5 槽位替换交互） */
  private addToCodex(ranked: RankedSword): void {
    const codex = this.save.swordCodex;
    if (codex.some((c) => c.id === ranked.id)) return; // 已在谱，去重
    if (codex.length < 5) {
      codex.push({ ...ranked });
      this.saveGame();
      toast(`本命剑「${ranked.name}」录入万剑谱（${codex.length}/5）！`);
      return;
    }
    this.promptCodexReplace(ranked);
  }

  /** v2.0.0：万剑谱替换——弹 5 槽位：已有=点击替换，空位=点击新增；被替换的旧剑从谱中消失 */
  private promptCodexReplace(ranked: RankedSword): void {
    const codex = this.save.swordCodex;
    const body = el('div', 'codex-modal');
    body.appendChild(el('p', 'codex-hint', '万剑谱已满（5/5）。点击要替换的旧剑——被替换者将从谱中消失。'));
    const grid = el('div', 'codex-grid');
    const slotEls: HTMLElement[] = [];
    for (let i = 0; i < 5; i++) {
      const c = codex[i];
      const slot = el('div', 'codex-slot' + (c ? '' : ' empty'));
      slot.appendChild(c
        ? el('div', 'codex-slot-name', `${c.name}`)
        : el('div', 'codex-slot-name', `空位 ${i + 1}`));
      if (c) slot.appendChild(el('div', 'codex-slot-meta', `${Math.round(c.score)} 分 · 第 ${c.dayReached} 日炼成`));
      else slot.appendChild(el('div', 'codex-slot-meta', '点击放入新剑'));
      slot.addEventListener('click', () => {
        if (codex[i]) codex[i] = { ...ranked };
        else codex.push({ ...ranked });
        this.save.swordCodex = codex.slice(0, 5);
        this.saveGame();
        overlay.remove();
        toast(`本命剑「${ranked.name}」录入万剑谱！`);
      });
      slotEls.push(slot);
      grid.appendChild(slot);
    }
    body.appendChild(grid);
    const overlay = openModal('万剑谱 · 替换', body, { width: 520 });
  }

  private findOpponent(id: string): OpponentInfo | null {
    const npc = NPC_OPPONENTS.find((o) => o.id === id);
    if (npc) return { ...npc, isNPC: true };
    const hist = this.save.history.find((h) => h.id === id);
    if (hist) return { id: hist.id, name: hist.name, title: '名剑', difficulty: 1.2, genome: hist.genome, tags: hist.tags, isNPC: false };
    // v2.0.0：万剑谱旧剑
    const codex = this.save.swordCodex.find((c) => c.id === id);
    if (codex) return { id: codex.id, name: codex.name, title: '旧我 · 万剑谱', difficulty: 1.25, genome: codex.genome, tags: [...codex.tags, '旧我论剑'], isNPC: false };
    return null;
  }

  // ================= 解锁 (纯逻辑已迁至 data/Progression.ts, v2.8.2) =================
  private applyUnlocks(unlocks: MaterialUnlock[]): void {
    for (const name of applyUnlocksPure(unlocks, this.save.unlockedMaterialIds)) {
      toast(`🎉 解锁了「${name}」！`);
    }
  }

  // ================= 成就 (判定已迁至 data/Achievements.ts, v2.8.2) =================
  /** 结算时评估全部未解锁成就；新解锁 → toast + 存档 */
  private checkAchievements(ctx: AchievementCtx): void {
    const newly = evaluateNewAchievements(this.save, ctx);
    if (newly.length > 0) {
      const names = newly.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id);
      toast(names.length === 1 ? `🏆 成就解锁「${names[0]}」` : `🏆 成就解锁：${names.map((n) => `「${n}」`).join(' ')}`, 4200);
      this.saveGame();
    }
  }

  // ================= 存档 (序列化已迁至 data/SaveManager.buildGameSave, v2.8.2) =================
  saveGame(): void {
    const ok = SaveManager.save(buildGameSave(this.save, this.scene, this.world, this.embryoGenome));
    // v2.7.1：写入失败（存储已满/隐私模式）明确提示，防玩家不知情丢进度
    if (!ok) toast('⚠️ 存档写入失败——浏览器存储已满或不可用，进度可能无法保留');
  }

  // ================= Canvas =================
  private hideCanvas(): void {
    this.canvas.style.display = 'none';
  }

  private mountCanvas(host: HTMLElement | null): void {
    const view = this.canvas;
    if (host) {
      host.appendChild(view);
      view.style.display = 'block';
    } else {
      view.style.display = 'none';
    }
  }
}
