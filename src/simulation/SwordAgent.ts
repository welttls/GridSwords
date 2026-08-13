import type { Genome, BehaviorStats } from '../types';
import { SimpleNN } from './NeuralNet';
import type { World } from './World'; // v1.9.2：仅类型位使用，type-only 打破与 World 的 ESM 循环依赖
import { resolveBattle } from './BattleResolver';
import { mutateGenome, genomeChanged, ELEMENT_LABEL } from './Genetics';
import { affixName } from '../data/AffixDB';
import { eventBus, EVT } from '../utils/eventBus';
import { skillsFor, tryCastSkill, tickBuffs, tickCombatStates, MIND_SKILL_ULT, MIND_SKILL_POOLS, MIND_SKILL_BY_ID } from './Skills';
import {
  MAX_HP,
  ENERGY_SPLIT_THRESHOLD,
  BASE_ENERGY_CONSUMPTION,
  IDLE_MULT,
  HP_REGEN_PER_TICK,
  WATER_REGEN_MULT,
  DECISION_THRESHOLD,
  MAX_PERCEPTION_RANGE,
  INSTINCT_RANGE,
  MUTATION_STRENGTH,
  MIND_REALMS,
  MIND_REALM_THRESHOLDS,
  MIND_ENERGY_MULT,
  MIND_MAX_BONUS,
  LAVA_DESPERATION_CHANCE,
  DEEPWATER_SLOW_MULT,
  DEEPWATER_COST_MULT,
  BURN_DMG_PER_TICK,
} from '../constants';
import { maxHpOf, maxEnergyOf } from './swordStats';
import { clamp, randomInt, shuffle } from '../utils/mathUtils';
import type { DeathCause } from './Chronicle';

/** 8 方向：上下左右 + 四对角 */
const DIRS = [
  { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
];
/** 输出层 4 方向索引 → DIRS 下标 (上/下/左/右) */
const MOVES = [0, 1, 2, 3];

export class SwordAgent {
  state: import('../types').SwordState;
  brain: SimpleNN;
  world: World;
  behavior: BehaviorStats;
  lastMoveDir = 0;
  /** 上一格坐标 (禁止立即折返，避免两格间来回振荡) */
  private prevCell: { x: number; y: number } | null = null;
  /** v2.4.0：各技能独立冷却剩余 tick（运行时字段，不序列化——读档重置=旧行为） */
  skillCds: Record<string, number> = {};
  /** v2.0.0：剑心晋升候选绝技 (本命血脉待 3 选 1；运行时字段，不序列化) */
  pendingMindPick: string[] | null = null;
  /** v2.0.0：残血追击锁定——攻击未击杀时锁定目标，持续追杀至击杀/逃离 (运行时字段) */
  huntTargetId: string | null = null;
  /** v2.5.0：本 tick 内反震来源（死后归因 counter 用，运行时字段，不序列化） */
  private lastHitBy: string | undefined;
  /** v2.5.0：濒死逃生追踪——跌破 20% 待报，回血过 60% 记「nadir」事件（剑谱素材） */
  private nadirPending = false;
  /** v2.7.1：分化失败（满场无空位）后的冷却 tick——避免每 tick 重复变异+克隆大脑 */
  private splitRetryUntil = 0;

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
    input.push(clamp(this.state.energy / maxEnergyOf(this.state), 0, 1));
    input.push(clamp(this.state.hp / maxHpOf(this.state), 0, 1));
    return input;
  }

  /** 饥饿度：始终带饿意觅食，直到满灵力分化 */
  private hungerLevel(): number {
    return clamp(1.1 - this.state.energy / maxEnergyOf(this.state), 0, 1.1);
  }

  /** 全盘扫描：寻找最近的指定目标 (曼哈顿距离) */
  nearestTarget(type: 'food' | 'sword'): { dx: number; dy: number; dist: number } | null {
    const hunger = this.hungerLevel();
    const baseRange = clamp(Math.round(this.state.genome.perception * 2), 2, INSTINCT_RANGE);
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
        if (type === 'food') {
          if (this.world.foodAt(x, y) <= 0) continue;
        } else {
          const sid = this.world.swordIdAt(x, y);
          if (!sid) continue;
          const other = this.world.swords.get(sid);
          // v1.12.0：血亲（同源一脉）不可为敌——本能/恐惧/策略/技能目标一律排除；v2.1.0 天劫期间血亲亦相争
          if (!other || (this.world.kinProtected() && this.world.isKin(this, other))) continue;
        }
        const dist = Math.abs(dx) + Math.abs(dy);
        if (!best || dist < best.dist) best = { dx, dy, dist };
      }
    }
    return best;
  }

  /** 将偏移映射到 4 方向 (0上 1下 2左 3右) */
  private dirTo(dx: number, dy: number): number {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 3 : 2;
    return dy > 0 ? 1 : 0;
  }

  /** 本能偏置：基因驱动的先天行为 (饥饿追食 / 好战逐敌 / 伤重避战)；food/enemy 由 decide 预扫描复用 */
  private instinctBias(
    input: number[],
    food: { dx: number; dy: number; dist: number } | null,
    enemy: { dx: number; dy: number; dist: number } | null,
  ): number[] {
    const bias = [0, 0, 0, 0];
    const hpRatio = input[25];
    const aggr = this.world.effectiveAggression(this.state.genome.aggression, this.state.genome.element); // v2.8.0：相性杀性

    // 饥饿驱力：全盘扫描最近食物 (v1.12.0：权重上调 + 近距强采食，减少「绕食不食」)
    const hunger = this.hungerLevel();
    if (food) {
      const closeness = clamp(1 - food.dist / (MAX_PERCEPTION_RANGE + 1), 0.35, 1);
      // 近在咫尺（≤3 格）时加「立即采食」强偏置，压过随机剑心偏好（满灵力也顺手采）
      const nearBonus = food.dist <= 3 ? 0.35 * (1 - food.dist / 4) : 0;
      bias[this.dirTo(food.dx, food.dy)] += hunger * 1.0 * closeness + nearBonus;
    }

    // v2.3.0：奇遇种子——超强吸引（可隔熔岩感应；趋之若鹜是谜题驱动力，能否取得看手段）
    const seed = this.world.encounterSeed;
    if (seed) {
      const pos = this.state.position;
      const sdx = seed.x - pos.x;
      const sdy = seed.y - pos.y;
      const sdist = Math.abs(sdx) + Math.abs(sdy);
      if (sdist <= MAX_PERCEPTION_RANGE) {
        const closeness = clamp(1 - sdist / (MAX_PERCEPTION_RANGE + 1), 0.4, 1);
        bias[this.dirTo(sdx, sdy)] += 1.6 * closeness; // 强于食物(1.0)与逐敌(0.7)
      }
    }

    // 攻击本能：近旁有敌意剑意且状态良好 → 逐敌 (好战须量力；v2.0.0：门槛 0.5→0.4，中庸杀性也寻敌战斗)
    if (enemy && aggr > 0.4 && enemy.dist <= 6 && hpRatio > 0.35) {
      const closeness = clamp(1 - enemy.dist / 7, 0.35, 1);
      bias[this.dirTo(enemy.dx, enemy.dy)] += aggr * 0.7 * closeness;
    }

    // 恐惧本能：生命低时远离剑意 (反方向) —— v2.1.0 天劫收束期间失效（困兽犹斗，天劫之下无处可逃，谁都要争夺）
    if (enemy && !this.world.config.isShrinking && hpRatio < 0.45) {
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

  /** 无明确意图时的游荡：优先朝最近食物 (复用 decide 已扫描的最近目标)，否则随机 */
  private wanderChoice(food: { dx: number; dy: number; dist: number } | null): number {
    if (food) return this.dirTo(food.dx, food.dy);
    return randomInt(0, 3);
  }

  /** 决策：剑心输出 + 本能偏置 → 取最大方向；均低于阈值则游荡觅食 */
  decide(): number {
    // v2.0.0：残血追击锁定——已接战目标未死则持续追杀
    const hunt = this.huntDir();
    if (hunt) {
      this.lastMoveDir = this.dirTo(hunt.dx, hunt.dy);
      return this.lastMoveDir;
    }
    const input = this.perceive();
    // 全盘扫描一次，本能偏置与游荡复用同一份结果 (同 tick 内网格不变)
    const food = this.nearestTarget('food');
    const enemy = this.nearestTarget('sword');
    let out = this.brain.forward(input);
    const bias = this.instinctBias(input, food, enemy);
    out = out.map((v, i) => v + bias[i]);
    // 惯性：延续上次方向、折返略罚，打破感知/本能对冲造成的两格来回
    // v1.8.1：系数减半(0.06→0.03 / 0.12→0.06)，防随机剑心偏好滚雪球导致直线穿行/无视食物
    if (this.lastMoveDir >= 0) {
      out[this.lastMoveDir] += 0.03;
      out[this.lastMoveDir ^ 1] -= 0.06;
    }

    let best = -1;
    let bestVal = DECISION_THRESHOLD;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > bestVal) {
        bestVal = out[i];
        best = i;
      }
    }
    if (best < 0) best = this.wanderChoice(food);
    this.lastMoveDir = best;
    return best;
  }

  /** v2.0.0：追击锁定——目标存活/非血亲/在追击范围内则返回方向；杀性愈高追击愈执着（火系杀性最强、最爱追杀） */
  private huntDir(): { dx: number; dy: number } | null {
    if (!this.huntTargetId) return null;
    const other = this.world.swords.get(this.huntTargetId);
    // 杀性越高，放弃追击的血线越低、追击范围越大（温和系易罢手）
    const aggr = this.world.effectiveAggression(this.state.genome.aggression, this.state.genome.element); // v2.8.0：相性杀性
    const giveUpHp = 0.15 * (1 - aggr * 0.6); // 杀性 0.9→0.069 / 0.3→0.123
    if (!other || other.state.id === this.state.id || (this.world.kinProtected() && this.world.isKin(this, other)) || this.state.hp / maxHpOf(this.state) < giveUpHp) {
      this.huntTargetId = null; // 目标陨落/血亲/自身重伤，放弃追击
      return null;
    }
    const dx = other.state.position.x - this.state.position.x;
    const dy = other.state.position.y - this.state.position.y;
    if (Math.abs(dx) + Math.abs(dy) > Math.max(6, Math.round(this.effectivePerception() * 2) + 2 + Math.round(aggr * 4))) {
      this.huntTargetId = null; // 逃离视野，放弃追击
      return null;
    }
    return { dx, dy };
  }

  /** 有效攻伐 (受词条/buff 影响；v2.8.0：地图五行相性攻伐修正——如熔岩益火/克金) */
  effectiveSharpness(): number {
    let s = this.state.genome.sharpness;
    if (this.state.genome.affixes.includes('kill5')) s += 1.5; // 斩念成性
    if (this.state.buffAtkMult) s *= this.state.buffAtkMult;
    if (this.counterReady) s *= 1.5;
    s += this.world.affinityFor(this.state.genome.element)?.atkBonus ?? 0;
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

  /** 行动：移动/吃/战斗；目标被阻挡则尝试其他方向，避免卡墙。返回是否实际移动。 */
  act(dir: number): void {
    const tryMove = (d: number): boolean => {
      if (this.isDead()) return false; // v2.3.0：已陨落（熔岩焚身等）不再行动
      const dd = MOVES[d];
      const x = this.state.position.x + DIRS[dd].dx;
      const y = this.state.position.y + DIRS[dd].dy;
      if (this.world.inBounds(x, y) && !this.world.isWall(x, y)) {
        // v1.12.0：血亲占位视作阻挡（performMoveTo 返回 false），绕行而过
        return this.performMoveTo(x, y);
      }
      // v2.3.0：熔岩「致命诱惑」——极度饥饿时小概率无视避让、犯险踏入（一步踏入即剑体崩解）
      if (
        this.world.inBounds(x, y) &&
        this.world.isLava(x, y) &&
        this.hungerLevel() > 0.85 &&
        Math.random() < LAVA_DESPERATION_CHANCE
      ) {
        return this.performMoveTo(x, y);
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

  private performMoveTo(x: number, y: number): boolean {
    // v2.3.0：一步踏入熔岩，剑体崩解（一击必杀）——普通移动/执念犯险的唯一下场
    if (this.world.isLava(x, y)) {
      this.die('lava'); // v2.7.1：显式死因（原自推断误记 wound，成就「地形大师」/剑谱死因失真）
      return false;
    }
    this.prevCell = { x: this.state.position.x, y: this.state.position.y };
    this.state.facing = { x: x - this.state.position.x, y: y - this.state.position.y };
    this.actedThisTick = true; // 移动/采气/碰撞皆耗精元

    const food = this.world.foodAt(x, y);
    if (food > 0) {
      this.world.removeFood(x, y);
      // v2.0.0：水系「生生不息」——采食回能 ×1.35（感知高觅食强、吃得多回能多，防饿死；水存活前列，与土/火争前二）
      // 注意：采食不钳制上限——分化阈值(=maxEnergy)在扣精元消耗后才检查，若 clamp 到阈值会锁死在 79.98 永不分化
      // v2.8.0：地图相性采食回能修正（如熔岩薪火添势、寒潭如鱼得水）
      this.state.energy +=
        food * (this.state.genome.element === 'water' ? 1.35 : 1) * (this.world.affinityFor(this.state.genome.element)?.energyGainMult ?? 1);
      this.behavior.eatCount++;
      eventBus.emit(EVT.EAT, { x, y, intensity: food });
      this.world.moveSword(this, x, y);
      this.visitCurrent();
      return true;
    }

    const otherId = this.world.swordIdAt(x, y);
    if (otherId) {
      const defender = this.world.swords.get(otherId);
      if (defender) {
        // v1.12.0：血亲不相攻——同源一脉视作阻挡，绕行而过（不战斗、不寄灵）；v2.1.0 天劫期间血亲亦相争
        if (this.world.kinProtected() && this.world.isKin(this, defender)) {
          this.actedThisTick = false; // v2.7.1：被血亲阻挡、实际未行动——不按行动计满精元
          return false;
        }
        this.behavior.attackCount++;
        const result = resolveBattle(this, defender);
        eventBus.emit(EVT.BATTLE_HIT, {
          x: this.state.position.x,
          y: this.state.position.y,
          element: this.state.genome.element,
          intensity: result.damage,
        });
        this.counterReady = false; // 反击只生效一次
        // 淬毒：命中之敌剑体持续溃烂 (v2.0.0：毒伤 2/36tick，木系看家本领)
        if (this.state.genome.affixes.includes('poison')) {
          defender.state.poisonDmg = 2;
          defender.state.poisonTicks = 36;
        }
        if (result.defenderDied) {
          this.huntTargetId = null; // 目标已死，解除追击
          this.behavior.killCount++;
          // v2.5.0：剑域纪事——近战击杀（含首杀）
          this.world.recordKill(this.state.id, defender.state.id, 'melee');
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
          // 击杀后立即移除防御者，防止其残留为「僵尸剑意」再行动一轮；
          // 先清格再推进，攻方方能占据目标格 (占用校验会拦截旧顺序)
          defender.die('melee', this.state.id); // v2.2.1：走 die() 发 EVT.DEATH（死亡粒子/音效）
          this.world.moveSword(this, x, y);
          this.visitCurrent();
          return true;
        } else {
          // v2.5.0：反震致死归因——攻方将死（下个 isDead 检查走 die()，死因=反震、凶手=守方）
          if (result.attackerDied) {
            this.lastHitBy = defender.state.id;
            this.world.recordKill(defender.state.id, this.state.id, 'counter');
          }
          // v2.0.0：残血追击——目标未死则锁定，趁胜追杀至击杀/逃离
          if (this.state.hp / maxHpOf(this.state) > 0.35) this.huntTargetId = defender.state.id;
          this.behavior.waitCount++; // 反震退回原位
          return false;
        }
      }
      return false;
    }

    this.world.moveSword(this, x, y);
    this.behavior.moveCount++;
    this.visitCurrent();
    return true;
  }

  /** v2.2.1：本 tick 内剑体/精元是否已尽（行动后立即查死，防「诈尸回春」/僵尸剑再动） */
  private isDead(): boolean {
    return this.state.hp <= 0 || this.state.energy <= 0;
  }

  /** 每 tick 一步 */
  tick(): void {
    this.state.age++;
    this.actedThisTick = false;
    this.recheckAffixes();
    this.checkMindRealm();
    // v2.4.0：独立冷却——各技能冷却分别递减，归零即移除
    for (const k of Object.keys(this.skillCds)) {
      this.skillCds[k]--;
      if (this.skillCds[k] <= 0) delete this.skillCds[k];
    }

    // v2.3.0：控制状态——定身（青藤缚）/减速（地脉震）/深水阻滞（先读后减，避免被缩短一 tick）
    const rooted = (this.state.rootedTicks ?? 0) > 0;
    const slowed = (this.state.slowedTicks ?? 0) > 0 && Math.random() < 1 - 1 / DEEPWATER_SLOW_MULT;
    const deepMired =
      this.world.isDeepWater(this.state.position.x, this.state.position.y) &&
      this.state.genome.element !== 'water' &&
      Math.random() < 1 - 1 / DEEPWATER_SLOW_MULT;
    const mired = rooted || slowed || deepMired;

    tickBuffs(this.state);
    // v2.7.1：灼烧「先判后减」——与中毒一致，避免首 tick 被吞（原 burningTicks=48 实烧 47）
    if ((this.state.burningTicks ?? 0) > 0) {
      this.state.hp -= BURN_DMG_PER_TICK;
    }
    tickCombatStates(this.state); // v2.3.0：反震/免控/烈焰甲/定身/减速/灼烧计时

    // v2.3.0：熔岩——立于其上（瞬移落地）超过一个完整 tick 即剑体崩解；踏入（普通移动进入）已在 performMoveTo 即死
    const wasOnLava = this.world.isLava(this.state.position.x, this.state.position.y);

    if (!mired) {
      const dir = this.decide();
      this.act(dir);
      // v2.2.1：行动后立即查死——反震/碰撞致死不再继续追击或施放技能（原死亡检查在 tick 末尾，滞后一整步，wood 回春术可诈尸回正血）
      if (this.isDead()) { this.die(); return; }
      // v2.0.0：残血追击加速——锁定追击时身法如风，每 tick 多追一步，追上逃逸之敌
      if (this.huntTargetId && this.huntDir()) {
        this.act(this.decide());
        if (this.isDead()) { this.die(); return; }
      }
      // 无根水·身法加成：每 tick 有几率额外行动一步 (移动更迅疾，采气/避敌更快)
      const speedBonus = this.world.modifiers.speedBonus;
      if (speedBonus > 0 && Math.random() < speedBonus * 0.2) {
        const extraDir = this.decide();
        this.act(extraDir);
        if (this.isDead()) { this.die(); return; }
      }
    }
    // 剑意技能 (五行天赋 + 词条)：耗精元、各技独立冷却（v2.4.0，tryCastSkill 内部按技能查冷却）
    if (this.state.energy > 5 && !this.isDead()) {
      tryCastSkill(this, this.world, skillsFor(this.state.genome.element, this.state.genome.affixes, this.state.mindSkillIds));
    }

    const mods = this.world.modifiers;
    // 剑谱越强，日常维持耗神越多：锋刃之利、剑体之沉、身法之疾皆耗精元
    // (身法加成不再额外抬高基础消耗——额外移动本身已按行动计耗，收益与代价自平衡)
    const g = this.state.genome;
    let cost =
      BASE_ENERGY_CONSUMPTION * (1 + g.speed * 0.05 + g.sharpness * 0.03 + g.toughness * 0.02);
    cost *= this.actedThisTick ? 1 : IDLE_MULT; // 静养耗精元大减
    cost *= MIND_ENERGY_MULT[this.state.mindRealm ?? 0]; // 剑心愈明，维持愈省 (v1.12.0)
    // v2.3.0：立于深水，精元消耗加剧（水行免疫）
    if (this.world.isDeepWater(this.state.position.x, this.state.position.y) && g.element !== 'water') {
      cost *= DEEPWATER_COST_MULT;
    }
    // v2.1.0：水系「轻灵」耗神 -15% 已移除——食物效率（采食回能 ×1.35）已足够支撑水系生存
    if (mods.temperature === 'cold') cost *= 1.5;
    if (mods.temperature === 'breeze') cost *= 0.6;
    if (this.state.genome.affixes.includes('eat30')) cost *= 0.7; // 吞金成性
    // v2.8.0：地图五行相性——本域对本行剑意的耗神修正（如炎域煎灼水行耗神加剧 / 金生丽水耗神略省）
    cost *= this.world.affinityFor(g.element)?.costMult ?? 1;
    // v2.2.1：battleMods 剑诀修饰已移除（宗门大比走 Duel Fighter，野外从不赋值）
    this.state.energy -= cost;

    // v2.3.0：熔岩停留致死——本 tick 开始即在熔岩上，行动+施法后仍未离开 → 剑体崩解（瞬移落地当 tick 豁免，可再瞬移/移动逃生）
    if (wasOnLava && this.world.isLava(this.state.position.x, this.state.position.y)) {
      this.die('lava'); // v2.7.1：显式死因
      return;
    }

    // 缓慢回气 (v2.1.0：水系「生生不息」回血 ×2.0 保留，与采食回能 ×1.35 共同构成水系差异化；v2.8.0：地图相性回血修正)
    const regen =
      HP_REGEN_PER_TICK *
      (this.state.genome.element === 'water' ? WATER_REGEN_MULT : 1) *
      (this.world.affinityFor(this.state.genome.element)?.regenMult ?? 1);
    this.state.hp = Math.min(maxHpOf(this.state), this.state.hp + regen);
    if (this.state.hp < this.behavior.minHp) this.behavior.minHp = this.state.hp;

    // 中毒 (淬毒)：剑体持续溃烂
    if ((this.state.poisonTicks ?? 0) > 0) {
      this.state.hp -= this.state.poisonDmg ?? 1;
      this.state.poisonTicks = (this.state.poisonTicks ?? 0) - 1;
    }

    // v2.5.0：濒死逃生追踪——跌破 20% 待报，回血过 60% 记「nadir」（剑谱素材：残血逆袭）
    const hpRatioNow = this.state.hp / maxHpOf(this.state);
    if (!this.nadirPending && hpRatioNow < 0.2) {
      this.nadirPending = true;
    } else if (this.nadirPending && hpRatioNow >= 0.6) {
      this.nadirPending = false;
      this.world.chronicle.record('nadir', { actorId: this.state.id, data: { hpRatio: hpRatioNow } });
    }

    if (this.state.energy <= 0 || this.state.hp <= 0) {
      this.die();
      return;
    }

    // 能量达到阈值 → 分裂 (v2.2.0：分化阈值随剑心上限同步提高)
    if (this.state.energy >= maxEnergyOf(this.state)) {
      this.trySplit();
    }
  }

  /** 分裂 (繁衍) */
  private trySplit(): void {
    // v2.7.1：满场无空位后冷却 50 tick 再试——避免每 tick 重复变异+克隆大脑（GC 无用功）
    if (this.world.tickCounter < this.splitRetryUntil) return;
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
      this.state.energy = maxEnergyOf(this.state) / 2;
      // 事件日志：元素突变 / 新世代
      this.world.emitSplitEvents(this, childGenome, genomeChanged(this.state.genome, childGenome), placed);
    } else {
      this.splitRetryUntil = this.world.tickCounter + 50; // v2.7.1：无空位 → 冷却再试
    }
  }

  /** v2.5.0：剑意陨落——记录死因/凶手/血亲标记（剑谱与成就数据源） */
  die(cause?: DeathCause, killerId?: string): void {
    if (!this.world.swords.has(this.state.id)) return;
    this.state.hp = 0; // v2.3.0：陨落后 hp 归零（熔岩焚身路径先置 0；统一在此兜底，防「诈尸」再动）
    // v2.5.0：死因自推断（未显式传入时按当前状态判定）
    let finalCause = cause;
    if (!finalCause) {
      if (this.state.energy <= 0) finalCause = 'starve';
      else if ((this.state.poisonTicks ?? 0) > 0) finalCause = 'poison';
      else if ((this.state.burningTicks ?? 0) > 0) finalCause = 'burn';
      else finalCause = this.lastHitBy ? 'counter' : 'wound';
    }
    const finalKiller = killerId ?? this.lastHitBy;
    // v2.5.0：剑域纪事——陨落事件（死因/凶手/血亲标记；天劫期血亲亦相争，isKin 仍可查）
    this.world.chronicle.record('death', {
      actorId: this.state.id,
      targetId: finalKiller,
      data: {
        cause: finalCause,
        element: this.state.genome.element,
        kin: finalKiller ? this.world.isKin({ state: { id: finalKiller } }, { state: { id: this.state.id } }) : undefined,
      },
    });
    this.lastHitBy = undefined;
    eventBus.emit(EVT.DEATH, {
      x: this.state.position.x,
      y: this.state.position.y,
      element: this.state.genome.element,
    });
    this.world.removeSword(this.state.id);
  }

  /**
   * 剑心境界：杀伐而「开悟」，NN 扩容 + 增益 (v1.12.0)。
   * v2.0.0：只看击破（击杀数）达标即晋境，不再要求历经战斗数；晋升奖励剑心绝技——本命血脉 3 选 1（弹窗），外来剑意随机；忘我固定大招。
   * 新权重置 0（升级瞬间行为不变），子代继承境界（脑克隆自带容量）。
   */
  private checkMindRealm(): void {
    const realm = this.state.mindRealm ?? 0;
    if (realm >= MIND_REALMS.length - 1) return;
    const b = this.behavior;
    const th = MIND_REALM_THRESHOLDS[realm];
    // v2.0.0：只看击破（杀伐之证）
    if (b.killCount < th.kills) return;
    this.applyMindPromotion(realm + 1, 'slaughter');
  }

  /** v2.3.0：奇遇种子——直接提升一级剑心境界（已臻忘我则机缘化为精纯灵力补满） */
  grantMindRealm(): void {
    const realm = this.state.mindRealm ?? 0;
    if (realm >= MIND_REALMS.length - 1) {
      this.state.hp = maxHpOf(this.state);
      this.state.energy = maxEnergyOf(this.state);
      eventBus.emit(EVT.MIND, null);
      eventBus.emit(EVT.LOG, {
        text: `第${this.world.config.currentDay}日：一道剑意取得奇遇灵种，然已臻忘我之境，机缘化为精纯灵力，剑体精元尽数补满！`,
        focusId: this.state.id,
        important: true,
        rareToast: '✨ 奇遇灵光散为灵力，剑体精元补满！',
      });
      return;
    }
    this.applyMindPromotion(realm + 1, 'fortune');
  }

  /** 剑心晋境通用：扩容/上限+50/回满/绝技/日志（v2.3.0 由杀伐晋升与奇遇种子共用） */
  private applyMindPromotion(next: number, source: 'slaughter' | 'fortune'): void {
    this.state.mindRealm = next;
    // v2.5.0：剑域纪事——剑心晋境
    this.world.chronicle.record('promotion', {
      actorId: this.state.id,
      data: { realm: next, promoVia: source },
    });
    this.brain.expandHidden(MIND_REALMS[next].hidden);
    // 同步序列化快照，防存档读到扩容前的旧长度
    this.state.brainWeights = this.brain.getWeights();
    this.state.brainBiases = this.brain.getBiases();
    // v2.1.0：顿悟回春——晋境瞬间剑体回满、精元补满（低于分化阈值，不立即分化），防顿悟后被捡漏
    // v2.2.0：晋境同时剑体/精元上限 +50（凡心 95/80 → 通明 145/130 → 洞玄 195/180 → 忘我 245/230）
    this.state.maxHp = (this.state.maxHp ?? MAX_HP) + MIND_MAX_BONUS;
    this.state.maxEnergy = (this.state.maxEnergy ?? ENERGY_SPLIT_THRESHOLD) + MIND_MAX_BONUS;
    this.state.hp = maxHpOf(this.state);
    this.state.energy = maxEnergyOf(this.state);
    const name = MIND_REALMS[next].name;
    eventBus.emit(EVT.MIND, null); // 音频：剑心晋升「顿悟」
    // 剑心绝技：忘我固定大招；通明/洞玄 3 选 1（本命血脉弹窗选，外来随机）
    const skills = (this.state.mindSkillIds ??= []);
    if (next === MIND_REALMS.length - 1) {
      if (!skills.includes(MIND_SKILL_ULT.id)) skills.push(MIND_SKILL_ULT.id);
      // v2.5.0：剑域纪事——悟得终极绝技
      this.world.chronicle.record('mindSkill', { actorId: this.state.id, data: { skillId: MIND_SKILL_ULT.id } });
      eventBus.emit(EVT.LOG, {
        text:
          source === 'fortune'
            ? `第${this.world.config.currentDay}日：一道剑意得奇遇灵种灌顶，臻至「${name}」，顿悟终极剑意「${MIND_SKILL_ULT.name}」！`
            : `第${this.world.config.currentDay}日：一道剑意臻至「${name}」，顿悟终极剑意「${MIND_SKILL_ULT.name}」！`,
        focusId: this.state.id,
        important: true,
        rareToast: `🌟 剑心「${name}」！悟得大招「${MIND_SKILL_ULT.name}」`,
      });
    } else {
      const pool = MIND_SKILL_POOLS[next - 1];
      const candidates = pool.filter((s) => !skills.includes(s.id));
      if (candidates.length > 0) {
        if (this.state.origin === 'seed') {
          this.pendingMindPick = candidates.map((s) => s.id);
          eventBus.emit(EVT.LOG, {
            text: `第${this.world.config.currentDay}日：本命剑意剑心晋入「${name}」，只待择一绝技！`,
            focusId: this.state.id,
            important: true,
          });
        } else {
          const s = candidates[randomInt(0, candidates.length - 1)];
          skills.push(s.id);
          // v2.5.0：剑域纪事——外来剑意悟得绝技
          this.world.chronicle.record('mindSkill', { actorId: this.state.id, data: { skillId: s.id } });
          eventBus.emit(EVT.LOG, {
            text: `第${this.world.config.currentDay}日：一道剑意灵识大开，剑心晋入「${name}」，悟得绝技「${s.name}」！`,
            focusId: this.state.id,
            important: true,
            rareToast: `✨ 剑心「${name}」！悟得「${s.name}」`,
          });
        }
      } else {
        eventBus.emit(EVT.LOG, {
          text: `第${this.world.config.currentDay}日：一道剑意灵识大开，剑心晋入「${name}」！`,
          focusId: this.state.id,
          important: true,
          rareToast: `✨ 剑心「${name}」！`,
        });
      }
    }
  }

  /** v2.0.0：玩家在 3 选 1 弹窗中择定剑心绝技 */
  pickMindSkill(id: string): void {
    const s = MIND_SKILL_BY_ID[id];
    const skills = (this.state.mindSkillIds ??= []);
    if (s && !skills.includes(id)) skills.push(id);
    this.pendingMindPick = null;
    if (s) {
      // v2.5.0：剑域纪事——本命血脉择定绝技
      this.world.chronicle.record('mindSkill', { actorId: this.state.id, data: { skillId: id } });
      eventBus.emit(EVT.LOG, {
        text: `第${this.world.config.currentDay}日：本命剑意剑心晋入「${MIND_REALMS[this.state.mindRealm ?? 0].name}」，悟得绝技「${s.name}」！`,
        focusId: this.state.id,
        important: true,
        rareToast: `✨ 悟得剑心绝技「${s.name}」！`,
      });
    }
  }

  /** 词条参悟：满足条件即固化，可遗传 */
  private recheckAffixes(): void {
    const g = this.state.genome;
    const b = this.behavior;
    const add = (id: string, rare: boolean) => {
      if (g.affixes.includes(id)) return;
      g.affixes.push(id);
      // v2.5.0：剑域纪事——悟得词条
      this.world.chronicle.record('affix', { actorId: this.state.id, data: { affix: id } });
      eventBus.emit(EVT.MIND, null); // 音频：悟得词条「顿悟」
      eventBus.emit(EVT.LOG, {
        text: `第${this.world.config.currentDay}日：一道剑意悟得「${affixName(id)}」！`,
        focusId: this.state.id,
        important: true,
        rareToast: rare ? `✨ 悟得稀有词条「${affixName(id)}」！` : undefined,
      });
    };
    if (b.eatCount >= 20) add('eat30', false); // v1.7.1：词条门槛放宽，炼剑阶段更易悟得
    if (b.killCount >= 3) add('kill5', false);
    if (b.attackCount + b.fightsSurvived >= 25) add('fight15', false); // v1.11.0：历经百炼（25 战）更稀有
    if (b.cellsVisited >= 350 && b.cellsVisited / Math.max(1, this.state.age) >= 0.35) add('roam400', false); // v1.11.0：足迹≥350 且游走不绝（密度≥0.35/tick），苟活久不动者不悟
    // v2.0.0：淬毒归木系独有——木行久历杀伐即悟（木攻伐低、杀性温和，不再要求攻伐/杀性；毒为木系看家本领，非木行不悟）
    if (g.element === 'wood' && this.state.age >= 2500 && b.attackCount + b.fightsSurvived >= 15) add('poison', true);
    if (g.element === 'wood' && g.strategy >= 0.7 && this.state.generation >= 4) add('parasite', true);
  }
}
