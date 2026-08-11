import { Application } from 'pixi.js';
import type { Element, Genome, RankedSword, SwordState, MaterialUnlock } from './types';
import { World } from './simulation/World';
import { SwordAgent } from './simulation/SwordAgent';
import { SimpleNN } from './simulation/NeuralNet';
import { WorldRenderer } from './ui/Renderer';
import { HUD } from './ui/HUD';
import { buildMenu, buildEmbryoSelect } from './ui/MenuScene';
import { openFurnacePanel, openDailyDropPanel, openTidePanel, type DailyDropKind } from './ui/DayPanel';
import { buildAppraisal, type AppraisalData, type EvoNode } from './ui/AppraisalScene';
import { buildTournament, type BattleUI, type OpponentInfo } from './ui/BattleScene';
import { openSwordDetail } from './ui/SwordDetail';
import { openRanking } from './ui/RankingView';
import { openCodex } from './ui/CodexView';
import { SaveManager, defaultSave, type GameSave } from './data/SaveManager';
import { getMaterial, RECIPES } from './data/RecipeDB';
import { RankingManager } from './data/RankingManager';
import { SWORD_ARTS } from './data/SwordArts';
import { NPC_OPPONENTS } from './data/NPCs';
import { randomGenome, genomeSimilarity, genomeSum, ELEMENT_LABEL, randomWildGenome, randomMildGenome, randomFierceGenome } from './simulation/Genetics';
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
  TOTAL_TICKS,
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
  MAX_HP,
  ENERGY_SPLIT_THRESHOLD,
  MIND_MAX_BONUS,
  mindSizes,
} from './constants';
import { Duel } from './simulation/Duel';
import { MIND_SKILL_BY_ID, MIND_SKILL_POOLS } from './simulation/Skills';

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
  /** 本命血脉断绝后是否已弹过「重新种下剑胚」的提示 */
  seedExtinctPrompted = false;
  /** v1.11.0：上次「本命血脉已绝」弹窗所在日 (同日重种又死不再弹，避免弹窗疲劳) */
  private lastReseedPromptDay = -1;
  private tickAccumulator = 0;
  private battleAccumulator = 0;

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
    // 点击剑意 → 查看灵鉴
    this.canvas.addEventListener('click', (e) => {
      if (this.scene !== 'forge' || !this.world) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_WIDTH);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_HEIGHT);
      const id = this.world.swordIdAt(x, y);
      this.focusSword(id);
    });
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
    // P3：离开炼剑/大比场景时销毁渲染器，解绑其粒子监听
    this.renderer?.destroy?.();
    this.renderer = null;
    buildMenu(this.host, this);
  }

  showEmbryoSelect(): void {
    audio.preload('forge'); // 预载剑意曲，进入炼剑立即出声
    this.scene = 'embryo';
    this.host.classList.remove('forge-screen');
    this.hideCanvas();
    buildEmbryoSelect(this.host, this);
  }

  showRanking(): void {
    openRanking(this);
  }

  showCodex(): void {
    openCodex(this);
  }

  // ================= 开局 =================
  /** P0-3：有进行中的局/鉴定/大比时，先确认是否放弃再开新局 */
  startNewRun(element: Element): void {
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
        this.doStartNewRun(element);
      });
      return;
    }
    this.doStartNewRun(element);
  }

  private doStartNewRun(element: Element): void {
    this.embryoGenome = randomGenome(element);

    const world = new World();
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

    this.save.activeRun = true;
    this.save.embryoGenome = this.embryoGenome;
    this.save.day = 1;
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
    const world = new World({ currentDay: this.save.day });
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
    const w = new World({ currentDay: this.save.day });
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
    this.hud.onMaterialClick(() => this.openFurnacePanel());
    this.hud.onTideClick(() => this.openTidePanel()); // v1.11.0
    this.hud.onReseedClick(() => this.tryReseed()); // v1.11.0
    this.hud.focusHandler = (id) => this.focusSword(id);
    this.refreshHudControls();
    this.mountCanvas(this.hud.canvasHost);
    this.app.stage.removeChildren();
    this.renderer?.destroy?.();
    this.renderer = new WorldRenderer(this.app.stage, GRID_WIDTH, GRID_HEIGHT, 10);
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
    this.hud?.setFurnaceEnabled(this.hasMaterialLeft() && this.scene === 'forge');
    this.hud?.setFeedState(this.feedRemaining(), () => this.dropFood());
  }

  private hasMaterialLeft(): boolean {
    return Object.values(this.save.materialCounts).some((c) => c > 0);
  }

  /** 当前仍可投食的庚金之气团数 */
  feedRemaining(): number {
    return DAILY_FOOD_DROP - this.save.feedDropped;
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
    const overlay = openModal('剑心 · 绝技', body, { width: 540 });
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

  /** 弹窗：本命血脉断绝，询问是否重新种下剑胚 */
  private promptReseed(): void {
    const w = this.world;
    if (!w) return;
    this.lastReseedPromptDay = w.config.currentDay; // v1.11.0：记录弹窗日，同日不再重复弹
    const body = el('div', 'reseed-modal');
    body.appendChild(el('p', '', '本命血脉已然断绝，剑域之中再无你的剑胚一脉。'));
    body.appendChild(el('p', 'reseed-sub', '是否重新种下一道本命剑胚，再续凡铁？'));
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
    const overlay = openModal('本命血脉已绝', body, {
      width: 540,
      onClose: closeAndResume,
    });
    yes.addEventListener('click', () => {
      overlay.remove();
      this.reseedLineage();
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

  /** 重新种下一道本命剑胚 (血统重启，仅此一柄) */
  private reseedLineage(): void {
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
    const genome: Genome = this.embryoGenome ? { ...this.embryoGenome, affixes: [] } : randomGenome('metal');
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
    this.seedExtinctPrompted = false; // 未来再绝，仍可再问
    eventBus.emit(EVT.LOG, {
      text: '你重新种下一道本命剑胚，凡铁再续。',
      focusId: st.id,
      important: true,
    });
    toast('🌱 本命剑胚重新种下');
    this.saveGame();
  }

  /** HUD 手动重种本命 (v1.11.0)：本命血脉已绝时可调 */
  tryReseed(): void {
    if (this.scene !== 'forge' || !this.world) return;
    if (!this.seedLineageExtinct()) {
      toast('本命血脉尚在，无需重种。');
      return;
    }
    this.reseedLineage();
  }

  /** 剑潮偏好面板 (v1.11.0)：随时修改本局剑潮选择/免弹窗，不立即投放 */
  openTidePanel(): void {
    if (this.scene !== 'forge') return;
    this.paused = true;
    this.refreshHudControls();
    openTidePanel(this, () => {
      if (this.scene === 'forge') {
        this.paused = false;
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

  openFurnacePanel(): void {
    if (this.scene !== 'forge') return;
    this.paused = true;
    this.refreshHudControls();
    openFurnacePanel(this, () => {
      if (this.scene === 'forge') {
        this.paused = false;
        this.refreshHudControls();
      }
    });
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
    const range = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
    let spawned = 0;
    let label = '默许天意';
    // v2.2.0：凶潮投洞玄（剑心 2 级）剑意——NN 用洞玄容量、上限随境界抬升、随机洞玄绝技，打破种群优势
    const spawnBatch = (n: number, make: () => Genome, opts?: { mindRealm?: number }) => {
      for (let i = 0; i < n; i++) {
        const realm = opts?.mindRealm ?? 0;
        const brain = new SimpleNN(realm > 0 ? mindSizes(realm) : NN_LAYERS);
        let mindSkillIds: string[] | undefined;
        if (realm > 0) {
          const pool = MIND_SKILL_POOLS[realm - 1] ?? [];
          if (pool.length > 0) mindSkillIds = [pool[randomInt(0, pool.length - 1)].id];
        }
        const maxHp = MAX_HP + MIND_MAX_BONUS * realm;
        const maxEnergy = ENERGY_SPLIT_THRESHOLD + MIND_MAX_BONUS * realm;
        if (w.spawnWildSword(make(), brain, { mindRealm: realm, maxHp, maxEnergy, mindSkillIds })) spawned++;
      }
    };
    switch (kind) {
      case 'mild':
        spawnBatch(range(2, 3), () => randomMildGenome(day));
        label = '温养之潮';
        break;
      case 'tide':
        spawnBatch(range(6, 8), () => randomWildGenome(day));
        label = '剑潮汹涌';
        break;
      case 'fierce':
        spawnBatch(range(2, 3), () => randomFierceGenome(day), { mindRealm: 2 }); // v2.2.0：凶潮投洞玄剑意
        label = '天外凶潮';
        break;
      case 'none':
        label = '静待天时';
        break;
      default: {
        const r = Math.random();
        if (r < 0.34) {
          spawnBatch(range(2, 3), () => randomMildGenome(day));
          label = '温养之潮';
        } else if (r < 0.67) {
          spawnBatch(range(6, 8), () => randomWildGenome(day));
          label = '剑潮汹涌';
        } else {
          // auto 默许天意：凶潮为普通凡心（洞玄凶剑只限玩家主动选「天外凶潮」，防无干预局被高境剑碾压致种群崩溃）
          spawnBatch(range(2, 3), () => randomFierceGenome(day));
          label = '天外凶潮';
        }
      }
    }
    if (spawned > 0) eventBus.emit(EVT.LOG, `第${day}日子时，${label}降下${spawned}道游离剑意。`);
    else if (kind === 'none') eventBus.emit(EVT.LOG, `第${day}日子时：你未投剑意，剑域唯余余波自涌。`);
    else eventBus.emit(EVT.LOG, `第${day}日子时：剑域已无立足之地，${label}竟无处落脚。`); // P3：网格饱和时也给出反馈
    if (this.hud && this.world) this.hud.update(this.world);
    this.saveGame(); // v1.10.0：剑潮选择即时落盘 (防刷新丢失记忆/勾选)
  }

  /** 手动投食 (随时可施，每日限量) */
  dropFood(): void {
    const w = this.world;
    if (!w || this.tribulationEnded) return;
    if (this.feedRemaining() <= 0) return;
    let dropped = 0;
    for (let i = 0; i < FOOD_DROP_BATCH; i++) {
      if (w.dropFoodAtRandom()) dropped++;
    }
    this.save.feedDropped = Math.min(DAILY_FOOD_DROP, this.save.feedDropped + dropped); // P1-10：按实际落下的团数计，空投不扣配额
    if (dropped > 0) eventBus.emit(EVT.LOG, `你撒下一捧庚金之气，${dropped}团落入剑域。`);
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
        break;
      case 'spawnFireWalls':
        w.spawnFireWalls(m.effect.count);
        break;
      case 'allSpeedBonus':
        w.modifiers.speedBonus += m.effect.value;
        break;
      case 'temperature':
        w.modifiers.temperature = m.effect.value;
        break;
      case 'mutationBias':
        w.modifiers.mutationBias = { stat: m.effect.stat, rateMult: m.effect.rateMult, sideEffect: m.effect.sideEffect };
        break;
      case 'thunderstorm':
        w.modifiers.thunderstorm = true;
        break;
      case 'megaFood':
        w.spawnMegaFood(m.effect.count);
        w.modifiers.aggressionBonus += 0.3;
        break;
    }
    eventBus.emit(EVT.LOG, `炉府中加入「${m.name}」，剑域气象随之而变。`);
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
      this.renderer?.render(this.world, this.frame);
      if (!this.paused) {
        const tps = TICKS_PER_SECOND * this.speed;
        this.tickAccumulator += dt;
        let budget = Math.floor(this.tickAccumulator * tps);
        if (budget > 0) {
          this.tickAccumulator -= budget / tps;
          budget = Math.min(budget, 120);
          for (let i = 0; i < budget; i++) {
            this.runTick();
            if (this.tribulationEnded) break;
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
          this.promptReseed();
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
      if (this.frame % 6 === 0) this.hud?.update(this.world);
      this.hud?.setFurnaceEnabled(this.hasMaterialLeft() && !this.tribulationEnded);
      this.hud?.setFeedState(this.feedRemaining(), () => this.dropFood());
    } else if (this.scene === 'tournament' && this.battle && !this.battle.ended) {
      // 玩家选招时暂停蓄条
      if (!this.battle.duel.pNeedsChoice) {
        this.battleAccumulator += dt;
        let budget = Math.floor(this.battleAccumulator * BATTLE_TPS);
        if (budget > 0) {
          this.battleAccumulator -= budget / BATTLE_TPS;
          budget = Math.min(budget, 60);
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
      this.save.feedDropped = 0; // 新一日，投食之量恢复
      this.saveGame();
      eventBus.emit(EVT.DAY_START, day);
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
    const data = this.computeAppraisal();
    if (!data) {
      // 炼剑失败：剑意尽灭，无遗蜕可拾 → 不得剑尘 (仅炼成才得)
      this.save.finishedGames++;
      this.save.activeRun = false;
      this.saveGame();
      this.showDefeatModal();
      return;
    }
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
    const overlay = openModal('天劫之下 · 剑意尽灭', body, { width: 460, onClose: close });
  }

  // ================= 剑成鉴定 =================
  private computeAppraisal(): AppraisalData | null {
    const w = this.world;
    if (!w) return null;
    const survivors = [...w.swords.values()];
    if (survivors.length === 0) return null;
    const embryo = this.embryoGenome;
    const totalTicks = TOTAL_TICKS;

    const scored = survivors.map((s) => {
      const tags = this.computeTags(s);
      const survivalRatio = Math.min(1, s.state.age / totalTicks);
      const sim = embryo ? genomeSimilarity(s.state.genome, embryo) : 0.5;
      const sum = genomeSum(s.state.genome);
      const behaviorBonus = Math.min(15, 5 + tags.length * 5);
      const score = survivalRatio * 10 + sim * 20 + sum * 0.5 + behaviorBonus;
      return { s, tags, score, survivalRatio, sim, sum, behaviorBonus };
    });
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];
    const tree = this.buildEvolutionTree(winner.s.state.id);
    return {
      winner: winner.s,
      score: Math.round(winner.score * 10) / 10,
      breakdown: [
        { label: `存续 ${(winner.survivalRatio * 100).toFixed(0)}%`, value: winner.survivalRatio * 10 },
        { label: '血脉相承', value: winner.sim * 20 },
        { label: '剑谱总和', value: winner.sum * 0.5 },
        { label: '本性殊异', value: winner.behaviorBonus },
      ],
      tags: winner.tags,
      tree,
      populationHistory: w.populationHistory,
      totalTicks,
    };
  }

  private computeTags(s: SwordAgent): string[] {
    const b = s.behavior;
    const tags: string[] = [];
    if (b.killCount >= 3) tags.push('斩念成性');
    if (b.eatCount >= 20) tags.push('吞金成性'); // 与 eat30 词条门槛一致
    if (b.minHp > 60) tags.push('百炼之体');
    if (b.cellsVisited >= 350 && b.cellsVisited / Math.max(1, s.state.age) >= 0.35) tags.push('游历万方'); // 与 roam400 词条门槛一致 (v1.11.0：足迹+游走密度)
    if (b.waitCount >= 200 && s.state.age > 2000) tags.push('静若渊渟');
    if (s.state.survivedThunder) tags.push('雷劫余生'); // v1.9.1：个体经历 (曾历雷击而存续)，不再按世界级开关全员标注
    return tags.slice(0, 3);
  }

  private buildEvolutionTree(winnerId: string): EvoNode[] {
    const w = this.world;
    if (!w) return [];
    const chain: { id: string; generation: number; day: number; element: Element }[] = [];
    let id = winnerId;
    let guard = 0;
    let chainRootId = '';
    while (id && guard++ < 2000) {
      const info = w.lineage.get(id);
      if (!info) break;
      chain.push({ id, generation: info.generation, day: info.day, element: info.element });
      chainRootId = id;
      id = info.parentId;
    }
    // v1.11.0：血统溯源——链根为本命剑胚才拼接胚源；
    // 若本命剑是外来剑意（剑潮投放的独立血脉），其树根即外来根，勿拼接成本命后代误导血缘
    const rootIsSeed = chainRootId === w.rootId;
    const rootElement = rootIsSeed
      ? (this.embryoGenome?.element ?? chain[chain.length - 1]?.element ?? 'metal')
      : chain[chain.length - 1]?.element ?? 'metal';
    if (rootIsSeed) {
      chain.push({ id: w.rootId ?? 'root', generation: 1, day: 0, element: rootElement });
    }
    chain.reverse();

    const childrenCount = (parentId: string): number => {
      let n = 0;
      for (const v of w.lineage.values()) if (v.parentId === parentId) n++;
      return n;
    };

    return chain.map((n, i) => {
      const isWinner = i === chain.length - 1;
      let label = '血脉延续';
      if (i === 0) label = rootIsSeed ? '凡铁剑意' : '外来剑意';
      else if (n.element !== chain[i - 1].element) label = '血脉蜕变';
      if (isWinner) label = '本命剑';
      return { id: n.id, generation: n.generation, day: n.day, label, children: childrenCount(n.id), element: n.element, isWinner };
    });
  }

  private showAppraisal(data: AppraisalData): void {
    audio.setBgm(null); // 鉴定：静默仪式感
    audio.preload('battle'); // 预载大比曲，进入试剑台立即出声
    this.scene = 'appraisal';
    this.host.classList.remove('forge-screen');
    this.hideCanvas();
    this.renderer?.destroy?.();
    this.renderer = null;
    buildAppraisal(this.host, this, data);
  }

  finishAppraisal(name: string): void {
    const data = this.appraisalData;
    if (!data) return;
    const winner = data.winner;
    const ranked: RankedSword = {
      id: winner.state.id,
      name: (name || '').trim() || '无名剑', // 防御：空名兜底，防历史数据 undefined 名剑
      element: winner.state.genome.element,
      genome: winner.state.genome,
      score: Math.round(data.score),
      tags: data.tags,
      date: nowDateStr(),
      dayReached: this.world?.config.currentDay ?? 10,
      wins: 0,
    };

    this.save.finishedGames++;
    this.save.activeRun = false;
    // v1.9.2：复用 RankingManager.submit (插入+排序+截断+排名+解锁计算)，消除内联重复
    const res = RankingManager.submit(ranked, this.save.history, this.save.unlockedMaterialIds);
    this.save.history = res.list;
    this.save.bestScore = Math.max(this.save.bestScore, ranked.score);
    const rank = res.rank;
    this.applyUnlocks(this.computeRankUnlocks(rank));
    // 持久化大比阶段：刷新后可回到试剑台
    const playerState = JSON.parse(JSON.stringify(winner.state)) as SwordState;
    this.save.pendingScene = 'tournament';
    this.save.pendingAppraisal = null;
    this.save.pendingBattlePlayerState = playerState;
    this.saveGame();

    this.appraisedRanked = ranked;
    this.battlePlayerState = playerState;
    this.battleStreak = 0; // v2.0.0：新剑入试剑台，连胜清零
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
    this.hideCanvas();
    this.renderer?.destroy?.();
    this.renderer = null;
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
    this.applyUnlocks(this.computeRankUnlocks(rank));

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

  // ================= 解锁 =================
  /** 排名解锁需榜单有一定规模，保持成长曲线 (3 柄名剑以上) */
  private computeRankUnlocks(rank: number): MaterialUnlock[] {
    if (rank <= 0) return []; // P3：rank=0 (未上榜) 时不解锁，避免 evaluateUnlocks 误判 0<=10
    if (this.save.history.length < 3) return [];
    return RankingManager.evaluateUnlocks(rank, this.save.unlockedMaterialIds);
  }

  private applyUnlocks(unlocks: MaterialUnlock[]): void {
    for (const u of unlocks) {
      for (const m of RECIPES) {
        if (m.unlock === u && !this.save.unlockedMaterialIds.includes(m.id)) {
          this.save.unlockedMaterialIds.push(m.id);
          toast(`🎉 解锁了「${m.name}」！`);
        }
      }
    }
  }

  // ================= 存档 =================
  private exportSave(): GameSave {
    return {
      version: 1,
      unlockedMaterialIds: this.save.unlockedMaterialIds,
      history: this.save.history,
      bestScore: this.save.bestScore,
      finishedGames: this.save.finishedGames,
      hasBeatenFirstOpponent: this.save.hasBeatenFirstOpponent,
      swordCodex: this.save.swordCodex,
      activeRun: this.scene === 'forge' && !!this.world,
      embryoGenome: this.embryoGenome,
      day: this.world?.config.currentDay ?? 1,
      tickCounter: this.world?.tickCounter ?? 0,
      materialCounts: this.save.materialCounts,
      feedDropped: this.save.feedDropped,
      swords: this.world
        ? [...this.world.swords.values()].map((a) => ({
            ...a.state,
            // v1.12.0：从活 brain 取权重（剑心扩容后 state 快照可能过期）
            brainWeights: a.brain.getWeights(),
            brainBiases: a.brain.getBiases(),
            behavior: a.behavior,
          }))
        : [],
      rootId: this.world?.rootId ?? null,
      maxGeneration: this.world?.maxGeneration ?? 1,
      eco: this.world ? this.world.exportEcoState() : null,
      pendingScene: this.save.pendingScene,
      pendingAppraisal: this.save.pendingAppraisal,
      pendingBattlePlayerState: this.save.pendingBattlePlayerState,
    };
  }

  saveGame(): void {
    SaveManager.save(this.exportSave());
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
