import type { World } from './World';
import type { SwordAgent } from './SwordAgent';
import type { Element, Genome } from '../types';
import { MAX_HP, BUFF_CAST_CHANCE, MIND_CAST_MULT, KILL_HEAL_PCT } from '../constants';
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
      desc: '庚金凝甲，剑体坚不可摧。',
      energyCost: 14, cooldown: 260, castChance: 0.03, buffDef: 1.2, buffTicks: 240,
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
      desc: '青藤缠身，缚敌于数步之外。',
      energyCost: 16, cooldown: 240, castChance: 0.04, range: 10, dmgMult: 1.2,
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
      desc: '剑化惊涛，一线横卷。',
      energyCost: 20, cooldown: 280, castChance: 0.03, range: 16, dmgMult: 1.8,
    },
  ],
  fire: [
    {
      id: 'skill_eruption', name: '焚天爆', kind: 'aoe', element: 'fire',
      desc: '引燃周身灵气爆散，重创方圆之敌。',
      energyCost: 22, cooldown: 300, castChance: 0.02, radius: 3, dmgMult: 1.5,
    },
    {
      id: 'skill_blaze', name: '烈焰甲', kind: 'buff', element: 'fire',
      desc: '烈焰缠身，攻势暴涨。',
      energyCost: 14, cooldown: 240, castChance: 0.03, buffAtk: 1.25, buffTicks: 220,
    },
  ],
  earth: [
    {
      id: 'skill_bulwark', name: '磐石护', kind: 'buff', element: 'earth',
      desc: '厚土凝甲，剑体坚不可摧。',
      energyCost: 15, cooldown: 300, castChance: 0.05, buffDef: 1, buffTicks: 240,
    },
    {
      id: 'skill_quake', name: '地脉震', kind: 'aoe', element: 'earth',
      desc: '地脉震动，方圆皆震。',
      energyCost: 20, cooldown: 280, castChance: 0.03, radius: 3, dmgMult: 1.4,
    },
  ],
};

/** 每行主天赋技能 (旧引用兼容) */
export const ELEMENT_SKILLS: Record<Element, SwordSkill> = {
  metal: ELEMENT_TALENTS.metal[0],
  wood: ELEMENT_TALENTS.wood[0],
  water: ELEMENT_TALENTS.water[0],
  fire: ELEMENT_TALENTS.fire[0],
  earth: ELEMENT_TALENTS.earth[0],
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
    desc: '百炼成钢，固守之势。',
    energyCost: 15, cooldown: 280, castChance: 0.05, buffDef: 1.5, buffTicks: 260,
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
    desc: '剑气冲霄，方圆皆定——大范围之敌尽受重创。',
    energyCost: 28, cooldown: 360, castChance: 0.02, radius: 5, dmgMult: 1.5,
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

/** 触发技能 (headless 结算 + 渲染事件) */
export function tryCastSkill(agent: SwordAgent, world: World, skills: SwordSkill[]): boolean {
  const st = agent.state;
  const hpRatio = st.hp / MAX_HP;
  const energy = st.energy;
  const enemy = agent.nearestTarget('sword');
  // v1.12.0：剑心境界愈高，愈擅施法（触发率加成）
  const castMult = MIND_CAST_MULT[st.mindRealm ?? 0] ?? 1;

  for (const s of skills) {
    if (energy < s.energyCost) continue;
    let want = false;
    switch (s.kind) {
      case 'projectile':
      case 'line':
        want = !!enemy && enemy.dist <= (s.range ?? 10) && Math.random() < s.castChance * castMult;
        break;
      case 'aoe':
        want = !!enemy && enemy.dist <= (s.radius ?? 3) && Math.random() < s.castChance * castMult;
        break;
      case 'heal':
        want = hpRatio < 0.45 && Math.random() < s.castChance * castMult;
        break;
      case 'teleport':
        want = (hpRatio < 0.35 || (enemy !== null && enemy.dist <= 3)) && Math.random() < s.castChance * castMult;
        break;
      case 'convert':
        want = energy > s.energyCost + 15 && hpRatio < 0.65 && Math.random() < s.castChance * castMult;
        break;
      case 'buff':
        // 有敌临近才施放，且不重复叠buff
        want =
          enemy !== null &&
          enemy.dist <= 8 &&
          !(st.buffAtkTicks ?? 0 > 0) &&
          !(st.buffDefTicks ?? 0 > 0) &&
          Math.random() < BUFF_CAST_CHANCE * castMult;
        break;
    }
    if (!want) continue;
    castSkill(agent, world, s, enemy);
    return true;
  }
  return false;
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
      const dx = target ? Math.sign(target.dx) || 1 : (st.facing.x || 1);
      const dy = target ? Math.sign(target.dy) : st.facing.y;
      hitLine(agent, world, dx, dy, s.range ?? 12, dmgBase * (s.dmgMult ?? 1.8), 0, !!s.pierce);
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
          if (s.affix === 'poison' && !(other.state.poisonTicks ?? 0 > 0)) {
            other.state.poisonDmg = 2;
            other.state.poisonTicks = 24;
          }
          hit++;
        }
      }
      eventBus.emit(EVT.SKILL, { kind: 'aoe', x, y, radius: r, element: color, text: s.name, id: s.id });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意引爆「${s.name}」，波及${hit}柄剑意！`);
      break;
    }
    case 'line': {
      const target = enemy ?? agent.nearestTarget('sword');
      const dx = target ? Math.sign(target.dx) || 1 : (st.facing.x || 1);
      const dy = target ? Math.sign(target.dy) : st.facing.y;
      const total = hitLine(agent, world, dx, dy, s.range ?? 16, dmgBase * (s.dmgMult ?? 2), s.affix === 'parasite' ? 0.5 : 0, !!s.pierce);
      eventBus.emit(EVT.SKILL, { kind: 'line', x, y, dx, dy, element: color, text: s.name, id: s.id });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意使出「${s.name}」，天门洞开、直线贯穿！`);
      break;
    }
    case 'teleport': {
      const pos = findTeleportSpot(world, x, y, 6);
      eventBus.emit(EVT.SKILL, { kind: 'teleport', x, y, element: color, text: s.name });
      if (pos) {
        world.moveSword(agent, pos.x, pos.y);
        eventBus.emit(EVT.SKILL, { kind: 'teleport', x: pos.x, y: pos.y, element: color, text: s.name });
        eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意身化「${s.name}」，瞬间移形换影！`);
      }
      break;
    }
    case 'heal':
    case 'convert': {
      const heal = Math.round(MAX_HP * (s.healPct ?? 0.25));
      st.hp = Math.min(MAX_HP, st.hp + heal);
      if (s.buffAtk) { st.buffAtkMult = s.buffAtk; st.buffAtkTicks = s.buffTicks; }
      eventBus.emit(EVT.SKILL, { kind: 'heal', x, y, element: color, text: s.name });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意施展「${s.name}」，剑体回复${heal}点！`);
      break;
    }
    case 'buff': {
      if (s.buffDef) { st.buffDefMult = s.buffDef; st.buffDefTicks = s.buffTicks; }
      if (s.buffAtk) { st.buffAtkMult = s.buffAtk; st.buffAtkTicks = s.buffTicks; }
      eventBus.emit(EVT.SKILL, { kind: 'buff', x, y, element: color, text: s.name, id: s.id });
      eventBus.emit(EVT.LOG, `第${world.config.currentDay}日：一道剑意凝神施展「${s.name}」，气势陡增！`);
      break;
    }
  }
  // 冷却
  (agent as unknown as { skillCd: number }).skillCd = s.cooldown;
}

/** 直线命中 (沿方向到射程，pierce 时贯穿全部目标)，返回命中数 */
function hitLine(agent: SwordAgent, world: World, dx: number, dy: number, range: number, dmg: number, lifesteal: number, pierce = false): number {
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
        if (lifesteal > 0) {
          st.hp = Math.min(MAX_HP, st.hp + Math.round(dmg * lifesteal));
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

/** 对敌造成伤害；若致其陨落，记入攻击方「击破」并触发尸身化食/以战养战/寄灵 (v1.12.0：与近战一致) */
function damageSword(attacker: SwordAgent, other: SwordAgent, dmg: number): void {
  other.state.hp -= Math.max(1, dmg);
  eventBus.emit(EVT.BATTLE_HIT, { x: other.state.position.x, y: other.state.position.y, element: other.state.genome.element, intensity: dmg });
  if (other.state.hp <= 0) {
    if (attacker && attacker.state.id !== other.state.id) {
      attacker.behavior.killCount++;
      const { x, y } = other.state.position;
      const corpseValue = Math.max(4, other.state.energy * 0.4);
      attacker.state.energy += other.state.energy * 0.5; // 以战养战，夺敌灵机
      attacker.state.hp = Math.min(MAX_HP, attacker.state.hp + Math.round(MAX_HP * KILL_HEAL_PCT)); // v2.1.0 胜者回气 15% 上限
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

/** 瞬移落点：随机方向若干格内的空位 */
function findTeleportSpot(world: World, x: number, y: number, radius: number): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 20; attempt++) {
    const nx = x + randomInt(-radius, radius);
    const ny = y + randomInt(-radius, radius);
    if (world.inBounds(nx, ny) && !world.isWall(nx, ny) && !world.swordIdAt(nx, ny) && world.foodAt(nx, ny) === 0) {
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

/** 计算伤害减免 (buffDef) */
export function damageReduction(buffDefMult?: number): number {
  return buffDefMult ? 1 / (1 + buffDefMult * 0.5) : 1;
}
