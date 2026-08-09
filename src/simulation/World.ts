import type { Genome, SwordState, WorldConfig, WorldModifiers } from '../types';
import { SwordAgent } from './SwordAgent';
import { SimpleNN } from './NeuralNet';
import { ELEMENT_LABEL } from './Genetics';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  FOOD_MAX,
  FOOD_REGEN_RATE,
  FOOD_ENERGY,
  TICKS_PER_DAY,
  SHRINK_TARGET_SPAN,
  MAX_HP,
  ENERGY_SPLIT_THRESHOLD,
  MUTATION_RATE,
  MEGA_FOOD_ENERGY,
} from '../constants';
import { clamp, shuffle, uid, randomInt } from '../utils/mathUtils';
import { eventBus, EVT } from '../utils/eventBus';

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
  /** 血统溯源 (id -> 父信息) */
  lineage = new Map<string, LineageNode>();
  rootId: string | null = null;
  populationHistory: number[] = [];

  /** 当前可活动边界 (第10天向内收缩) */
  bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  private grid: (string | null)[][];
  private food: number[][];
  private walls: boolean[][];
  private wallExpiry: { idx: number; expireTick: number }[] = [];
  private foodCount = 0;

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
      mutationMult: 1,
      mutationBias: null,
      temperature: 'normal',
      thunderstorm: false,
      megaFood: false,
      aggressionBonus: 0,
    };
    const { width, height } = this.config;
    this.grid = Array.from({ length: height }, () => new Array<string | null>(width).fill(null));
    this.food = Array.from({ length: height }, () => new Array<number>(width).fill(0));
    this.walls = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
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
    return this.walls[y][x];
  }

  foodAt(x: number, y: number): number {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return 0;
    return this.food[y][x];
  }

  swordIdAt(x: number, y: number): string | null {
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return null;
    return this.grid[y][x];
  }

  /** 受材料影响后的有效攻击欲望 */
  effectiveAggression(base: number): number {
    return clamp(base + this.modifiers.aggressionBonus, 0, 1.5);
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
    this.grid[y][x] = agent.state.id;
    this.swords.set(agent.state.id, agent);
    if (!this.rootId) this.rootId = agent.state.id;
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
    const { x: ox, y: oy } = agent.state.position;
    if (this.grid[oy][ox] === agent.state.id) this.grid[oy][ox] = null;
    this.grid[y][x] = agent.state.id;
    agent.state.position = { x, y };
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
          if (this.inBounds(nx, ny) && !this.isWall(nx, ny) && !this.grid[ny][nx] && this.food[ny][nx] === 0) {
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
      energy: ENERGY_SPLIT_THRESHOLD / 2,
      hp: MAX_HP,
      age: 0,
      birthTick: this.tickCounter,
      position: { x: nx, y: ny },
      facing: { x: 0, y: -1 },
      parentId: parent.state.id,
      generation: parent.state.generation + 1,
      origin: parent.state.origin,
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
    return child;
  }

  /** 投放一道游离剑意 (每日剑潮) 至随机空位；返回是否成功 */
  spawnWildSword(genome: Genome, brain: SimpleNN): boolean {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      if (this.inBounds(x, y) && !this.isWall(x, y) && !this.grid[y][x] && this.food[y][x] === 0) {
        const st: SwordState = {
          id: uid('sw'),
          name: '',
          genome,
          brainWeights: brain.getWeights(),
          brainBiases: brain.getBiases(),
          energy: 40, // 游离剑意初入剑域，灵力微薄，须自谋生路
          hp: MAX_HP,
          age: 0,
          birthTick: this.tickCounter,
          position: { x, y },
          facing: { x: 0, y: -1 },
          parentId: '',
          generation: 1,
          origin: 'wild',
        };
        const agent = new SwordAgent(st, brain, this);
        this.addSword(agent, x, y);
        this.lineage.set(st.id, { parentId: '', day: this.config.currentDay, generation: 1, element: genome.element });
        return true;
      }
    }
    return false;
  }

  /** 手动投食：在随机空位落下一团庚金之气 */
  dropFoodAtRandom(): boolean {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      if (this.inBounds(x, y) && !this.walls[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
        this.food[y][x] = FOOD_ENERGY;
        this.foodCount++;
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
        if (this.inBounds(x, y) && !this.walls[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
          cells.push([x, y]);
        }
      }
    }
    if (cells.length === 0) return;
    const [x, y] = shuffle(cells)[0];
    this.food[y][x] = value;
    this.foodCount++;
  }

  /** 寄灵：击败者被寄灵化入己方血脉，成为剑子 */
  spawnParasite(attacker: SwordAgent, cx: number, cy: number): boolean {
    const cells: [number, number][] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (this.inBounds(x, y) && !this.walls[y][x] && !this.grid[y][x] && this.food[y][x] === 0) {
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
      hp: Math.round(MAX_HP * 0.6),
      age: 0,
      birthTick: this.tickCounter,
      position: { x, y },
      facing: { x: 0, y: -1 },
      parentId: attacker.state.id,
      generation: attacker.state.generation + 1,
      origin: attacker.state.origin,
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
    eventBus.emit(EVT.LOG, {
      text: `第${this.config.currentDay}日：一道剑意被「寄灵」化入他脉，沦为他人剑子！`,
      focusId: st.id,
      important: true,
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
      if (this.inBounds(x, y) && !this.walls[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
        this.food[y][x] = FOOD_ENERGY;
        this.foodCount++;
        return;
      }
    }
  }

  spawnFoodAt(x: number, y: number, value: number): void {
    this.food[y][x] = value;
    this.foodCount++;
  }

  spawnInitialFood(count: number): void {
    for (let i = 0; i < count; i++) this.spawnFood();
  }

  /** 在中心附近生成食物 (开局补给，确保剑胚快速安家) */
  spawnFoodAround(cx: number, cy: number, radius: number, count: number): void {
    let placed = 0;
    for (let attempt = 0; attempt < count * 30 && placed < count; attempt++) {
      const x = cx + randomInt(-radius, radius);
      const y = cy + randomInt(-radius, radius);
      if (this.inBounds(x, y) && this.food[y][x] === 0 && !this.grid[y][x] && !this.walls[y][x]) {
        this.food[y][x] = FOOD_ENERGY;
        this.foodCount++;
        placed++;
      }
    }
  }

  removeFood(x: number, y: number): void {
    if (this.food[y][x] > 0) {
      this.food[y][x] = 0;
      this.foodCount--;
    }
  }

  /** 扶桑火种：生成临时火墙 */
  spawnFireWalls(count: number): void {
    let placed = 0;
    for (let attempt = 0; attempt < count * 30 && placed < count; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      if (this.inBounds(x, y) && !this.walls[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
        this.walls[y][x] = true;
        this.wallExpiry.push({ idx: y * this.config.width + x, expireTick: this.tickCounter + 600 });
        placed++;
      }
    }
    if (placed > 0) eventBus.emit(EVT.LOG, `扶桑火种迸溅，${placed}道火墙在剑域中燃起！`);
  }

  /** 陨星铁母：生成超高能量食物 */
  spawnMegaFood(count: number): void {
    let placed = 0;
    for (let attempt = 0; attempt < count * 50 && placed < count; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      if (this.inBounds(x, y) && !this.walls[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
        this.food[y][x] = MEGA_FOOD_ENERGY;
        this.foodCount++;
        placed++;
      }
    }
    if (placed > 0) eventBus.emit(EVT.LOG, `陨星铁母坠落，${placed}团天外真金散落剑域！`);
  }

  /** 第10天天劫：边界向内收缩一格 */
  shrink(): void {
    const b = this.bounds;
    const killList: string[] = [];
    const markWall = (x: number, y: number) => {
      if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) return;
      this.walls[y][x] = true;
      const sid = this.grid[y][x];
      if (sid) killList.push(sid);
    };
    // 四条边
    for (let x = b.minX; x <= b.maxX; x++) {
      markWall(x, b.minY);
      markWall(x, b.maxY);
    }
    for (let y = b.minY + 1; y <= b.maxY - 1; y++) {
      markWall(b.minX, y);
      markWall(b.maxX, y);
    }
    b.minX++;
    b.minY++;
    b.maxX--;
    b.maxY--;
    for (const id of killList) this.removeSword(id);
    eventBus.emit(EVT.LOG, `天劫收束，剑域壁垒向内收缩，${killList.length}道剑意化作混沌尘埃……`);
  }

  get shrunkSpanX(): number {
    return this.bounds.maxX - this.bounds.minX + 1;
  }

  get shrunkSpanY(): number {
    return this.bounds.maxY - this.bounds.minY + 1;
  }

  /** 天劫是否应当结束 */
  isTribulationOver(): boolean {
    return (
      this.swords.size <= 1 ||
      (this.shrunkSpanX <= this.config.shrinkTargetSpan && this.shrunkSpanY <= this.config.shrinkTargetSpan)
    );
  }

  // ===== 主循环 =====
  tick(): void {
    // 庚金之气再生
    if (this.config.spawnFood) this.spawnFood();

    // 剑意行动 (随机顺序，避免位置偏置)
    const ids = shuffle([...this.swords.keys()]);
    for (const id of ids) {
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
        return false;
      });
    }

    this.tickCounter++;
    if (this.tickCounter % 50 === 0) {
      this.populationHistory.push(this.swords.size);
    }
  }
}
