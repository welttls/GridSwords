import type { World } from './World';
import type { SwordAgent } from './SwordAgent';
import type { Element, Genome, SwordState } from '../types';
import { MAX_HP, BUFF_CAST_CHANCE, MIND_CAST_MULT, KILL_HEAL_PCT, FIRE_WALL_RADIUS } from '../constants';
import { maxHpOf } from './swordStats';
import { eventBus, EVT } from '../utils/eventBus';
import { clamp, randomInt } from '../utils/mathUtils';

export type SkillKind = 'projectile' | 'aoe' | 'line' | 'teleport' | 'heal' | 'convert' | 'buff';

/** 剑意技能 (五行天赋 + 词条衍生，需耗精元释放) */
export interface SwordSkill {
  id: string;
  name: string;
  kind: SkillKind;
  element?: Element;
  affix?: string;
  desc: string;
  /** 精元消耗 */
  energyCost: number;
  /** 冷却 tick */
  cooldown: number;
  /** 每 tick 触发概率 */
  castChance: number;
  /** 攻击型触发距离 */
  range?: number;
  /** AoE 半径 */
  radius?: number;
  /** 伤害倍率 (基础 = 有效攻伐) */
  dmgMult?: number;
  /** 回复百分比 */
  healPct?: number;
  buffAtk?: number;
  buffDef?: number;
  buffTicks?: number;
  /** v2.0.0：直线贯穿——命中沿途所有目标而非仅首个 (剑心绝技) */
  pierce?: boolean;
  /** v2.3.0：机制差异化——定身/击退/灼烧/减速/反震/免控/烈焰甲 */
  rootTicks?: number;
  knockback?: number;
  burnTicks?: number;
  slowTicks?: number;
  reflectPct?: number;
  immuneCC?: boolean;
  flameArmor?: boolean;
}

/** 五行天赋技能 (每行 2 技：主技 + 辅技，v1.7.1 扩充让炼剑阶段更丰富) */
export const ELEMENT_TALENTS: Record<Element, SwordSkill[]> = {
  metal: [
    {
      id: 'skill_swordqi', name: '剑气斩', kind: 'projectile', element: 'metal',
      desc: '自剑尖推出弧光剑气，横贯剑域，所过之处剑意受创。',
      energyCost: 18, cooldown: 260, castChance: 0.02, range: 12, dmgMult: 1.8,
    },
    {
      id: 'skill_goldarmor', name: '金罡体', kind: 'buff', element: 'metal',
      desc: '庚金凝甲，剑体坚不可摧；受近身攻击时反弹来剑之威。',
      energyCost: 14, cooldown: 260, castChance: 0.03, buffDef: 1.2, buffTicks: 240, reflectPct: 0.25,
    },
  ],
  wood: [
    {
      id: 'skill_regrowth', name: '回春术', kind: 'heal', element: 'wood',
      desc: '以青木之气滋养剑体，回复大量剑体。',
      energyCost: 20, cooldown: 320, castChance: 0.05, healPct: 0.3,
    },
    {
      id: 'skill_vine', name: '青藤缚', kind: 'projectile', element: 'wood',
      desc: '青藤缠身，缚敌于数步之外——被缚者一时动弹不得。',
      energyCost: 16, cooldown: 240, castChance: 0.04, range: 10, dmgMult: 1.2, rootTicks: 40,
    },
  ],
  water: [
    {
      id: 'skill_blink', name: '瞬水步', kind: 'teleport', element: 'water',
      desc: '身化水光瞬移，避敌锋芒。',
      energyCost: 14, cooldown: 240, castChance: 0.06,
    },
    {
      id: 'skill_tide', name: '惊涛斩', kind: 'line', element: 'water',
      desc: '剑化惊涛，一线横卷——受击者被浪涛击退数步。',
      energyCost: 20, cooldown: 280, castChance: 0.03, range: 16, dmgMult: 1.8, knockback: 2,
    },
  ],
  fire: [
    {
      id: 'skill_eruption', name: '焚天爆', kind: 'aoe', element: 'fire',
      desc: '引燃周身灵气爆散，重创方圆之敌——余烬化火墙向外扩散，灼烧所过之敌后消散（不留火海、不困自身）。',
      energyCost: 22, cooldown: 300, castChance: 0.02, radius: 3, dmgMult: 1.5, burnTicks: 48,
    },
    {
      id: 'skill_blaze', name: '烈焰甲', kind: 'buff', element: 'fire',
      desc: '烈焰缠身，攻势暴涨——近身搏杀时剑火燎敌，灼伤所击之敌。',
      energyCost: 14, cooldown: 240, castChance: 0.03, buffAtk: 1.25, buffTicks: 220, flameArmor: true,
    },
  ],
  earth: [
    {
      id: 'skill_bulwark', name: '磐石护', kind: 'buff', element: 'earth',
      desc: '厚土凝甲，剑体坚不可摧——泰山不动，免于束缚与击退。',
      energyCost: 15, cooldown: 300, castChance: 0.05, buffDef: 1, buffTicks: 240, immuneCC: true,
    },
    {
      id: 'skill_quake', name: '地脉震', kind: 'aoe', element: 'earth',
      desc: '地脉震动，方圆皆震——受震者身形迟滞，如陷泥沼。',
      energyCost: 20, cooldown: 280, castChance: 0.03, radius: 3, dmgMult: 1.4, slowTicks: 80,
    },
  ],
};

/** 词条衍生技能 */
export const AFFIX_SKILLS: Record<string, SwordSkill> = {
  kill5: {
    id: 'skill_breach', name: '天门破', kind: 'line', affix: 'kill5',
    desc: '一剑破天门，直线贯穿剑域。',
    energyCost: 24, cooldown: 300, castChance: 0.02, range: 20, dmgMult: 2.4,
  },
  fight15: {
    id: 'skill_hundred', name: '百炼守', kind: 'buff', affix: 'fight15',
    desc: '百炼成钢，固守之势——受击时反弹来剑之威。',
    energyCost: 15, cooldown: 280, castChance: 0.05, buffDef: 1.5, buffTicks: 260, reflectPct: 0.3,
  },
  roam400: {
    id: 'skill_roam', name: '游龙步', kind: 'buff', affix: 'roam400',
    desc: '游历万方之悟，身法灵动、攻势暴涨。',
    energyCost: 16, cooldown: 260, castChance: 0.05, buffAtk: 1.3, buffTicks: 200,
  },
  eat30: {
    id: 'skill_convert', name: '吞金燃灵', kind: 'convert', affix: 'eat30',
    desc: '燃烧精元化为磅礴灵力，剑体与攻势俱盛。',
    energyCost: 26, cooldown: 340, castChance: 0.04, healPct: 0.25, buffAtk: 1.4, buffTicks: 220,
  },
  poison: {
    id: 'skill_poisonrain', name: '淬毒雨', kind: 'aoe', affix: 'poison',
    desc: '木行独门 · 剑气化雨，方圆之敌尽染奇毒。',
    energyCost: 24, cooldown: 320, castChance: 0.02, radius: 3, dmgMult: 0.9,
  },
  parasite: {
    id: 'skill_parasite', name: '寄灵噬', kind: 'line', affix: 'parasite',
    desc: '噬敌灵机，夺其气血以养己身。',
    energyCost: 20, cooldown: 300, castChance: 0.02, range: 14, dmgMult: 1.6,
  },
};

/** 剑心绝技 (v2.0.0)：晋升奖励，分三档——通明 3 选 1 / 洞玄 3 选 1 / 忘我固定大招 */
export const MIND_SKILLS_COMMON_1: SwordSkill[] = [
  {
    id: 'skill_swordrain', name: '万剑归宗', kind: 'aoe',
    desc: '万千剑影自天而降，剑域之内，寸草难存。',
    energyCost: 26, cooldown: 340, castChance: 0.02, radius: 4, dmgMult: 2.0,
  },
  {
    id: 'skill_breakall', name: '一剑破万法', kind: 'line', pierce: true,
    desc: '剑出无我，万法皆破——一道剑气贯穿沿途诸敌。',
    energyCost: 24, cooldown: 320, castChance: 0.02, range: 16, dmgMult: 1.8,
  },
  {
    id: 'skill_heartlight', name: '剑心通明', kind: 'buff',
    desc: '剑心澄澈，攻守兼济——攻势与剑体同盛。',
    energyCost: 18, cooldown: 300, castChance: 0.05, buffAtk: 1.5, buffDef: 1.2, buffTicks: 220,
  },
];
export const MIND_SKILLS_COMMON_2: SwordSkill[] = [
  {
    id: 'skill_fixworld', name: '剑定乾坤', kind: 'aoe',
    desc: '剑气冲霄，方圆皆定——大范围之敌尽受重创，且身形迟滞。',
    energyCost: 28, cooldown: 360, castChance: 0.02, radius: 5, dmgMult: 1.5, slowTicks: 60,
  },
  {
    id: 'skill_flying', name: '天外飞仙', kind: 'projectile',
    desc: '飞仙一剑，白虹贯日——集力于一点的绝杀。',
    energyCost: 24, cooldown: 340, castChance: 0.02, range: 14, dmgMult: 3.0,
  },
  {
    id: 'skill_thunderstroke', name: '雷音剑势', kind: 'line', pierce: true,
    desc: '剑引雷音，紫电贯穿——雷光一线，诸敌辟易。',
    energyCost: 26, cooldown: 340, castChance: 0.02, range: 18, dmgMult: 2.2,
  },
];
/** 剑心大招：忘我境固定获得 */
export const MIND_SKILL_ULT: SwordSkill = {
  id: 'skill_swordheaven', name: '万剑朝宗', kind: 'aoe',
  desc: '万剑齐发，天地俯首——终极一剑，无人可当。',
  energyCost: 30, cooldown: 400, castChance: 0.02, radius: 6, dmgMult: 2.6,
};
/** 剑心绝技 id → 技能 */
export const MIND_SKILL_BY_ID: Record<string, SwordSkill> = Object.fromEntries(
  [...MIND_SKILLS_COMMON_1, ...MIND_SKILLS_COMMON_2, MIND_SKILL_ULT].map((s) => [s.id, s]),
);
/** 各境界晋升候选池 (下标=当前境)：通明/洞玄 3 选 1；忘我走固定大招 */
export const MIND_SKILL_POOLS: SwordSkill[][] = [
  MIND_SKILLS_COMMON_1,
  MIND_SKILLS_COMMON_2,
  [],
];

/** 技能列表缓存 (词条集合小、命中率高；返回只读使用，勿外部修改) */
const skillsCache = new Map<string, SwordSkill[]>();

/** 某剑意可用的技能 (五行天赋主技+辅技 + 词条 + 剑心绝技 v2.0.0) */
export function skillsFor(element: Element, affixes: string[], mindSkillIds?: string[]): SwordSkill[] {
  const key = `${element}|${affixes.join(',')}|${(mindSkillIds ?? []).join(',')}`;
  const cached = skillsCache.get(key);
  if (cached) return cached;
  const list: SwordSkill[] = [...ELEMENT_TALENTS[element]];
  for (const a of affixes) {
    const s = AFFIX_SKILLS[a];
    if (s) list.push(s);
  }
  if (mindSkillIds) {
    for (const id of mindSkillIds) {
      const s = MIND_SKILL_BY_ID[id];
      if (s) list.push(s);
    }
  }
  skillsCache.set(key, list);
  return list;
}

/** v2.4.0：技能等级优先级——高等级技能 CD 长但优先施放（忘我大招 > 通明/洞玄绝技 > 五行天赋/词条） */
function skillTier(s: SwordSkill): number {
  if (s.id === MIND_SKILL_ULT.id) return 3;
  if (MIND_SKILL_BY_ID[s.id]) return 2;
  return 1;
}

/**
 * 触发技能 (headless 结算 + 渲染事件)。
 * v2.4.0 重构：① 各技能独立冷却（不再共用一条冷却饿死高等级技能）；
 * ② 情境智能评分——多敌在范围→偏向范围技、单敌→偏向单体技、残血→保命（逃跑/回血）优先；
 * ③ 等级优先——评分 = 等级×10 + 情境加成 + 随机抖动，选最高分施放。
 */
export function tryCastSkill(agent: SwordAgent, world: World, skills: SwordSkill[]): boolean {
  const st = agent.state;
  const hpRatio = st.hp / maxHpOf(st);
  const energy = st.energy;
  const enemy = agent.nearestTarget('sword');
  // v2.3.0：奇遇种子在瞬移范围内 → 可直取（跨熔岩取奇遇）
  const seed = world.encounterSeed;
  const seedClose = seed
    ? Math.abs(seed.x - st.position.x) + Math.abs(seed.y - st.position.y) <= 6
    : false;
  // v1.12.0：剑心境界愈高，愈擅施法（触发率加成）
  const castMult = MIND_CAST_MULT[st.mindRealm ?? 0] ?? 1;

  /** 情境：某半径（曼哈顿）内非血亲敌人数 */
  const countIn = (r: number): number => {
    let n = 0;
    for (const other of world.swords.values()) {
      if (other.state.id === st.id) continue;
      if (world.kinProtected() && world.isKin(agent, other)) continue;
      const d = Math.abs(other.state.position.x - st.position.x) + Math.abs(other.state.position.y - st.position.y);
      if (d <= r) n++;
    }
    return n;
  };

  let best: { s: SwordSkill; score: number } | null = null;
  for (const s of skills) {
    if (energy < s.energyCost) continue;
    // v2.4.0：独立冷却——各技能各算各的，不再被其他技能拖累
    if ((agent.skillCds?.[s.id] ?? 0) > 0) continue;
    let want = false;
    let bonus = 0; // 情境加成（情境越契合分越高）
    switch (s.kind) {
      case 'projectile':
      case 'line': {
        want = !!enemy && enemy.dist <= (s.range ?? 10);
        // 单体情境：范围内敌越少越偏向单体技；残血时换血收益低，让位保命
        if (want) {
          const n = countIn(s.range ?? 10);
          if (n === 1) bonus += 14;
          if (hpRatio < 0.3) bonus -= 4;
        }
        break;
      }
      case 'aoe': {
        want = !!enemy && enemy.dist <= (s.radius ?? 3);
        // 多目标情境：范围内敌越多越偏向范围技（加成足以压过同级单体、盖过一档等级差）
        if (want) {
          const n = countIn(s.radius ?? 3);
          if (n >= 3) bonus += 16;
          else if (n >= 2) bonus += 10;
        }
        break;
      }
      case 'heal': {
        want = hpRatio < 0.45;
        // 血越少越急——保命优先于输出
        if (want) {
          bonus += Math.round((0.45 - hpRatio) * 60);
          if (hpRatio < 0.25) bonus += 10;
        }
        break;
      }
      case 'teleport': {
        // v2.3.0：奇遇种子在瞬移范围内亦可施放（趋奇遇而遁形）
        want = hpRatio < 0.35 || (enemy !== null && enemy.dist <= 3) || seedClose;
        // 打不过先跑——残血时逃命优先于一切输出
        if (want && hpRatio < 0.25) bonus += 25;
        else if (want && enemy !== null && enemy.dist <= 3) bonus += 6;
        break;
      }
      case 'convert':
        want = energy > s.energyCost + 15 && hpRatio < 0.65;
        break;
      case 'buff': {
        // 有敌临近才施放，且不重复叠buff（频控保留 BUFF_CAST_CHANCE，防 buff 过期立刻重放）
        want =
          enemy !== null &&
          enemy.dist <= 8 &&
          !(st.buffAtkTicks ?? 0 > 0) &&
          !(st.buffDefTicks ?? 0 > 0) &&
          Math.random() < BUFF_CAST_CHANCE * castMult;
        if (want) bonus += 2;
        break;
      }
    }
    if (!want) continue;
    // 评分 = 等级优先级×10 + 情境加成 + 随机抖动（破平局）
    const score = skillTier(s) * 10 + bonus + Math.random() * 2;
    if (!best || score > best.score) best = { s, score };
  }
  if (!best) return false;
  const b = best.s;
  // v2.4.0：频率闸门——以「最高分技能」的概率放行：等级/情境越契合（分越高）越常施放；
  // 高等级技能 CD 长但出手更勤；buff 频控已内嵌 BUFF_CAST_CHANCE，不再二次摇奖
  if (b.kind !== 'buff') {
    const factor = Math.min(5, Math.max(0.5, best.score / 10));
    if (Math.random() >= b.castChance * castMult * factor) return false;
  }
  castSkill(agent, world, b, enemy);
  return true;
}

/** 技能结算 (enemy 为 tryCastSkill 预扫描结果，可复用避免重复全盘扫描) */
export function castSkill(
  agent: SwordAgent,
  world: World,
  s: SwordSkill,
  enemy?: { dx: number; dy: number; dist: number } | null,
): void {
  const st = agent.state;
  st.energy -= s.energyCost;
  const { x, y } = st.position;
  const color = st.genome.element;
  const dmgBase = Math.round(agent.effectiveSharpness());

  switch (s.kind) {
    case 'projectile': {
      const target = enemy ?? agent.nearestTarget('sword');
      // v2.2.1：垂直对齐目标 (dx=0) 时保留 0，仅 dx=dy=0 才回退 facing——原 Math.sign(0)||1 会把弹道打向 +x 打偏
      const dx = target ? (target.dx === 0 && target.dy === 0 ? (st.facing.x || 1) : Math.sign(target.dx)) : (st.facing.x || 1);
      const dy = target ? Math.sign(target.dy) : st.facing.y;
      hitLine(agent, world, dx, dy, s.range ?? 12, dmgBase * (s.dmgMult ?? 1.8), 0, !!s.pierce, s);
      eventBus.emit(EVT.SKILL, { kind: 'projectile', x, y, dx, dy, element: color, text: s.name, id: s.id });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意施展「${s.name}」，剑气横贯剑域！`);
      break;
    }
    case 'aoe': {
      const r = s.radius ?? 3;
      let hit = 0;
      for (const other of world.swords.values()) {
        if (other.state.id === st.id) continue;
        // v1.12.0：血亲不相攻——AoE 不伤同源一脉；v2.1.0 天劫期间血亲亦相争
        if (world.kinProtected() && world.isKin(agent, other)) continue;
        const d = Math.abs(other.state.position.x - x) + Math.abs(other.state.position.y - y);
        if (d <= r) {
          damageSword(agent, other, Math.round(dmgBase * (s.dmgMult ?? 1.5) * 0.8));
          // v2.3.0：控制/灼烧效果（地脉震减速、焚天爆灼烧等）
          applyCC(agent, world, other, s, {
            dx: other.state.position.x === x ? 0 : Math.sign(other.state.position.x - x),
            dy: other.state.position.y === y ? 0 : Math.sign(other.state.position.y - y),
          });
          if (s.affix === 'poison' && !(other.state.poisonTicks ?? 0 > 0)) {
            other.state.poisonDmg = 2;
            other.state.poisonTicks = 24;
          }
          hit++;
        }
      }
      // v2.4.0：焚天爆——余烬化火墙：自爆心向外扩散（半径 4-5），扫过之敌被灼烧后消散——不留地形、不困自身
      if (s.burnTicks) {
        for (const other of world.swords.values()) {
          if (other.state.id === st.id) continue;
          if (world.kinProtected() && world.isKin(agent, other)) continue;
          const d = Math.abs(other.state.position.x - x) + Math.abs(other.state.position.y - y);
          if (d > r && d <= FIRE_WALL_RADIUS) {
            applyCC(agent, world, other, s, {
              dx: other.state.position.x === x ? 0 : Math.sign(other.state.position.x - x),
              dy: other.state.position.y === y ? 0 : Math.sign(other.state.position.y - y),
            });
          }
        }
      }
      eventBus.emit(EVT.SKILL, { kind: 'aoe', x, y, radius: r, element: color, text: s.name, id: s.id });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意引爆「${s.name}」，波及${hit}柄剑意！`);
      break;
    }
    case 'line': {
      const target = enemy ?? agent.nearestTarget('sword');
      // v2.2.1：同 projectile——垂直对齐目标不再被 Math.sign(0)||1 打偏
      const dx = target ? (target.dx === 0 && target.dy === 0 ? (st.facing.x || 1) : Math.sign(target.dx)) : (st.facing.x || 1);
      const dy = target ? Math.sign(target.dy) : st.facing.y;
      hitLine(agent, world, dx, dy, s.range ?? 16, dmgBase * (s.dmgMult ?? 2), s.affix === 'parasite' ? 0.5 : 0, !!s.pierce, s);
      eventBus.emit(EVT.SKILL, { kind: 'line', x, y, dx, dy, element: color, text: s.name, id: s.id });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意使出「${s.name}」，天门洞开、直线贯穿！`);
      break;
    }
    case 'teleport': {
      // v2.3.0：奇遇种子在瞬移范围内 → 直取种子格（跨熔岩取奇遇）；否则随机空位
      let pos: { x: number; y: number } | null = null;
      const seed = world.encounterSeed;
      if (seed) {
        const sdist = Math.abs(seed.x - x) + Math.abs(seed.y - y);
        if (sdist <= 6 && !world.swordIdAt(seed.x, seed.y)) pos = { x: seed.x, y: seed.y };
      }
      if (!pos) pos = findTeleportSpot(world, x, y, 6);
      eventBus.emit(EVT.SKILL, { kind: 'teleport', x, y, element: color, text: s.name });
      if (pos) {
        // 若落于种子格，moveSword 内会自动 claimEncounterSeed（剑心境界 +1）
        world.moveSword(agent, pos.x, pos.y);
        eventBus.emit(EVT.SKILL, { kind: 'teleport', x: pos.x, y: pos.y, element: color, text: s.name });
        eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意身化「${s.name}」，瞬间移形换影！`);
      }
      break;
    }
    case 'heal':
    case 'convert': {
      const heal = Math.round(maxHpOf(st) * (s.healPct ?? 0.25));
      st.hp = Math.min(maxHpOf(st), st.hp + heal);
      if (s.buffAtk) { st.buffAtkMult = s.buffAtk; st.buffAtkTicks = s.buffTicks; }
      eventBus.emit(EVT.SKILL, { kind: 'heal', x, y, element: color, text: s.name });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意施展「${s.name}」，剑体回复${heal}点！`);
      break;
    }
    case 'buff': {
      if (s.buffDef) { st.buffDefMult = s.buffDef; st.buffDefTicks = s.buffTicks; }
      if (s.buffAtk) { st.buffAtkMult = s.buffAtk; st.buffAtkTicks = s.buffTicks; }
      // v2.3.0：机制差异化——反震（金罡体/百炼守）/ 免控（磐石护）/ 烈焰甲附火
      if (s.reflectPct) { st.reflectPct = s.reflectPct; st.reflectTicks = s.buffTicks; }
      if (s.immuneCC) st.immuneCCTicks = s.buffTicks;
      if (s.flameArmor) st.flameArmorTicks = s.buffTicks;
      eventBus.emit(EVT.SKILL, { kind: 'buff', x, y, element: color, text: s.name, id: s.id });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意凝神施展「${s.name}」，气势陡增！`);
      break;
    }
  }
  // v2.4.0：独立冷却——仅本技能进入冷却，不影响其他技能
  agent.skillCds[s.id] = s.cooldown;
}

/** 直线命中 (沿方向到射程，pierce 时贯穿全部目标)，返回命中数 */
function hitLine(
  agent: SwordAgent,
  world: World,
  dx: number,
  dy: number,
  range: number,
  dmg: number,
  lifesteal: number,
  pierce = false,
  s?: SwordSkill,
): number {
  const st = agent.state;
  let hit = 0;
  let x = st.position.x + dx;
  let y = st.position.y + dy;
  for (let i = 0; i < range; i++) {
    if (!world.inBounds(x, y)) break;
    const id = world.swordIdAt(x, y);
    if (id) {
      const other = world.swords.get(id);
      // v1.12.0：血亲不相攻——弹道/光束不伤同源一脉；v2.1.0 天劫期间血亲亦相争
      if (other && other.state.id !== st.id && (!world.kinProtected() || !world.isKin(agent, other))) {
        damageSword(agent, other, Math.round(dmg * (0.85 + Math.random() * 0.3)));
        // v2.3.0：控制/灼烧（青藤缚定身、惊涛斩击退等）
        if (s) applyCC(agent, world, other, s, { dx, dy });
        if (lifesteal > 0) {
          st.hp = Math.min(maxHpOf(st), st.hp + Math.round(dmg * lifesteal));
        }
        hit++;
        if (!pierce) break; // 非贯穿：只命中首个
      }
    }
    x += dx;
    y += dy;
  }
  return hit;
}

/** v2.3.0：技能控制效果落地（定身/减速/灼烧/击退；磐石护免控免疫） */
function applyCC(agent: SwordAgent, world: World, target: SwordAgent, s: SwordSkill, dir: { dx: number; dy: number }): void {
  if (!world.swords.has(target.state.id)) return; // 已被击杀（damageSword 已 die）→ 不再施加
  const st = target.state;
  if ((st.immuneCCTicks ?? 0) > 0) return; // 磐石护：泰山不动
  if (s.rootTicks) st.rootedTicks = Math.max(st.rootedTicks ?? 0, s.rootTicks);
  if (s.slowTicks) st.slowedTicks = Math.max(st.slowedTicks ?? 0, s.slowTicks);
  if (s.burnTicks) st.burningTicks = Math.max(st.burningTicks ?? 0, s.burnTicks);
  if (s.knockback) knockbackSword(world, target, dir, s.knockback);
}

/** 击退：沿方向推目标至多 N 格；被墙/剑意阻挡则止；击入熔岩 → 一步即死（v2.3.0） */
function knockbackSword(world: World, target: SwordAgent, dir: { dx: number; dy: number }, cells: number): void {
  const dx = dir.dx || 0;
  const dy = dir.dy || 0;
  if (dx === 0 && dy === 0) return;
  for (let i = 0; i < cells; i++) {
    const nx = target.state.position.x + dx;
    const ny = target.state.position.y + dy;
    // 熔岩可被击入（一击必杀）；墙/深水外的壁垒与剑意占位阻挡
    if (!world.inBounds(nx, ny) || (world.isWall(nx, ny) && !world.isLava(nx, ny)) || world.swordIdAt(nx, ny)) break;
    world.moveSword(target, nx, ny);
    if (world.isLava(nx, ny)) {
      target.die(); // 击退入熔岩：剑体崩解
      break;
    }
  }
}

/** 对敌造成伤害；若致其陨落，记入攻击方「击破」并触发尸身化食/以战养战/寄灵 (v1.12.0：与近战一致) */
function damageSword(attacker: SwordAgent, other: SwordAgent, dmg: number): void {
  other.state.hp -= Math.max(1, dmg);
  // v2.3.0：烈焰甲——技能命中亦附灼烧
  if ((attacker.state.flameArmorTicks ?? 0) > 0) {
    other.state.burningTicks = Math.max(other.state.burningTicks ?? 0, 40);
  }
  eventBus.emit(EVT.BATTLE_HIT, { x: other.state.position.x, y: other.state.position.y, element: other.state.genome.element, intensity: dmg });
  if (other.state.hp <= 0) {
    if (attacker && attacker.state.id !== other.state.id) {
      attacker.behavior.killCount++;
      const { x, y } = other.state.position;
      const corpseValue = Math.max(4, other.state.energy * 0.4);
      attacker.state.energy += other.state.energy * 0.5; // 以战养战，夺敌灵机
      attacker.state.hp = Math.min(maxHpOf(attacker.state), attacker.state.hp + Math.round(maxHpOf(attacker.state) * KILL_HEAL_PCT)); // v2.1.0 胜者回气 15% 上限
      // 寄灵：化敌为剑子（罕有能力，同近战路径）
      if (attacker.state.genome.affixes.includes('parasite') && Math.random() < 0.5) {
        const converted = attacker.world.spawnParasite(attacker, x, y);
        if (!converted) attacker.world.spawnCorpseFood(x, y, corpseValue);
      } else {
        attacker.world.spawnCorpseFood(x, y, corpseValue);
      }
    }
    other.die();
  }
}

/** 瞬移落点：随机方向若干格内的空位 (v2.3.0：熔岩/深水可渡——身化水光掠过凶地，是获取奇遇种子/穿越熔岩封锁的唯一常规手段) */
function findTeleportSpot(world: World, x: number, y: number, radius: number): { x: number; y: number } | null {
  // 首选普通空位（不落墙/剑意/食物）
  for (let attempt = 0; attempt < 24; attempt++) {
    const nx = x + randomInt(-radius, radius);
    const ny = y + randomInt(-radius, radius);
    if (world.inBounds(nx, ny) && !world.isWall(nx, ny) && !world.swordIdAt(nx, ny) && world.foodAt(nx, ny) === 0) {
      return { x: nx, y: ny };
    }
  }
  // 兜底：落于熔岩之上（渡凶地）；深水亦可（减速但安全）
  for (let attempt = 0; attempt < 16; attempt++) {
    const nx = x + randomInt(-radius, radius);
    const ny = y + randomInt(-radius, radius);
    if (world.inBounds(nx, ny) && world.isLava(nx, ny) && !world.swordIdAt(nx, ny)) {
      return { x: nx, y: ny };
    }
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const nx = x + randomInt(-radius, radius);
    const ny = y + randomInt(-radius, radius);
    if (world.inBounds(nx, ny) && world.isDeepWater(nx, ny) && !world.swordIdAt(nx, ny)) {
      return { x: nx, y: ny };
    }
  }
  return null;
}

/** buff 字段类型 (写入 SwordState) */
export type SwordBuffs = {
  buffAtkMult?: number;
  buffAtkTicks?: number;
  buffDefMult?: number;
  buffDefTicks?: number;
};

/** 推进 buff 计时 */
export function tickBuffs(st: { buffAtkTicks?: number; buffAtkMult?: number; buffDefTicks?: number; buffDefMult?: number }): void {
  if (st.buffAtkTicks !== undefined) {
    st.buffAtkTicks--;
    if (st.buffAtkTicks <= 0) { st.buffAtkMult = undefined; st.buffAtkTicks = undefined; }
  }
  if (st.buffDefTicks !== undefined) {
    st.buffDefTicks--;
    if (st.buffDefTicks <= 0) { st.buffDefMult = undefined; st.buffDefTicks = undefined; }
  }
}

/** v2.3.0：推进控制/灼烧/反震/免控/烈焰甲计时 (SwordState 全量字段) */
export function tickCombatStates(st: SwordState): void {
  if (st.reflectTicks !== undefined) {
    st.reflectTicks--;
    if (st.reflectTicks <= 0) { st.reflectPct = undefined; st.reflectTicks = undefined; }
  }
  if (st.immuneCCTicks !== undefined) {
    st.immuneCCTicks--;
    if (st.immuneCCTicks <= 0) st.immuneCCTicks = undefined;
  }
  if (st.flameArmorTicks !== undefined) {
    st.flameArmorTicks--;
    if (st.flameArmorTicks <= 0) st.flameArmorTicks = undefined;
  }
  if (st.rootedTicks !== undefined) {
    st.rootedTicks--;
    if (st.rootedTicks <= 0) st.rootedTicks = undefined;
  }
  if (st.slowedTicks !== undefined) {
    st.slowedTicks--;
    if (st.slowedTicks <= 0) st.slowedTicks = undefined;
  }
  if (st.burningTicks !== undefined) {
    st.burningTicks--;
    if (st.burningTicks <= 0) st.burningTicks = undefined;
  }
}
