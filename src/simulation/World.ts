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
  MAX_HP,
  ENERGY_SPLIT_THRESHOLD,
  MUTATION_RATE,
  MEGA_FOOD_ENERGY,
  TRIBULATION_LIGHTNING_DMG,
  TRIBULATION_LIGHTNING_ENERGY,
  TRIBULATION_LIGHTNING_BASE,
  TRIBULATION_LIGHTNING_RAMP,
  TRIBULATION_AGGRESSION_BONUS,
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
  /** 剑意行动随机顺序 (复用数组，避免每 tick 新建) */
  private tickOrder: string[] = [];
  /** 有庚金的格子键集合 (键 = y*width+x，渲染增量遍历用) */
  private foodSet = new Set<number>();
  /** 火墙/障碍格键集合 (渲染增量遍历用) */
  private wallSet = new Set<number>();
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
      mindRealm: parent.state.mindRealm ?? 0, // v1.12.0：剑子继承父代剑心境界（脑克隆自带容量）
      mindSkillIds: parent.state.mindSkillIds ? [...parent.state.mindSkillIds] : undefined, // v2.0.0：剑心绝技随血脉遗传
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
          mindRealm: 0, // v1.12.0：游离剑意起于凡心
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
        if (this.inBounds(x, y) && !this.walls[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
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
      mindRealm: attacker.state.mindRealm ?? 0, // v1.12.0：剑子继承寄主剑心境界
      mindSkillIds: attacker.state.mindSkillIds ? [...attacker.state.mindSkillIds] : undefined, // v2.0.0：绝技随寄主遗传
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
        if (this.inBounds(x, y) && !this.walls[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
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

  /** 扶桑火种：生成临时火墙 */
  spawnFireWalls(count: number): void {
    let placed = 0;
    for (let attempt = 0; attempt < count * 30 && placed < count; attempt++) {
      const x = Math.floor(Math.random() * this.config.width);
      const y = Math.floor(Math.random() * this.config.height);
      if (this.inBounds(x, y) && !this.walls[y][x] && this.food[y][x] === 0 && !this.grid[y][x]) {
        this.walls[y][x] = true;
        this.wallSet.add(this.cellKey(x, y));
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
            if (result.defenderDied) {
              s.behavior.killCount++;
              this.removeSword(occupant.state.id);
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
            this.removeSword(s.state.id);
            perished++;
          }
        }
      }
      eventBus.emit(EVT.LOG, `天劫收束，壁垒向内收缩，${squeezed}道剑意被逼向中心（相斗${clashed}场），${perished}道无处立足化作混沌尘埃……`);
    }
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
        this.removeSword(s.state.id);
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
  /** 导出生态状态：边界/庚金/火墙/天劫开关 (P1-4 续档不丢天劫进度) */
  exportEcoState(): {
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    food: [number, number, number][];
    walls: [number, number][];
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
    return {
      bounds: { ...this.bounds },
      food,
      walls,
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
    for (let y = 0; y < this.config.height; y++) {
      this.food[y].fill(0);
      this.walls[y].fill(false);
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

    this.tickCounter++;
    if (this.tickCounter % 50 === 0) {
      this.populationHistory.push(this.swords.size);
    }
  }
}
