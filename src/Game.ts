import { Application } from 'pixi.js';
import type { Element, Genome, RankedSword, SwordState, MaterialUnlock } from './types';
import { World } from './simulation/World';
import { SwordAgent } from './simulation/SwordAgent';
import { SimpleNN } from './simulation/NeuralNet';
import { WorldRenderer } from './ui/Renderer';
import { HUD } from './ui/HUD';
import { buildMenu, buildEmbryoSelect } from './ui/MenuScene';
import { openFurnacePanel, openDailyDropPanel, type DailyDropKind } from './ui/DayPanel';
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
  NN_LAYERS,
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
} from './constants';
import { Duel } from './simulation/Duel';

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
  embryoGenome: Genome | null = null;
  emergenceCelebrated = false;
  selectedSwordId: string | null = null;
  emergenceTargetId: string | null = null;
  /** 本命血脉断绝后是否已弹过「重新种下剑胚」的提示 */
  seedExtinctPrompted = false;
  private tickAccumulator = 0;
  private battleAccumulator = 0;

  appraisedRanked: RankedSword | null = null;
  battlePlayerState: SwordState | null = null;
  battle: BattleRun | null = null;
  private appraisalData: AppraisalData | null = null;

  private saveTimer = 0;
  private frame = 0;

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
  }

  /** Pixi 画布 (断言为 HTMLCanvasElement) */
  private get canvas(): HTMLCanvasElement {
    return this.app.view as unknown as HTMLCanvasElement;
  }

  // ================= 场景 =================
  showMenu(): void {
    this.scene = 'menu';
    this.host.classList.remove('forge-screen');
    this.paused = true;
    this.battle = null;
    this.hideCanvas();
    // P3：离开炼剑/大比场景时销毁渲染器，解绑其粒子监听
    this.renderer?.destroy?.();
    this.renderer = null;
    buildMenu(this.host, this);
  }

  showEmbryoSelect(): void {
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

  hasSwordDust(): boolean {
    return this.save.hasSwordDust;
  }

  // ================= 开局 =================
  /** P0-3：有进行中的局时，先确认是否放弃再开新局 */
  startNewRun(element: Element): void {
    if (this.save.activeRun) {
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
    // 剑尘遗蜕：开局自动淬入 (消耗 hasSwordDust，不与此局炉府 sword_dust 次数叠加)
    if (this.save.hasSwordDust) {
      const g = this.embryoGenome;
      g.sharpness += 0.5;
      g.toughness += 0.5;
      g.speed += 0.5;
      g.perception += 0.5;
      this.save.hasSwordDust = false;
    }

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
    this.appraisalData = null;
    this.appraisedRanked = null;
    this.battlePlayerState = null;
    this.emergenceCelebrated = false;
    this.seedExtinctPrompted = false;
    this.selectedSwordId = null;
    this.emergenceTargetId = null;

    // 炉材次数初始化 (已解锁材料按可用次数)
    this.save.materialCounts = {};
    for (const m of RECIPES) {
      if (this.save.unlockedMaterialIds.includes(m.id)) {
        this.save.materialCounts[m.id] = m.count;
      }
    }
    this.save.feedDropped = 0;

    this.save.activeRun = true;
    this.save.embryoElement = element;
    this.save.embryoGenome = this.embryoGenome;
    this.save.day = 1;
    this.save.tickCounter = 0;

    this.buildForgeScene();
    this.saveGame(); // P0-4：先切场景为 forge 再存档，避免 activeRun 被存为 false
    this.paused = true;
    this.openDailyDropPanelForDay(1); // 第1日子时剑潮
    eventBus.emit(EVT.LOG, `${ELEMENT_LABEL[element]}行剑胚落入剑域，凡铁自此而始。`);
  }

  continueRun(): void {
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
      const brain = new SimpleNN(NN_LAYERS, false);
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
    this.appraisalData = null;
    this.emergenceCelebrated = false;
    this.seedExtinctPrompted = false;
    this.buildForgeScene();
    this.paused = false;
  }

  // ================= 炼剑主界面 =================
  private buildForgeScene(): void {
    this.scene = 'forge';
    this.host.classList.add('forge-screen');
    clearNode(this.host);
    // P1-1：销毁旧 HUD，解绑其 LOG 监听，防止多局重复触发
    this.hud?.destroy?.();
    this.hud = new HUD(this.host);
    this.hud.onMaterialClick(() => this.openFurnacePanel());
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
          if (this.scene === 'forge') {
            this.paused = false;
            this.refreshHudControls();
          }
        });
      } else {
        // 指向已陨落的剑意 (如点击「悟得词条」日志但该剑已死) → 明确反馈
        toast('该剑意已陨落，无从聚焦。');
      }
    }
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
    const body = el('div', 'reseed-modal');
    body.appendChild(el('p', '', '本命血脉已然断绝，剑域之中再无你的剑胚一脉。'));
    body.appendChild(el('p', 'reseed-sub', '是否重新种下一道本命剑胚，再续凡铁？'));
    const btnRow = el('div', 'modal-actions');
    const no = el('button', 'btn btn-ghost', '罢了');
    const yes = el('button', 'btn btn-gold', '重新种下');
    btnRow.append(no, yes);
    body.appendChild(btnRow);

    const closeAndResume = () => {
      if (this.scene === 'forge') {
        this.paused = false;
        this.refreshHudControls();
      }
    };
    const overlay = openModal('本命血脉已绝', body, {
      width: 480,
      onClose: closeAndResume,
    });
    yes.addEventListener('click', () => {
      overlay.remove();
      this.reseedLineage();
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
    const day = w.config.currentDay;
    const range = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
    let spawned = 0;
    let label = '默许天意';
    const spawnBatch = (n: number, make: () => Genome) => {
      for (let i = 0; i < n; i++) {
        const brain = new SimpleNN(NN_LAYERS);
        if (w.spawnWildSword(make(), brain)) spawned++;
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
        spawnBatch(range(2, 3), () => randomFierceGenome(day));
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
          spawnBatch(range(2, 3), () => randomFierceGenome(day));
          label = '天外凶潮';
        }
      }
    }
    if (spawned > 0) eventBus.emit(EVT.LOG, `第${day}日子时，${label}降下${spawned}道游离剑意。`);
    else if (kind === 'none') eventBus.emit(EVT.LOG, `第${day}日子时：你未投剑意，剑域唯余余波自涌。`);
    else eventBus.emit(EVT.LOG, `第${day}日子时：剑域已无立足之地，${label}竟无处落脚。`); // P3：网格饱和时也给出反馈
    if (this.hud && this.world) this.hud.update(this.world);
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
        if (!this.tribulationEnded && !this.seedExtinctPrompted && this.seedLineageExtinct()) {
          this.seedExtinctPrompted = true;
          eventBus.emit(EVT.LOG, {
            text: `第${this.world.config.currentDay}日：本命血脉已然断绝，剑域之中再无剑胚一脉。`,
            important: true,
          });
          this.paused = true;
          this.refreshHudControls();
          this.promptReseed();
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
    // 第10天：天劫收束
    if (day >= MAX_DAYS && !this.tribulationEnded) {
      w.config.spawnFood = false;
      w.config.isShrinking = true;
      if (w.tickCounter - this.lastShrinkTick >= SHRINK_INTERVAL_TICKS) {
        this.lastShrinkTick = w.tickCounter;
        w.shrink();
        if (w.isTribulationOver()) this.endTribulation();
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
      toast('天劫之下剑意尽灭，十日内一无所获。');
      this.showMenu();
      return;
    }
    this.appraisalData = data;
    this.showAppraisal(data);
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
    if (b.eatCount >= 25) tags.push('吞金成性');
    if (b.minHp > 60) tags.push('百炼之体');
    if (b.cellsVisited >= 200) tags.push('游历万方');
    if (b.waitCount >= 200 && s.state.age > 2000) tags.push('静若渊渟');
    if (this.world?.modifiers.thunderstorm) tags.push('雷劫余生');
    return tags.slice(0, 3);
  }

  private buildEvolutionTree(winnerId: string): EvoNode[] {
    const w = this.world;
    if (!w) return [];
    const chain: { id: string; generation: number; day: number; element: Element }[] = [];
    let id = winnerId;
    let guard = 0;
    while (id && guard++ < 2000) {
      const info = w.lineage.get(id);
      if (!info) break;
      chain.push({ id, generation: info.generation, day: info.day, element: info.element });
      id = info.parentId;
    }
    const rootElement = this.embryoGenome?.element ?? chain[chain.length - 1]?.element ?? 'metal';
    chain.push({ id: w.rootId ?? 'root', generation: 1, day: 0, element: rootElement });
    chain.reverse();

    const childrenCount = (parentId: string): number => {
      let n = 0;
      for (const v of w.lineage.values()) if (v.parentId === parentId) n++;
      return n;
    };

    return chain.map((n, i) => {
      const isWinner = i === chain.length - 1;
      let label = '血脉延续';
      if (i === 0) label = '凡铁剑意';
      else if (n.element !== chain[i - 1].element) label = '血脉蜕变';
      if (isWinner) label = '本命剑';
      return { id: n.id, generation: n.generation, day: n.day, label, children: childrenCount(n.id), element: n.element, isWinner };
    });
  }

  private showAppraisal(data: AppraisalData): void {
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
      name,
      element: winner.state.genome.element,
      genome: winner.state.genome,
      score: Math.round(data.score),
      tags: data.tags,
      date: nowDateStr(),
      dayReached: this.world?.config.currentDay ?? 10,
      wins: 0,
    };

    this.save.hasSwordDust = true; // 炼成之剑，遗蜕为尘（失败不得，见 endTribulation）
    this.save.finishedGames++;
    this.save.activeRun = false;
    this.save.history.push(ranked);
    // P0-5：截断结果必须重新赋值，否则 history 无限增长
    this.save.history = this.save.history
      .sort((a, b) => b.score - a.score || b.dayReached - a.dayReached)
      .slice(0, RankingManager.TOP_N);
    this.save.bestScore = Math.max(this.save.bestScore, ranked.score);

    const rank = this.save.history.findIndex((s) => s.id === ranked.id) + 1;
    this.applyUnlocks(this.computeRankUnlocks(rank));
    this.saveGame();

    this.appraisedRanked = ranked;
    this.battlePlayerState = JSON.parse(JSON.stringify(winner.state)) as SwordState;
    this.showTournament();

    if (rank > 0 && rank <= 20) {
      toast(`本命剑「${name}」登临万剑榜第 ${rank} 名！`);
    } else {
      toast('本命剑已炼成，且赴试剑台一决高下！');
    }
  }

  // ================= 宗门大比 =================
  private showTournament(): void {
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
    buildTournament(this.host, this, opponents, player.genome, player.name, arts);
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

    // P1-2：用 textContent 渲染 (setResult 内部)，避免用户命名的剑名注入 HTML
    b.ui.setResult(
      playerWin,
      playerWin ? '胜！' : '败。',
      playerWin
        ? `击败 ${b.opp.name}（难度 ×${b.opp.difficulty}）· 获得 ${points} 分`
        : `惜败于 ${b.opp.name} · 获得 ${points} 分`,
    );
    b.ui.setRunning(false);
  }

  private findOpponent(id: string): OpponentInfo | null {
    const npc = NPC_OPPONENTS.find((o) => o.id === id);
    if (npc) return { ...npc, isNPC: true };
    const hist = this.save.history.find((h) => h.id === id);
    if (hist) return { id: hist.id, name: hist.name, title: '名剑', difficulty: 1.2, genome: hist.genome, tags: hist.tags, isNPC: false };
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
      hasSwordDust: this.save.hasSwordDust,
      activeRun: this.scene === 'forge' && !!this.world,
      embryoElement: this.embryoGenome?.element ?? null,
      embryoGenome: this.embryoGenome,
      day: this.world?.config.currentDay ?? 1,
      tickCounter: this.world?.tickCounter ?? 0,
      materialCounts: this.save.materialCounts,
      feedDropped: this.save.feedDropped,
      swords: this.world ? [...this.world.swords.values()].map((a) => ({ ...a.state, behavior: a.behavior })) : [],
      rootId: this.world?.rootId ?? null,
      maxGeneration: this.world?.maxGeneration ?? 1,
      eco: this.world ? this.world.exportEcoState() : null,
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
