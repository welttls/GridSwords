import type { Genome, SwordState, WorldConfig, WorldModifiers } from '../types';
import { SwordAgent } from './SwordAgent';
import { SimpleNN } from './NeuralNet';
import { ELEMENT_LABEL } from './Genetics';
import { resolveBattle } from './BattleResolver';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  FOOD_MAX,
  FOOD_REGEN_RATE,
  FOOD_ENERGY,
  TICKS_PER_DAY,
  SHRINK_TARGET_SPAN,
  SHRINK_LOG_INTERVAL_TICKS,
  MAX_HP,
  ENERGY_SPLIT_THRESHOLD,
  MUTATION_RATE,
  MEGA_FOOD_ENERGY,
  TRIBULATION_LIGHTNING_DMG,
  TRIBULATION_LIGHTNING_ENERGY,
  TRIBULATION_LIGHTNING_BASE,
  TRIBULATION_LIGHTNING_RAMP,
  TRIBULATION_AGGRESSION_BONUS,
  type TerrainType,
} from '../constants';
import { clamp, shuffle, uid, randomInt } from '../utils/mathUtils';
import { maxHpOf, maxEnergyOf } from './swordStats';
import { eventBus, EVT } from '../utils/eventBus';
import { Chronicle, type DeathCause } from './Chronicle';

export interface LineageNode {
  parentId: string;
  day: number;
  generation: number;
  element: import('../types').Element;
}

/**
 * 剑域世界：管理网格、剑意、庚金之气、火墙与天劫收缩。
 * 与渲染完全解耦，可 headless 运行。
 */
export class World {
  config: WorldConfig;
  modifiers: WorldModifiers;
  swords = new Map<string, SwordAgent>();
  mutationRate = MUTATION_RATE;

  tickCounter = 0;
  maxGeneration = 1;
  /** v2.5.0：剑域纪事——结构化事件采集层（剑谱叙事/成就共用；随 World 生灭，不持久化） */
  chronicle: Chronicle;
  /** 血统溯源 (id -> 父信息) */
  lineage = new Map<string, LineageNode>();
  rootId: string | null = null;
  /** v2.3.0：奇遇种子——同时最多 1 颗存活；被剑意取得后清除，可再放置/随机出现 */
  encounterSeed: { x: number; y: number; id: string; spawnedTick: number } | null = null;
  populationHistory: number[] = [];
  /** 天劫收缩日志上次上报 tick（节流用，v2.2.0） */
  private lastShrinkLogTick = -Infinity;

  /** 当前可活动边界 (第10天向内收缩) */
  bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  private grid: (string | null)[][];
  private food: number[][];
  private walls: boolean[][];
  /** v2.3.0：剑域地形层——熔岩(一击必杀)/深水(减速耗神)，键 = y*width+x */
  private terrain: (TerrainType | null)[][];
  /** 火墙过期队列 (idx 即 cellKey，v2.2.1 随档保存) */
  private wallExpiry: { idx: number; expireTick: number }[] = [];
  /** v2.3.0：临时地形过期队列（焚天爆火海等） */
  private terrainExpiry: { x: number; y: number; expireTick: number }[] = [];
  private foodCount = 0;
  /** 剑意行动随机顺序 (复用数组，避免每 tick 新建) */
  private tickOrder: string[] = [];
  /** 有庚金的格子键集合 (键 = y*width+x，渲染增量遍历用) */
  private foodSet = new Set<number>();
  /** 火墙/障碍格键集合 (渲染增量遍历用) */
  private wallSet = new Set<number>();
  /** v2.3.0：地形格键集合 (渲染增量遍历用) */
  private terrainSet = new Set<number>();
  /** 血亲链根缓存 (id -> 链根 id；lineage 只增不删，缓存长期有效) v1.12.0 */
  private rootCache = new Map<string, string>();

  constructor(config: Partial<WorldConfig> = {}) {
    this.config = {
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      foodMax: FOOD_MAX,
      foodRegenRate: FOOD_REGEN_RATE,
      currentDay: 1,
      dayTickLimit: TICKS_PER_DAY,
      isShrinking: false,
      shrinkTargetSpan: SHRINK_TARGET_SPAN,
      spawnFood: true,
      ...config,
    };
    this.modifiers = {
      foodRegenMult: 1,
      speedBonus: 0,
      mutationBias: null,
      temperature: 'normal',
      megaFood: false,
      aggressionBonus: 0,
    };
    this.chronicle = new Chronicle(() => this.tickCounter);
    const { width, height } = this.config;
    this.grid = Array.from({ length: height }, () => new Array<string | null>(width).fill(null));
    this.food = Array.from({ length: height }, () => new Array<number>(width).fill(0));
    this.walls = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    this.terrain = Array.from({ length: height }, () => new Array<TerrainType | null>(width).fill(null));
    this.bounds = { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
  }

  // ===== 查询 =====
  inBounds(x: number, y: number): boolean {
    return (
      x >= this.bounds.minX &&
      x <= this.bounds.maxX &&
      y >= this.bounds.minY &&
      y <= this.bounds.maxY
    );
  }

  isWall(x: number, y: number): boolean {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return true;
    // v2.3.0：熔岩视作壁垒（剑意感知避让、不可普通通行）；深水可通行
    return this.walls[y][x] || this.terrain[y][x] === 'lava';
  }

  /** v2.3.0：地形查询——'lava' 熔岩 / 'deepwater' 深水 / null 空地 */
  terrainAt(x: number, y: number): TerrainType | null {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return null;
    return this.terrain[y][x];
  }

  isLava(x: number, y: number): boolean {
    return this.terrainAt(x, y) === 'lava';
  }

  isDeepWater(x: number, y: number): boolean {
    return this.terrainAt(x, y) === 'deepwater';
  }

  /** v2.3.0：地形格键集合 (渲染增量遍历用，键 = y*width+x) */
  get terrainCells(): Set<number> {
    return this.terrainSet;
  }

  /** v2.3.0：布阵地形（熔岩/深水）。覆盖该格食物；剑意占位格允许覆盖（踏入即死的威胁由剑意方处理）。 */
  setTerrain(x: number, y: number, type: TerrainType, durationTicks?: number): void {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return;
    this.terrain[y][x] = type;
    this.terrainSet.add(this.cellKey(x, y));
    if (this.food[y][x] > 0) this.removeFood(x, y);
    if (durationTicks !== undefined) {
      // 同一格已有临时地形 → 更新过期时间；否则入队
      const existing = this.terrainExpiry.find((t) => t.x === x && t.y === y);
      if (existing) existing.expireTick = this.tickCounter + durationTicks;
      else this.terrainExpiry.push({ x, y, expireTick: this.tickCounter + durationTicks });
    } else {
      // 手动布阵设置永久地形时，清除该格上残留的临时过期记录，避免后续自动消失
      this.terrainExpiry = this.terrainExpiry.filter((t) => !(t.x === x && t.y === y));
    }
  }

  /** v2.3.0：清除地形 */
  clearTerrain(x: number, y: number): void {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return;
    if (this.terrain[y][x]) {
      this.terrain[y][x] = null;
      this.terrainSet.delete(this.cellKey(x, y));
    }
    // 临时地形（火海）一并清除
    this.terrainExpiry = this.terrainExpiry.filter((t) => !(t.x === x && t.y === y));
  }

  // ===== 奇遇种子 (v2.3.0) =====
  /** 放置奇遇种子：指定坐标或随机空位；同时最多 1 颗。返回是否成功。 */
  placeEncounterSeed(x?: number, y?: number): boolean {
    if (this.encounterSeed) return false;
    let px = x;
    let py = y;
    if (px === undefined || py === undefined) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const rx = Math.floor(Math.random() * this.config.width);
        const ry = Math.floor(Math.random() * this.config.height);
        if (
          this.inBounds(rx, ry) &&
          !this.isWall(rx, ry) &&
          !this.terrain[ry][rx] &&
          !this.grid[ry][rx] &&
          this.food[ry][rx] === 0
        ) {
          px = rx;
          py = ry;
          break;
        }
      }
      if (px === undefined || py === undefined) return false;
    } else {
      if (
        !this.inBounds(px, py) ||
        this.isWall(px, py) ||
        this.terrain[py][px] ||
        this.grid[py][px] ||
        this.food[py][px] > 0
      ) return false;
    }
    this.encounterSeed = { x: px, y: py, id: uid('seed'), spawnedTick: this.tickCounter };
    eventBus.emit(EVT.LOG, {
      text: `第${this.config.currentDay}日：一道奇遇灵光于剑域(${px},${py})显现，剑意趋之若鹜！`,
      important: true,
    });
    // v2.5.1：剑域纪事——奇遇显现（world=每日随机 / player=布阵种下；无归属剑，剑谱完整纪事收录）
    this.chronicle.record('encounter', {
      data: { via: x !== undefined && y !== undefined ? 'player' : 'world' },
    });
    return true;
  }

  /** 剑意取得奇遇种子：剑心境界 +1（由 moveSword 踏入/瞬移至种子格时触发） */
  claimEncounterSeed(agent: SwordAgent): void {
    if (!this.encounterSeed) return;
    this.encounterSeed = null;
    agent.grantMindRealm();
    // v2.5.0：剑域纪事——奇遇机缘
    this.chronicle.record('encounter', { actorId: agent.state.id });
  }

  foodAt(x: number, y: number): number {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return 0;
    return this.food[y][x];
  }

  /** 有庚金的格子键集合 (渲染遍历用，键 = y*width+x) */
  get foodCells(): Set<number> {
    return this.foodSet;
  }

  /** 火墙/障碍格键集合 (渲染遍历用，键 = y*width+x) */
  get wallCells(): Set<number> {
    return this.wallSet;
  }

  /** 血统链根：沿 lineage 回溯至 parentId='' 的根 (带缓存；无记录则自身即根) */
  lineageRoot(id: string): string {
    const cached = this.rootCache.get(id);
    if (cached) return cached;
    let cur = id;
    let guard = 0;
    while (cur && guard++ < 5000) {
      const info = this.lineage.get(cur);
      if (!info) break;
      if (!info.parentId) {
        this.rootCache.set(id, cur);
        return cur;
      }
      cur = info.parentId;
    }
    this.rootCache.set(id, id);
    return id;
  }

  /** 血亲判定：同一血统链根即同源一脉，不相攻 (v1.12.0) */
  isKin(a: { state: { id: string } }, b: { state: { id: string } }): boolean {
    if (a.state.id === b.state.id) return true;
    return this.lineageRoot(a.state.id) === this.lineageRoot(b.state.id);
  }

  /** v2.1.0：血亲庇护是否生效——天劫收束期间万剑相争，血亲亦成敌 (仅第 10 日 isShrinking 时失效) */
  kinProtected(): boolean {
    return !this.config.isShrinking;
  }
  /**
   * v2.5.0：剑域纪事——记录一次击杀（近战/技能/反震/天劫挤斗通用）。
   * 顺带补该剑的「首杀」事件（生涯第一杀）；血亲相残标记（天劫期）一并记录。
   */
  recordKill(
    killerId: string,
    victimId: string,
    cause: DeathCause,
    extra: { source?: 'manual' | 'tribulation' } = {},
  ): void {
    const victim = this.swords.get(victimId);
    const kin = victim ? this.isKin({ state: { id: killerId } }, victim) : false;
    const element = victim ? victim.state.genome.element : undefined;
    const killsByKiller = this.chronicle.countBy('kill', killerId);
    this.chronicle.record('kill', {
      actorId: killerId,
      targetId: victimId,
      data: { cause, kin, element, ...extra },
    });
    if (killsByKiller === 0) {
      this.chronicle.record('firstKill', {
        actorId: killerId,
        targetId: victimId,
        data: { cause, kin, element, ...extra },
      });
    }
  }
  private cellKey(x: number, y: number): number {
    return y * this.config.width + x;
  }

  swordIdAt(x: number, y: number): string | null {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return null;
    return this.grid[y][x];
  }

  /** 受材料影响后的有效攻击欲望 (v2.1.0：天劫收束期间杀性大涨) */
  effectiveAggression(base: number): number {
    return clamp(base + this.modifiers.aggressionBonus + (this.config.isShrinking ? TRIBULATION_AGGRESSION_BONUS : 0), 0, 1.5);
  }

  /** 受材料影响后的基因突变率偏向 */
  mutationBiasRates(): Partial<Record<'speed' | 'toughness', number>> {
    const b = this.modifiers.mutationBias;
    if (!b) return {};
    const out: Partial<Record<'speed' | 'toughness', number>> = {};
    if (b.stat === 'speed' || b.sideEffect === 'speedDown') {
      out.speed = b.stat === 'speed' ? this.mutationRate * b.rateMult : this.mutationRate * 0.3;
    }
    if (b.stat === 'toughness') {
      out.toughness = this.mutationRate * b.rateMult;
    }
    return out;
  }

  // ===== 剑意 =====
  addSword(agent: SwordAgent, x: number, y: number): void {
    // 防御性校验：目标格已有剑意则拒绝 (正常路径由调用方保证空位)
    if (this.grid[y][x]) return;
    this.grid[y][x] = agent.state.id;
    this.swords.set(agent.state.id, agent);
    if (!this.rootId) this.rootId = agent.state.id;
    eventBus.emit(EVT.POP_CHANGE, this.swords.size);
  }

  removeSword(id: string): void {
    const s = this.swords.get(id);
    if (!s) return;
    const { x, y } = s.state.position;
    if (this.grid[y][x] === id) this.grid[y][x] = null;
    this.swords.delete(id);
    eventBus.emit(EVT.POP_CHANGE, this.swords.size);
  }

  moveSword(agent: SwordAgent, x: number, y: number): void {
    // 防御：目标格被其他剑意占据时不覆盖 (正常路径调用方已保证空位)
    const occupied = this.grid[y][x];
    if (occupied && occupied !== agent.state.id) return;
    const { x: ox, y: oy } = agent.state.position;
    if (this.grid[oy][ox] === agent.state.id) this.grid[oy][ox] = null;
    this.grid[y][x] = agent.state.id;
    // v2.7.1：原地更新坐标，避免每次移动 new 一个 position 对象（高频小对象分配）
    agent.state.position.x = x;
    agent.state.position.y = y;
    // v2.3.0：踏入/瞬移至奇遇种子所在格 → 取得（剑心境界 +1）
    if (this.encounterSeed && this.encounterSeed.x === x && this.encounterSeed.y === y) {
      this.claimEncounterSeed(agent);
    }
  }

  /** 生成一个新剑意 (分化子体) */
  spawnChild(
    parent: SwordAgent,
    genome: Genome,
    brain: SimpleNN,
  ): SwordAgent | null {
    const { x, y } = parent.state.position;
    const cells: [number, number][] = [];
    // 逐圈扩大搜索，保证有空间放置子体
    for (let radius = 1; radius <= 3; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const nx = x + dx;
          const ny = y + dy;
          // v2.3.0：剑子不落于熔岩/深水
          if (this.inBounds(nx, ny) && !this.isWall(nx, ny) && !this.terrain[ny][nx] && !this.grid[ny][nx] && this.food[ny][nx] === 0) {
            cells.push([nx, ny]);
          }
        }
      }
      if (cells.length > 0) break;
    }
    if (cells.length === 0) return null;

    const [nx, ny] = shuffle(cells)[0];
    const childState = {
      id: uid('sw'),
      name: '',
      genome,
      brainWeights: brain.getWeights(),
      brainBiases: brain.getBiases(),
      energy: maxEnergyOf(parent.state) / 2, // v2.2.0：子代继承父代精元上限，初始精元随之
      hp: maxHpOf(parent.state),
      age: 0,
      birthTick: this.tickCounter,
      position: { x: nx, y: ny },
      facing: { x: 0, y: -1 },
      parentId: parent.state.id,
      generation: parent.state.generation + 1,
      origin: parent.state.origin,
      mindRealm: parent.state.mindRealm ?? 0, // v1.12.0：剑子继承父代剑心境界（脑克隆自带容量）
      mindSkillIds: parent.state.mindSkillIds ? [...parent.state.mindSkillIds] : undefined, // v2.0.0：剑心绝技随血脉遗传
      maxHp: parent.state.maxHp, // v2.2.0：剑体/精元上限随血脉继承
      maxEnergy: parent.state.maxEnergy,
    };
    const child = new SwordAgent(childState, brain, this);
    this.addSword(child, nx, ny);
    eventBus.emit(EVT.SPLIT, { x: parent.state.position.x, y: parent.state.position.y, element: parent.state.genome.element });
    this.lineage.set(child.state.id, {
      parentId: parent.state.id,
      day: this.config.currentDay,
      generation: child.state.generation,
      element: genome.element,
    });
    if (child.state.generation > this.maxGeneration) this.maxGeneration = child.state.generation;
    // v2.5.0：剑域纪事——分化剑子诞生
    this.chronicle.record('birth', {
      actorId: child.state.id,
      data: { via: 'split', generation: child.state.generation, origin: child.state.origin, element: genome.element, parentId: parent.state.id },
    });
    // v2.5.1：剑域纪事——母剑分化（母剑视角，剑谱重大纪事用）
    this.chronicle.record('split', {
      actorId: parent.state.id,
      targetId: child.state.id,
      data: { via: 'split', generation: child.state.generation, element: genome.element },
    });
    return child;
  }

  /**
   * 投放一道游离剑意 (每日剑潮) 至随机空位；返回是否成功。
   * v2.2.0：凶潮可投放高剑心境界剑意（options.mindRealm）——上限随境界抬升、自带随机剑心绝技。
   */
  spawnWildSword(
    genome: Genome,
    brain: SimpleNN,
    options: { mindRealm?: number; maxHp?: number; maxEnergy?: number; mindSkillIds?: string[] } = {},
  ): boolean {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      // v2.3.0：游离剑意不落于熔岩/深水
      if (this.inBounds(x, y) && !this.isWall(x, y) && !this.terrain[y][x] && !this.grid[y][x] && this.food[y][x] === 0) {
        const realm = options.mindRealm ?? 0;
        const st: SwordState = {
          id: uid('sw'),
          name: '',
          genome,
          brainWeights: brain.getWeights(),
          brainBiases: brain.getBiases(),
          energy: realm > 0 ? (options.maxEnergy ?? ENERGY_SPLIT_THRESHOLD) / 2 : 40, // 高境剑意自带精元储备；凡心游离剑意灵力微薄
          hp: options.maxHp ?? MAX_HP,
          age: 0,
          birthTick: this.tickCounter,
          position: { x, y },
          facing: { x: 0, y: -1 },
          parentId: '',
          generation: 1,
          origin: 'wild',
          mindRealm: realm, // v1.12.0：游离剑意起于凡心；v2.2.0 凶潮可投洞玄（剑心 2 级）
          mindSkillIds: options.mindSkillIds,
          maxHp: options.maxHp, // v2.2.0：高境剑意剑体/精元上限随境界抬升
          maxEnergy: options.maxEnergy,
        };
        const agent = new SwordAgent(st, brain, this);
        this.addSword(agent, x, y);
        this.lineage.set(st.id, { parentId: '', day: this.config.currentDay, generation: 1, element: genome.element });
        // v2.5.0：剑域纪事——剑潮游离剑意诞生
        this.chronicle.record('birth', {
          actorId: st.id,
          data: { via: 'tide', generation: 1, origin: 'wild', element: genome.element, parentId: '' },
        });
        return true;
      }
    }
    return false;
  }

  /** 布霖：在随机空位落下一团庚金之气 */
  dropFoodAtRandom(): boolean {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      // v2.3.0：避开地形（熔岩/深水不落庚金）
      if (this.inBounds(x, y) && !this.isWall(x, y) && !this.terrain[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
        this.food[y][x] = FOOD_ENERGY;
        this.foodCount++;
        this.foodSet.add(this.cellKey(x, y));
        return true;
      }
    }
    return false;
  }

  /** 尸身化食：敌方剑意陨落后化作庚金之气，落于身侧 */
  spawnCorpseFood(cx: number, cy: number, value: number): void {
    const cells: [number, number][] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = cx + dx;
        const y = cy + dy;
        // v2.3.0：尸身不落于熔岩/深水
        if (this.inBounds(x, y) && !this.isWall(x, y) && !this.terrain[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
          cells.push([x, y]);
        }
      }
    }
    if (cells.length === 0) return;
    // 尸身化食不硬超食物上限 (临时溢出可接受，但设硬顶防失控)
    if (this.foodCount >= this.config.foodMax + 20) return;
    const [x, y] = shuffle(cells)[0];
    this.food[y][x] = value;
    this.foodCount++;
    this.foodSet.add(this.cellKey(x, y));
  }

  /** 寄灵：击败者被寄灵化入己方血脉，成为剑子 */
  spawnParasite(attacker: SwordAgent, cx: number, cy: number): boolean {
    const cells: [number, number][] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = cx + dx;
        const y = cy + dy;
        // v2.3.0：寄灵剑子不落于熔岩/深水
        if (this.inBounds(x, y) && !this.isWall(x, y) && !this.terrain[y][x] && !this.grid[y][x] && this.food[y][x] === 0) {
          cells.push([x, y]);
        }
      }
    }
    if (cells.length === 0) return false;
    const [x, y] = shuffle(cells)[0];
    const brain = attacker.brain.clone();
    const st: SwordState = {
      id: uid('sw'),
      name: '',
      genome: { ...attacker.state.genome, affixes: attacker.state.genome.affixes.slice() },
      brainWeights: brain.getWeights(),
      brainBiases: brain.getBiases(),
      energy: Math.max(20, attacker.state.energy * 0.3),
      hp: Math.round(maxHpOf(attacker.state) * 0.6),
      age: 0,
      birthTick: this.tickCounter,
      position: { x, y },
      facing: { x: 0, y: -1 },
      parentId: attacker.state.id,
      generation: attacker.state.generation + 1,
      origin: attacker.state.origin,
      mindRealm: attacker.state.mindRealm ?? 0, // v1.12.0：剑子继承寄主剑心境界
      mindSkillIds: attacker.state.mindSkillIds ? [...attacker.state.mindSkillIds] : undefined, // v2.0.0：绝技随寄主遗传
      maxHp: attacker.state.maxHp, // v2.2.0：剑体/精元上限随寄主继承
      maxEnergy: attacker.state.maxEnergy,
    };
    const child = new SwordAgent(st, brain, this);
    this.addSword(child, x, y);
    this.lineage.set(st.id, {
      parentId: attacker.state.id,
      day: this.config.currentDay,
      generation: st.generation,
      element: st.genome.element,
    });
    if (st.generation > this.maxGeneration) this.maxGeneration = st.generation;
    eventBus.emit(EVT.MIND, null); // 音频：寄灵夺舍「顿悟」
    eventBus.emit(EVT.LOG, {
      text: `第${this.config.currentDay}日：一道剑意被「寄灵」化入他脉，沦为他人剑子！`,
      focusId: st.id,
      important: true,
    });
    // v2.5.0：剑域纪事——寄灵剑子诞生
    this.chronicle.record('birth', {
      actorId: st.id,
      data: { via: 'parasite', generation: st.generation, origin: st.origin, element: st.genome.element, parentId: attacker.state.id },
    });
    // v2.5.1：剑域纪事——寄灵化敌为子（寄主视角，剑谱重大纪事用）
    this.chronicle.record('split', {
      actorId: attacker.state.id,
      targetId: st.id,
      data: { via: 'parasite', generation: st.generation, element: st.genome.element },
    });
    return true;
  }

  /** 分裂事件日志 (元素突变 / 新世代) */
  emitSplitEvents(parent: SwordAgent, childGenome: Genome, changed: boolean, child: SwordAgent): void {
    if (childGenome.element !== parent.state.genome.element) {
      eventBus.emit(EVT.LOG, `第${this.config.currentDay}日：一道剑意悟性勃发，蜕变为${ELEMENT_LABEL[childGenome.element]}行剑意！`);
    } else if (child.state.generation > this.maxGeneration - 1 && child.state.generation % 5 === 0) {
      eventBus.emit(EVT.LOG, `第${this.config.currentDay}日：第${child.state.generation}代剑子衍生，剑潮渐起。`);
    }
  }

  // ===== 庚金之气 (食物) =====
  spawnFood(): void {
    if (this.foodCount >= this.config.foodMax) return;
    const effRate = this.config.foodRegenRate * this.modifiers.foodRegenMult;
    if (Math.random() >= effRate) return;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      // v2.3.0：庚金不落于地形
      if (this.inBounds(x, y) && !this.isWall(x, y) && !this.terrain[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
        this.food[y][x] = FOOD_ENERGY;
        this.foodCount++;
        this.foodSet.add(this.cellKey(x, y));
        return;
      }
    }
  }

  /** 开局固定撒 count 团庚金 (直接放置，不概率) */
  spawnInitialFood(count: number): void {
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const x = Math.floor(Math.random() * this.config.width);
        const y = Math.floor(Math.random() * this.config.height);
        // v2.3.0：开局庚金避开地形
        if (this.inBounds(x, y) && !this.isWall(x, y) && !this.terrain[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
          this.food[y][x] = FOOD_ENERGY;
          this.foodCount++;
          this.foodSet.add(this.cellKey(x, y));
          break;
        }
      }
    }
  }

  removeFood(x: number, y: number): void {
    if (this.food[y][x] > 0) {
      this.food[y][x] = 0;
      this.foodCount--;
      this.foodSet.delete(this.cellKey(x, y));
    }
  }

  /** v2.3.0 手动天雷 / v2.4.0 范围雷暴：在指定格降下雷霆——闪电劈落，半径 2 内剑意同受天雷（与天劫同伤）；始终降雷展示。返回本次雷暴击杀数。 */
  strikeLightning(x: number, y: number): number {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return 0;
    // 落点剑意元素（决定特效主色；空地取 metal）
    const hit = this.swords.get(this.grid[y][x] ?? '');
    const element = hit?.state.genome.element ?? 'metal';
    // 先落雷特效/音效（闪电劈下 + 范围雷暴），再结算伤害（击杀另有死亡粒子）
    eventBus.emit(EVT.THUNDER, { x, y, element });
    let killed = 0;
    // v2.7.1：先收集待死剑意，再统一 die()——不在遍历 Map 时删除（更稳健，防未来改动踩迭代删除坑）
    const victims: SwordAgent[] = [];
    for (const s of this.swords.values()) {
      const d = Math.abs(s.state.position.x - x) + Math.abs(s.state.position.y - y);
      if (d > 2) continue; // v2.4.0：范围雷暴——半径 2（曼哈顿）内剑意同受天雷
      s.state.hp -= TRIBULATION_LIGHTNING_DMG;
      s.state.energy -= TRIBULATION_LIGHTNING_ENERGY;
      if (s.state.hp <= 0 || s.state.energy <= 0) {
        victims.push(s);
      } else {
        // 雷劫余生：历天雷而仍存续 → 标记个体经历（鉴定标签）
        s.state.survivedThunder = true;
        // v2.5.0：剑域纪事——雷劫余生
        this.chronicle.record('thunderSurvive', { actorId: s.state.id, data: { source: 'manual' } });
      }
    }
    for (const v of victims) {
      v.die('thunder');
      killed++;
    }
    return killed;
  }

  /** 陨星铁母：生成超高能量食物 */
  spawnMegaFood(count: number): void {
    let placed = 0;
    for (let attempt = 0; attempt < count * 50 && placed < count; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      // v2.3.0：陨星真金不落于地形
      if (this.inBounds(x, y) && !this.isWall(x, y) && !this.terrain[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
        this.food[y][x] = MEGA_FOOD_ENERGY;
        this.foodCount++;
        this.foodSet.add(this.cellKey(x, y));
        placed++;
      }
    }
    if (placed > 0) eventBus.emit(EVT.LOG, `陨星铁母坠落，${placed}团天外真金散落剑域！`);
  }

  /** 第10天天劫：边界向内收缩一格 + 全领域落雷 (v2.1.0：不再墙杀；场地缩到目标尺寸后不再缩墙/落雷，靠天劫临时杀性斗至最后一柄，给特效展示空间) */
  shrink(): void {
    const b = this.bounds;
    // v2.1.0：已到最终场地（4×4）→ 不再缩墙、不再落雷——决胜交由天劫临时杀性驱动的剑斗（防天雷误杀，特效已随收缩展示）
    if (this.shrunkSpanX <= this.config.shrinkTargetSpan && this.shrunkSpanY <= this.config.shrinkTargetSpan) return;
    // 尚未缩到目标场地（4×4）→ 继续收缩：边缘剑意向内挤入（被占则争斗）
    {
      // v2.1.0：新边界 = 向内收一格；宽度/高度缩到 ≤2 时钳制到中心单格（避免 2x2→0x0 边界反转）
      const cx = Math.floor((b.minX + b.maxX) / 2);
      const cy = Math.floor((b.minY + b.maxY) / 2);
      const nb = { minX: b.minX + 1, minY: b.minY + 1, maxX: b.maxX - 1, maxY: b.maxY - 1 };
      if (nb.minX > nb.maxX) { nb.minX = cx; nb.maxX = cx; }
      if (nb.minY > nb.maxY) { nb.minY = cy; nb.maxY = cy; }
      // 新边界之外的旧区域全部化作壁垒：食物湮灭、剑意被困
      const trapped: SwordAgent[] = [];
      for (let y = b.minY; y <= b.maxY; y++) {
        for (let x = b.minX; x <= b.maxX; x++) {
          if (x >= nb.minX && x <= nb.maxX && y >= nb.minY && y <= nb.maxY) continue;
          this.walls[y][x] = true;
          this.wallSet.add(this.cellKey(x, y));
          // v2.3.0：被吞噬区域的地形随之湮灭（防存档膨胀；混沌区不再渲染/生效）
          if (this.terrain[y][x]) {
            this.terrain[y][x] = null;
            this.terrainSet.delete(this.cellKey(x, y));
          }
          // 被吞噬区域的食物随之湮灭 (不占食物配额，也不再被采气)
          if (this.food[y][x] > 0) {
            this.food[y][x] = 0;
            this.foodCount--;
            this.foodSet.delete(this.cellKey(x, y));
          }
          const sid = this.grid[y][x];
          if (sid) {
            const s = this.swords.get(sid);
            if (s) trapped.push(s);
          }
        }
      }
      this.bounds = nb;
      // v2.1.0：不再墙杀——边缘剑意向内挤入：先原位向中心退一步（层层压缩、保持分布）；
      // 目标被占 → 壁垒相逼，直接争斗（天劫期间血亲亦相争）；败者弹开，无处立足者才陨落
      let squeezed = 0;
      let perished = 0;
      let clashed = 0;
      for (const s of trapped) {
        const p = s.state.position;
        let tx = p.x;
        let ty = p.y;
        if (p.x === nb.minX - 1) tx = p.x + 1; // 曾贴左壁 → 右移一步
        else if (p.x === nb.maxX + 1) tx = p.x - 1; // 曾贴右壁 → 左移一步
        if (p.y === nb.minY - 1) ty = p.y + 1; // 曾贴上壁 → 下移一步
        else if (p.y === nb.maxY + 1) ty = p.y - 1; // 曾贴下壁 → 上移一步
        let moved = false;
        if (this.inBounds(tx, ty) && !this.isWall(tx, ty) && !this.grid[ty][tx]) {
          if (this.grid[p.y][p.x] === s.state.id) this.grid[p.y][p.x] = null;
          this.grid[ty][tx] = s.state.id;
          s.state.position = { x: tx, y: ty };
          squeezed++;
          moved = true;
        } else if (this.inBounds(tx, ty) && !this.isWall(tx, ty)) {
          // 目标被占 → 壁垒相逼，争斗一场（天劫期间血亲亦相争）
          const occId = this.grid[ty][tx];
          const occupant = occId ? this.swords.get(occId) : undefined;
          if (occupant && (!this.kinProtected() || !this.isKin(s, occupant))) {
            const result = resolveBattle(s, occupant);
            clashed++;
            // v2.2.1：反震致死（厚土反震等）——困兽当场陨落，不再移走/留场成「僵尸剑」
            if (result.attackerDied) {
              // v2.5.0：天劫挤斗——攻方反震而亡，击杀归守方（天劫期血亲亦相争，记血亲标记）
              this.recordKill(occupant.state.id, s.state.id, 'counter', { source: 'tribulation' });
              s.die('counter', occupant.state.id);
              perished++;
              moved = true; // 防止 !moved 分支再把尸体挤走
            } else if (result.defenderDied) {
              s.behavior.killCount++;
              // v2.5.0：天劫挤斗——近战击杀（天劫期血亲亦相争，记血亲标记）
              this.recordKill(s.state.id, occupant.state.id, 'melee', { source: 'tribulation' });
              occupant.die('melee', s.state.id); // v2.2.1：改走 die() 发 EVT.DEATH（死亡粒子/音效）
              if (this.grid[p.y][p.x] === s.state.id) this.grid[p.y][p.x] = null;
              this.grid[ty][tx] = s.state.id;
              s.state.position = { x: tx, y: ty };
              squeezed++;
              moved = true;
            }
          }
        }
        if (!moved) {
          const cell = this.findSqueezeCell();
          if (cell) {
            const { x: ox, y: oy } = s.state.position;
            if (this.grid[oy][ox] === s.state.id) this.grid[oy][ox] = null;
            this.grid[cell.y][cell.x] = s.state.id;
            s.state.position = { x: cell.x, y: cell.y };
            squeezed++;
          } else {
            s.die(); // v2.2.1：走 die() 发 EVT.DEATH（死亡粒子/音效）
            perished++;
          }
        }
      }
      // v2.2.0：天劫收缩日志节流——无实质事件(无争斗/无陨落)时每 SHRINK_LOG_INTERVAL_TICKS 报一次；有相斗/陨落立即报（防 2 秒刷屏）
      const meaningful = clashed > 0 || perished > 0;
      if (meaningful || this.tickCounter - this.lastShrinkLogTick >= SHRINK_LOG_INTERVAL_TICKS) {
        this.lastShrinkLogTick = this.tickCounter;
        eventBus.emit(EVT.LOG, `天劫收束，壁垒向内收缩，${squeezed}道剑意被逼向中心（相斗${clashed}场），${perished}道无处立足化作混沌尘埃……`);
      }
    }
    // v2.5.0：剑域纪事——天劫收缩（圈数）
    this.chronicle.record('tribulation', { data: { ring: Math.floor((this.config.width - this.shrunkSpanX) / 2) } });
    // 全领域落雷（随收缩阶段执行——特效展示 + 压力）；道数受场地面积钳制：区域越小越稀疏
    const lb = this.bounds;
    const rings = Math.floor((this.config.width - this.shrunkSpanX) / 2);
    const volley = Math.min(
      TRIBULATION_LIGHTNING_BASE + Math.floor(rings / TRIBULATION_LIGHTNING_RAMP),
      Math.max(0, Math.floor((this.shrunkSpanX * this.shrunkSpanY) / 8)),
    );
    for (let i = 0; i < volley; i++) {
      const x = randomInt(lb.minX, lb.maxX);
      const y = randomInt(lb.minY, lb.maxY);
      if (this.isWall(x, y)) continue;
      const sid = this.grid[y][x];
      if (!sid) continue;
      const s = this.swords.get(sid);
      if (!s) continue;
      s.state.hp -= TRIBULATION_LIGHTNING_DMG;
      s.state.energy -= TRIBULATION_LIGHTNING_ENERGY;
      if (s.state.hp <= 0 || s.state.energy <= 0) {
        s.die('thunder'); // v2.2.1：走 die() 发 EVT.DEATH（死亡粒子/音效）
      } else {
        eventBus.emit(EVT.THUNDER, { x, y, element: s.state.genome.element });
      }
    }
  }

  /** 天劫向内挤入：在新边界内寻找最靠中心的空位 (挤向核心，逼迫剑意争斗)；找不到返回 null */
  private findSqueezeCell(): { x: number; y: number } | null {
    const b = this.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    let best: { x: number; y: number; d: number } | null = null;
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (this.isWall(x, y) || this.grid[y][x]) continue;
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  get shrunkSpanX(): number {
    return this.bounds.maxX - this.bounds.minX + 1;
  }

  get shrunkSpanY(): number {
    return this.bounds.maxY - this.bounds.minY + 1;
  }

  /** 天劫是否应当结束 (v2.1.0：斗至最后一柄——只剩 1 柄即止；场地缩到目标尺寸后不再收缩，靠天劫临时杀性决胜) */
  isTribulationOver(): boolean {
    return this.swords.size <= 1;
  }

  // ===== 生态序列化 (续档恢复用) =====
  /** 导出生态状态：边界/庚金/火墙/地形/天劫开关 (P1-4 续档不丢天劫进度；v2.3.0 加地形) */
  exportEcoState(): {
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    food: [number, number, number][];
    walls: [number, number][];
    wallExpiry: { idx: number; remainTick: number }[];
    terrain?: [number, number, string][];
    terrainExpiry?: { x: number; y: number; remainTick: number }[];
    encounterSeed?: { x: number; y: number; id: string; spawnedTick: number } | null;
    spawnFood: boolean;
    isShrinking: boolean;
  } {
    const food: [number, number, number][] = [];
    for (const k of this.foodSet) {
      const x = k % this.config.width;
      const y = Math.floor(k / this.config.width);
      food.push([x, y, this.food[y][x]]);
    }
    const walls: [number, number][] = [];
    for (const k of this.wallSet) {
      walls.push([k % this.config.width, Math.floor(k / this.config.width)]);
    }
    const terrain: [number, number, string][] = [];
    for (const k of this.terrainSet) {
      const x = k % this.config.width;
      const y = Math.floor(k / this.config.width);
      const t = this.terrain[y][x];
      if (t) terrain.push([x, y, t]);
    }
    // v2.2.1：火墙过期队列一并序列化（存剩余 tick，避免读档后火墙永久存在）
    const wallExpiry = this.wallExpiry.map((w) => ({
      idx: w.idx,
      remainTick: Math.max(0, w.expireTick - this.tickCounter),
    }));
    return {
      bounds: { ...this.bounds },
      food,
      walls,
      wallExpiry,
      terrain,
      terrainExpiry: this.terrainExpiry.map((t) => ({
        x: t.x,
        y: t.y,
        remainTick: Math.max(0, t.expireTick - this.tickCounter),
      })),
      encounterSeed: this.encounterSeed ? { ...this.encounterSeed } : null,
      spawnFood: this.config.spawnFood,
      isShrinking: this.config.isShrinking,
    };
  }

  /** 恢复生态状态 (续档) */
  restoreEcoState(eco: ReturnType<World['exportEcoState']>): void {
    this.bounds = { ...eco.bounds };
    this.config.spawnFood = eco.spawnFood;
    this.config.isShrinking = eco.isShrinking;
    this.foodCount = 0;
    this.foodSet.clear();
    this.wallSet.clear();
    this.terrainSet.clear();
    for (let y = 0; y < this.config.height; y++) {
      this.food[y].fill(0);
      this.walls[y].fill(false);
      this.terrain[y].fill(null);
    }
    for (const [x, y, v] of eco.food) {
      this.food[y][x] = v;
      this.foodCount++;
      this.foodSet.add(this.cellKey(x, y));
    }
    for (const [x, y] of eco.walls) {
      this.walls[y][x] = true;
      this.wallSet.add(this.cellKey(x, y));
    }
    // v2.3.0：恢复地形（旧档无此字段 → 空）
    for (const [x, y, t] of eco.terrain ?? []) {
      if (t === 'lava' || t === 'deepwater') {
        this.terrain[y][x] = t;
        this.terrainSet.add(this.cellKey(x, y));
      }
    }
    // v2.3.0：恢复奇遇种子（旧档无此字段 → 无）
    this.encounterSeed = eco.encounterSeed ? { ...eco.encounterSeed } : null;
    // v2.3.0：恢复临时地形过期队列（旧档无此字段 → 空）
    this.terrainExpiry = (eco.terrainExpiry ?? []).map((t) => ({
      x: t.x,
      y: t.y,
      expireTick: this.tickCounter + t.remainTick,
    }));
    // v2.2.1：恢复火墙过期队列（旧档无此字段 → 空数组；有到期火墙按剩余 tick 重建，读档后不再永久存在）
    this.wallExpiry = (eco.wallExpiry ?? []).map((w) => ({
      idx: w.idx,
      expireTick: this.tickCounter + w.remainTick,
    }));
  }

  // ===== 主循环 =====
  tick(): void {
    // 庚金之气再生
    if (this.config.spawnFood) this.spawnFood();

    // 剑意行动 (随机顺序，避免位置偏置；就地洗牌复用数组)
    this.tickOrder.length = 0;
    for (const id of this.swords.keys()) this.tickOrder.push(id);
    for (let i = this.tickOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tickOrder[i], this.tickOrder[j]] = [this.tickOrder[j], this.tickOrder[i]];
    }
    for (const id of this.tickOrder) {
      const s = this.swords.get(id);
      if (s) s.tick();
    }

    // 火墙过期
    if (this.wallExpiry.length > 0) {
      this.wallExpiry = this.wallExpiry.filter((w) => {
        if (w.expireTick > this.tickCounter) return true;
        const x = w.idx % this.config.width;
        const y = Math.floor(w.idx / this.config.width);
        this.walls[y][x] = false;
        this.wallSet.delete(w.idx); // idx 即 cellKey
        return false;
      });
    }

    // v2.3.0：临时地形过期（焚天爆火海等）
    if (this.terrainExpiry.length > 0) {
      this.terrainExpiry = this.terrainExpiry.filter((t) => {
        if (t.expireTick > this.tickCounter) return true;
        if (this.terrain[t.y][t.x]) {
          this.terrain[t.y][t.x] = null;
          this.terrainSet.delete(this.cellKey(t.x, t.y));
        }
        return false;
      });
    }

    this.tickCounter++;
    if (this.tickCounter % 50 === 0) {
      this.populationHistory.push(this.swords.size);
    }
  }
}
