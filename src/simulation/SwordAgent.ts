import type { Genome, BehaviorStats } from '../types';
import { SimpleNN } from './NeuralNet';
import { World } from './World';
import { resolveBattle } from './BattleResolver';
import { mutateGenome, genomeChanged, ELEMENT_LABEL } from './Genetics';
import { affixName } from '../data/AffixDB';
import { eventBus, EVT } from '../utils/eventBus';
import { skillsFor, tryCastSkill, tickBuffs } from './Skills';
import {
  MAX_HP,
  ENERGY_SPLIT_THRESHOLD,
  BASE_ENERGY_CONSUMPTION,
  IDLE_MULT,
  HP_REGEN_PER_TICK,
  DECISION_THRESHOLD,
  MAX_PERCEPTION_RANGE,
  GENE_MAX,
  MUTATION_STRENGTH,
} from '../constants';
import { clamp, randomInt, shuffle } from '../utils/mathUtils';

/** 8 方向：上下左右 + 四对角 */
const DIRS = [
  { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
];
/** 输出层 4 方向索引 → DIRS 下标 (上/下/左/右) */
const MOVES = [0, 1, 2, 3];
/** 每个移动方向关联的感知方向 */
const MOVE_DISCS = [
  [0, 4, 5], // 上
  [1, 6, 7], // 下
  [2, 4, 6], // 左
  [3, 5, 7], // 右
];

export class SwordAgent {
  state: import('../types').SwordState;
  brain: SimpleNN;
  world: World;
  behavior: BehaviorStats;
  lastMoveDir = 0;
  /** 上一格坐标 (禁止立即折返，避免两格间来回振荡) */
  private prevCell: { x: number; y: number } | null = null;
  /** 技能冷却剩余 tick */
  skillCd = 0;

  /** 宗门大比剑诀修饰 */
  battleMods: {
    firstStrike?: boolean;  // 首轮抢攻
    counterStrike?: boolean; // 后手反击
    agile?: boolean;        // 游斗
    quick?: boolean;        // 快剑
    thunder?: boolean;      // 雷引
    noCost?: boolean;       // 斗剑台不耗能量
  } = {};
  counterReady = false;
  /** 本 tick 是否有所行动 (移动/采气/碰撞)，影响精元消耗 */
  private actedThisTick = false;

  private visited = new Set<number>();

  constructor(
    state: import('../types').SwordState,
    brain: SimpleNN,
    world: World,
  ) {
    this.state = state;
    this.brain = brain;
    this.world = world;
    // P1-5：续档时恢复行为统计 (cellsVisited 需重建 visited 集合)
    this.behavior = state.behavior ?? {
      eatCount: 0,
      attackCount: 0,
      killCount: 0,
      moveCount: 0,
      waitCount: 0,
      cellsVisited: 0,
      minHp: MAX_HP,
      fightsSurvived: 0,
    };
    this.visited = new Set<number>();
    // 以占位键重建 visited，使 visited.size 与已恢复的 cellsVisited 一致 (仅用于去重计数)
    // 先计入当前位置，再以高段位占位键补齐，避免与实际格子索引冲突
    const cur = this.cellIndex(state.position.x, state.position.y);
    this.visited.add(cur);
    for (let i = this.visited.size; i < this.behavior.cellsVisited; i++) {
      this.visited.add(1_000_000 + i);
    }
    this.visitCurrent();
  }

  private cellIndex(x: number, y: number): number {
    return y * this.world.config.width + x;
  }

  private visitCurrent(): void {
    const k = this.cellIndex(this.state.position.x, this.state.position.y);
    if (!this.visited.has(k)) {
      this.visited.add(k);
      this.behavior.cellsVisited = this.visited.size;
    }
  }

  /** 感知：8方向 * (庚金/剑意/墙) + 自身精元比 + 剑体比 = 26 输入 */
  perceive(): number[] {
    const input: number[] = [];
    const perc = this.state.genome.perception + (this.state.genome.affixes.includes('roam400') ? 2 : 0);
    const range = clamp(Math.round(perc * 2), 2, MAX_PERCEPTION_RANGE);
    const pos = this.state.position;
    for (const d of DIRS) {
      let foodNear = 0;
      let swordNear = 0;
      let wallNear = 0;
      for (let s = 1; s <= range; s++) {
        const x = pos.x + d.dx * s;
        const y = pos.y + d.dy * s;
        if (!this.world.inBounds(x, y) || this.world.isWall(x, y)) {
          wallNear = 1 - s / (range + 1);
          break;
        }
        if (foodNear === 0 && this.world.foodAt(x, y) > 0) foodNear = 1 - s / (range + 1);
        if (swordNear === 0 && this.world.swordIdAt(x, y)) swordNear = 1 - s / (range + 1);
      }
      input.push(foodNear, swordNear, wallNear);
    }
    input.push(clamp(this.state.energy / ENERGY_SPLIT_THRESHOLD, 0, 1));
    input.push(clamp(this.state.hp / MAX_HP, 0, 1));
    return input;
  }

  /** 饥饿度：始终带饿意觅食，直到满灵力分化 */
  private hungerLevel(): number {
    return clamp(1.1 - this.state.energy / ENERGY_SPLIT_THRESHOLD, 0, 1.1);
  }

  /** 全盘扫描：寻找最近的指定目标 (曼哈顿距离) */
  nearestTarget(type: 'food' | 'sword'): { dx: number; dy: number; dist: number } | null {
    const hunger = this.hungerLevel();
    const baseRange = clamp(Math.round(this.state.genome.perception * 2), 2, 10);
    const huntBonus = type === 'food' && hunger > 0.6 ? 10 : 0; // 极度饥饿时扩大搜寻半径
    const range = Math.min(MAX_PERCEPTION_RANGE, baseRange + huntBonus);
    const pos = this.state.position;
    let best: { dx: number; dy: number; dist: number } | null = null;
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (!this.world.inBounds(x, y) || this.world.isWall(x, y)) continue;
        const found = type === 'food' ? this.world.foodAt(x, y) > 0 : this.world.swordIdAt(x, y) !== null;
        if (found) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (!best || dist < best.dist) best = { dx, dy, dist };
        }
      }
    }
    return best;
  }

  /** 将偏移映射到 4 方向 (0上 1下 2左 3右) */
  private dirTo(dx: number, dy: number): number {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 3 : 2;
    return dy > 0 ? 1 : 0;
  }

  /** 本能偏置：基因驱动的先天行为 (饥饿追食 / 好战逐敌 / 伤重避战) */
  private instinctBias(input: number[]): number[] {
    const bias = [0, 0, 0, 0];
    const hpRatio = input[25];
    const aggr = this.world.effectiveAggression(this.state.genome.aggression);

    // 饥饿驱力：全盘扫描最近食物
    const hunger = this.hungerLevel();
    const food = this.nearestTarget('food');
    if (food) {
      const closeness = clamp(1 - food.dist / (MAX_PERCEPTION_RANGE + 1), 0.35, 1);
      bias[this.dirTo(food.dx, food.dy)] += hunger * 0.7 * closeness;
    }

    // 攻击本能：近旁有敌意剑意且状态良好 → 逐敌 (好战须量力)
    const enemy = this.nearestTarget('sword');
    if (enemy && aggr > 0.5 && enemy.dist <= 6 && hpRatio > 0.35) {
      const closeness = clamp(1 - enemy.dist / 7, 0.35, 1);
      bias[this.dirTo(enemy.dx, enemy.dy)] += aggr * 0.7 * closeness;
    }

    // 恐惧本能：生命低时远离剑意 (反方向)
    if (enemy && hpRatio < 0.45) {
      bias[this.dirTo(enemy.dx, enemy.dy) ^ 1] += (1 - hpRatio) * 0.7;
    }

    // 策略本能：合击者近众，孤狼者独行
    const strat = this.state.genome.strategy;
    if (enemy && enemy.dist <= 8) {
      const closeness = clamp(1 - enemy.dist / 9, 0.3, 1);
      if (strat >= 0.65) {
        bias[this.dirTo(enemy.dx, enemy.dy)] += (strat - 0.5) * 0.55 * closeness;
      } else if (strat <= 0.35) {
        bias[this.dirTo(enemy.dx, enemy.dy) ^ 1] += (0.5 - strat) * 0.55 * closeness;
      }
    }

    return bias;
  }

  /** 无明确意图时的游荡：优先朝最近食物 (全盘扫描)，否则随机 */
  private wanderChoice(_input: number[]): number {
    const food = this.nearestTarget('food');
    if (food) return this.dirTo(food.dx, food.dy);
    return randomInt(0, 3);
  }

  /** 决策：剑心输出 + 本能偏置 → 取最大方向；均低于阈值则游荡觅食 */
  decide(): number {
    const input = this.perceive();
    let out = this.brain.forward(input);
    const bias = this.instinctBias(input);
    out = out.map((v, i) => v + bias[i]);
    // 惯性：延续上次方向、折返略罚，打破感知/本能对冲造成的两格来回
    if (this.lastMoveDir >= 0) {
      out[this.lastMoveDir] += 0.06;
      out[this.lastMoveDir ^ 1] -= 0.12;
    }

    let best = -1;
    let bestVal = DECISION_THRESHOLD;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > bestVal) {
        bestVal = out[i];
        best = i;
      }
    }
    if (best < 0) best = this.wanderChoice(input);
    this.lastMoveDir = best;
    return best;
  }

  /** 有效锋锐 (受剑诀/词条/buff 影响) */
  effectiveSharpness(): number {
    let s = this.state.genome.sharpness;
    if (this.state.genome.affixes.includes('kill5')) s += 1.5; // 斩念成性
    if (this.state.buffAtkMult) s *= this.state.buffAtkMult;
    if (this.battleMods.firstStrike && this.world.tickCounter < 50) s *= 1.2;
    if (this.battleMods.agile) s *= 0.9;
    if (this.battleMods.quick) s *= 1.1;
    if (this.battleMods.thunder) s *= 1.15;
    if (this.counterReady) s *= 1.5;
    return s;
  }

  /** 有效坚固 (受词条影响) */
  effectiveToughness(): number {
    let t = this.state.genome.toughness;
    if (this.state.genome.affixes.includes('fight15')) t += 1.5; // 百炼之体
    return t;
  }

  /** 有效感知 (受词条影响) */
  effectivePerception(): number {
    let p = this.state.genome.perception;
    if (this.state.genome.affixes.includes('roam400')) p += 2; // 游历万方
    return p;
  }

  /** 行动：移动/吃/战斗；目标被阻挡则尝试其他方向，避免卡墙 */
  act(dir: number): void {
    const tryMove = (d: number): boolean => {
      const dd = MOVES[d];
      const x = this.state.position.x + DIRS[dd].dx;
      const y = this.state.position.y + DIRS[dd].dy;
      if (this.world.inBounds(x, y) && !this.world.isWall(x, y)) {
        this.performMoveTo(x, y);
        return true;
      }
      return false;
    };
    // 禁止立即折返：刚离开的格子不再走回（除非无路可走），打破两格死循环
    const isBacktrack = (d: number): boolean => {
      if (!this.prevCell) return false;
      const dd = MOVES[d];
      return (
        this.state.position.x + DIRS[dd].dx === this.prevCell.x &&
        this.state.position.y + DIRS[dd].dy === this.prevCell.y
      );
    };

    if (!isBacktrack(dir) && tryMove(dir)) return;
    const others = shuffle([0, 1, 2, 3].filter((d) => d !== dir));
    for (const alt of others) {
      if (!isBacktrack(alt) && tryMove(alt)) return;
    }
    // 其它方向均避不开折返（如死胡同）→ 允许折返或任选可走方向
    if (tryMove(dir)) return;
    for (const alt of others) {
      if (tryMove(alt)) return;
    }
    this.behavior.waitCount++;
  }

  private performMoveTo(x: number, y: number): void {
    this.prevCell = { x: this.state.position.x, y: this.state.position.y };
    this.state.facing = { x: x - this.state.position.x, y: y - this.state.position.y };
    this.actedThisTick = true; // 移动/采气/碰撞皆耗精元

    const food = this.world.foodAt(x, y);
    if (food > 0) {
      this.world.removeFood(x, y);
      this.state.energy += food;
      this.behavior.eatCount++;
      eventBus.emit(EVT.EAT, { x, y, intensity: food });
      this.world.moveSword(this, x, y);
      this.visitCurrent();
      return;
    }

    const otherId = this.world.swordIdAt(x, y);
    if (otherId) {
      const defender = this.world.swords.get(otherId);
      if (defender) {
        this.behavior.attackCount++;
        const result = resolveBattle(this, defender);
        eventBus.emit(EVT.BATTLE_HIT, {
          x: this.state.position.x,
          y: this.state.position.y,
          element: this.state.genome.element,
          intensity: result.damage,
        });
        this.counterReady = false; // 反击只生效一次
        // 淬毒：命中之敌剑体持续溃烂
        if (this.state.genome.affixes.includes('poison')) {
          defender.state.poisonDmg = 1;
          defender.state.poisonTicks = 30;
        }
        if (result.defenderDied) {
          this.behavior.killCount++;
          // 寄灵：击败者被寄灵化为己方剑子 (罕见能力)
          if (this.state.genome.affixes.includes('parasite') && Math.random() < 0.5) {
            const converted = this.world.spawnParasite(this, x, y);
            if (!converted) {
              const corpseValue = Math.max(4, defender.state.energy * 0.4);
              this.world.spawnCorpseFood(x, y, corpseValue);
            }
          } else {
            // 敌方尸身化食：陨落之剑化为庚金之气
            const corpseValue = Math.max(4, defender.state.energy * 0.4);
            this.world.spawnCorpseFood(x, y, corpseValue);
          }
          this.world.moveSword(this, x, y);
          this.visitCurrent();
          // 击杀后立即移除防御者，防止其残留为「僵尸剑意」再行动一轮
          this.world.removeSword(defender.state.id);
        } else {
          this.behavior.waitCount++; // 反震退回原位
        }
      }
      return;
    }

    this.world.moveSword(this, x, y);
    this.behavior.moveCount++;
    this.visitCurrent();
  }

  /** 每 tick 一步 */
  tick(): void {
    this.state.age++;
    this.actedThisTick = false;
    this.recheckAffixes();
    if (this.skillCd > 0) this.skillCd--;
    tickBuffs(this.state);
    const dir = this.decide();
    this.act(dir);
    // 无根水·身法加成：每 tick 有几率额外行动一步 (移动更迅疾，采气/避敌更快)
    const speedBonus = this.world.modifiers.speedBonus;
    if (speedBonus > 0 && Math.random() < speedBonus * 0.2) {
      const extraDir = this.decide();
      this.act(extraDir);
    }
    // 剑意技能 (五行天赋 + 词条)：耗精元、有冷却
    if (this.skillCd <= 0 && this.state.energy > 5) {
      tryCastSkill(this, this.world, skillsFor(this.state.genome.element, this.state.genome.affixes));
    }

    const mods = this.world.modifiers;
    // 剑谱越强，日常维持耗神越多：锋刃之利、剑体之沉、身法之疾皆耗精元
    // (身法加成不再额外抬高基础消耗——额外移动本身已按行动计耗，收益与代价自平衡)
    const g = this.state.genome;
    let cost =
      BASE_ENERGY_CONSUMPTION * (1 + g.speed * 0.05 + g.sharpness * 0.03 + g.toughness * 0.02);
    cost *= this.actedThisTick ? 1 : IDLE_MULT; // 静养耗精元大减
    if (mods.temperature === 'cold') cost *= 1.5;
    if (mods.temperature === 'breeze') cost *= 0.6;
    if (this.state.genome.affixes.includes('eat30')) cost *= 0.7; // 吞金成性
    if (this.battleMods.agile) cost *= 0.5;   // 游斗：身法灵动
    if (this.battleMods.quick) cost *= 0.8;   // 快剑：举重若轻
    if (!this.battleMods.noCost) this.state.energy -= cost;

    // 缓慢回气
    this.state.hp = Math.min(MAX_HP, this.state.hp + HP_REGEN_PER_TICK);
    if (this.state.hp < this.behavior.minHp) this.behavior.minHp = this.state.hp;

    // 中毒 (淬毒)：剑体持续溃烂
    if ((this.state.poisonTicks ?? 0) > 0) {
      this.state.hp -= this.state.poisonDmg ?? 1;
      this.state.poisonTicks = (this.state.poisonTicks ?? 0) - 1;
    }

    // 雷劫 (雷劫液)：速度越慢越易被雷击
    if (mods.thunderstorm && Math.random() < 0.03) {
      const strikeChance = clamp(1 - this.state.genome.speed / GENE_MAX, 0.1, 1);
      if (Math.random() < strikeChance) {
        this.state.hp -= 25;
        this.state.energy -= 12;
        eventBus.emit(EVT.THUNDER, { x: this.state.position.x, y: this.state.position.y });
      }
    }

    if (this.state.energy <= 0 || this.state.hp <= 0) {
      this.die();
      return;
    }

    // 能量达到阈值 → 分裂
    if (this.state.energy >= ENERGY_SPLIT_THRESHOLD) {
      this.trySplit();
    }
  }

  /** 分裂 (繁衍) */
  private trySplit(): void {
    const rate = this.world.mutationRate;
    const childGenome = mutateGenome(
      this.state.genome,
      rate,
      MUTATION_STRENGTH,
      this.world.mutationBiasRates(),
    );
    const childBrain = this.brain.clone();
    childBrain.mutate(rate, MUTATION_STRENGTH);

    const placed = this.world.spawnChild(this, childGenome, childBrain);
    if (placed) {
      this.state.energy = ENERGY_SPLIT_THRESHOLD / 2;
      // 事件日志：元素突变 / 新世代
      this.world.emitSplitEvents(this, childGenome, genomeChanged(this.state.genome, childGenome), placed);
    }
  }

  die(): void {
    eventBus.emit(EVT.DEATH, {
      x: this.state.position.x,
      y: this.state.position.y,
      element: this.state.genome.element,
    });
    this.world.removeSword(this.state.id);
  }

  /** 词条参悟：满足条件即固化，可遗传 */
  private recheckAffixes(): void {
    const g = this.state.genome;
    const b = this.behavior;
    const add = (id: string, rare: boolean) => {
      if (g.affixes.includes(id)) return;
      g.affixes.push(id);
      eventBus.emit(EVT.LOG, {
        text: `第${this.world.config.currentDay}日：一道剑意悟得「${affixName(id)}」！`,
        focusId: this.state.id,
        important: true,
        rareToast: rare ? `✨ 悟得稀有词条「${affixName(id)}」！` : undefined,
      });
    };
    if (b.eatCount >= 30) add('eat30', false);
    if (b.killCount >= 5) add('kill5', false);
    if (b.attackCount + b.fightsSurvived >= 20) add('fight15', false);
    if (b.cellsVisited >= 400) add('roam400', false);
    if (g.sharpness >= 8 && g.aggression >= 0.65 && this.state.age >= 2000) add('poison', true); // 淬毒：高锋锐+高杀性+久历杀伐
    if (g.element === 'wood' && g.strategy >= 0.7 && this.state.generation >= 5) add('parasite', true);
  }
}
