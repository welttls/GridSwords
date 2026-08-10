import type { Element, Genome } from '../types';
import { ELEMENT_SKILLS, AFFIX_SKILLS } from './Skills';
import type { SwordSkill } from './Skills';
import { ELEMENT_LABEL } from './Genetics';
import { affixName } from '../data/AffixDB';

export type DuelSideId = 'player' | 'npc';

/** 招式 (由属性/词条自然生成) */
export interface DuelTechnique {
  id: string;
  name: string;
  desc: string;
  kind: 'attack' | 'heavy' | 'quick' | 'poison' | 'drain' | 'guard' | 'recover';
  dmgMult: number;
  hits: number;
  critBonus: number;
  energyCost: number;
  heal?: number;
  poisonTicks?: number;
  poisonDmg?: number;
  drain?: boolean;
  guard?: boolean;
  selfDmg?: number;
  recoverEnergy?: number;
  /** 来源说明 (属性/词条) */
  source: string;
}

/** 招式特效 (技能专属动画) */
export type DuelFx =
  | 'slash'    // 剑气斩：弧光弹道
  | 'beam'     // 天门破：贯穿光束
  | 'blast'    // 焚天爆：爆炸冲击
  | 'drain'    // 寄灵噬：吸血
  | 'poison'   // 淬毒雨：毒雾
  | 'heal'     // 回春术/吞金燃灵：回复光
  | 'shield'   // 磐石护/百炼守：护盾
  | 'dash'     // 瞬水步/游龙步/疾风刺：残影
  | 'heavy'    // 重击：冲击波
  | 'strike';  // 普攻

/** 一帧决斗事件 (MUD 文字 + 动画指令) */
export interface DuelEvent {
  text: string;
  kind: 'atk' | 'crit' | 'dodge' | 'counter' | 'poison' | 'heal' | 'guard' | 'recover' | 'drain' | 'info' | 'end';
  actor: DuelSideId;
  dmg?: number;
  /** 使用的招式名 (用于大字 + 前冲动画) */
  techName?: string;
  /** 招式特效类型 (技能专属动画) */
  fx?: DuelFx;
}

export interface DuelCombatantConfig {
  name: string;
  element: Element;
  genome: Genome;
  /** 剑诀 id (仅玩家) */
  art?: string;
}

/** 决斗者内部状态 */
interface Fighter {
  side: DuelSideId;
  name: string;
  element: Element;
  art?: string;
  affixes: string[];
  sharp: number;
  tough: number;
  speed: number;
  perc: number;
  aggr: number;
  strat: number;
  hp: number;
  /** 剑体上限：随坚韧增减 (70 + 坚韧×8) */
  maxHp: number;
  energy: number;
  maxEnergy: number;
  ap: number;
  poison: number;
  poisonDmg: number;
  guarded: boolean;
}

const ACT_COST = 100;
const MAX_ENERGY = 100;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** 剑意技能 → 大比招式 (与野外剑技同源同效果) */
function skillToTechnique(s: SwordSkill, maxHp: number): DuelTechnique {
  const src = s.element ? `${ELEMENT_LABEL[s.element]}行天赋` : `「${affixName(s.affix ?? '')}」`;
  const base = { id: s.id, name: s.name, desc: s.desc, source: src };
  switch (s.kind) {
    case 'projectile':
      return { ...base, kind: 'attack', dmgMult: s.dmgMult ?? 1.8, hits: 1, critBonus: 0.1, energyCost: s.energyCost };
    case 'line':
      return { ...base, kind: 'heavy', dmgMult: s.dmgMult ?? 2, hits: 1, critBonus: 0.15, energyCost: s.energyCost, drain: s.affix === 'parasite' };
    case 'aoe':
      return { ...base, kind: 'heavy', dmgMult: s.dmgMult ?? 1.5, hits: 1, critBonus: 0.05, energyCost: s.energyCost, poisonTicks: s.affix === 'poison' ? 4 : undefined, poisonDmg: 4 };
    case 'heal':
      return { ...base, kind: 'recover', dmgMult: 0.3, hits: 1, critBonus: 0, energyCost: s.energyCost, heal: Math.round(maxHp * (s.healPct ?? 0.3)) };
    case 'teleport':
      return { ...base, kind: 'quick', dmgMult: 0.9, hits: 1, critBonus: 0.2, energyCost: s.energyCost };
    case 'convert':
      return { ...base, kind: 'recover', dmgMult: 0.3, hits: 1, critBonus: 0, energyCost: s.energyCost, heal: Math.round(maxHp * (s.healPct ?? 0.25)), recoverEnergy: 25 };
    case 'buff':
      if (s.buffAtk) return { ...base, kind: 'quick', dmgMult: 0.7, hits: 2, critBonus: 0.1, energyCost: s.energyCost };
      return { ...base, kind: 'guard', dmgMult: 0.6, hits: 1, critBonus: 0, energyCost: s.energyCost, heal: (s.buffDef ?? 0) >= 1.5 ? 16 : 6, guard: true };
  }
}

/** 依据剑谱属性 + 词条自然生成招式 (含五行天赋剑技) */
export function buildTechniques(genome: Genome, element: Element): DuelTechnique[] {
  const g = genome;
  const affixes = g.affixes ?? [];
  const maxHp = Math.round(70 + g.toughness * 8);

  // —— 五行天赋剑技 (此剑意天生剑技，必得) ——
  const elementTech = skillToTechnique(ELEMENT_SKILLS[element], maxHp);

  // —— 属性招式 (按属性门槛自然生成) ——
  const statTechs: DuelTechnique[] = [];
  if (g.sharpness >= 5) statTechs.push({ id: 'break', name: '破军斩', desc: '以力破巧，势大力沉。', kind: 'heavy', dmgMult: 1.7, hits: 1, critBonus: 0.1, energyCost: 22, source: '锋锐' });
  if (g.speed >= 5) statTechs.push({ id: 'dash', name: '疾风刺', desc: '身随剑走，连刺数剑。', kind: 'quick', dmgMult: 0.7, hits: 2, critBonus: 0, energyCost: 18, source: '速度' });
  if (g.perception >= 5) statTechs.push({ id: 'insight', name: '洞幽斩', desc: '洞若观火，直击破绽。', kind: 'attack', dmgMult: 0.95, hits: 1, critBonus: 0.3, energyCost: 18, source: '感知' });
  if (g.toughness >= 5) statTechs.push({ id: 'guard', name: '磐石守', desc: '守御蓄势，伺机反扑。', kind: 'guard', dmgMult: 0.6, hits: 1, critBonus: 0, energyCost: 20, heal: 6, guard: true, source: '坚韧' });
  if (g.aggression >= 0.6) statTechs.push({ id: 'rage', name: '怒意斩', desc: '怒而拔剑，不守反攻。', kind: 'heavy', dmgMult: 1.5, hits: 1, critBonus: 0.15, energyCost: 20, selfDmg: 6, source: '杀性' });

  // —— 词条剑技 (与野外剑意技能同源) ——
  const affixTechs: DuelTechnique[] = [];
  for (const a of affixes) {
    const s = AFFIX_SKILLS[a];
    if (s) affixTechs.push(skillToTechnique(s, maxHp));
  }

  // 通用基础招
  const base: DuelTechnique = { id: 'strike', name: '锋行', desc: '凝神一剑，直取中路。', kind: 'attack', dmgMult: 1.0, hits: 1, critBonus: 0, energyCost: 12, source: '本能' };

  // 组成：基础 + 五行天赋 + 词条(优先) + 属性(补位)，最多 4 招
  const ordered = [base, elementTech, ...affixTechs, ...statTechs];
  return ordered.slice(0, 4);
}

/** 招式 → 特效类型 (技能 id 优先，kind 兜底) */
const FX_BY_ID: Record<string, DuelFx> = {
  skill_swordqi: 'slash',
  skill_eruption: 'blast',
  skill_breach: 'beam',
  skill_parasite: 'drain',
  skill_poisonrain: 'poison',
  skill_regrowth: 'heal',
  skill_convert: 'heal',
  skill_bulwark: 'shield',
  skill_hundred: 'shield',
  skill_blink: 'dash',
  skill_roam: 'dash',
};
export function techFx(tech: DuelTechnique): DuelFx {
  if (tech.id in FX_BY_ID) return FX_BY_ID[tech.id];
  switch (tech.kind) {
    case 'quick': return 'dash';
    case 'heavy': return 'heavy';
    case 'poison': return 'poison';
    case 'drain': return 'drain';
    case 'guard': return 'shield';
    case 'recover': return 'heal';
    default: return 'strike';
  }
}

/**
 * 宗门大比 · 半即时决斗 (ATB：速度蓄条，玩家满条选招，NPC 自动)。
 * 剑体上限随坚韧增减；伤害控制在约 10 回合内定胜负。
 */
export class Duel {
  p: Fighter;
  n: Fighter;
  tick = 0;
  over = false;
  winner: DuelSideId | null = null;
  /** 玩家行动条已满，等待选择招式 */
  pNeedsChoice = false;
  events: DuelEvent[] = [];

  constructor(pc: DuelCombatantConfig, nc: DuelCombatantConfig) {
    this.p = this.makeFighter('player', pc);
    this.n = this.makeFighter('npc', nc);
    if (pc.art === 'strike') this.p.ap += ACT_COST * 0.5;
  }

  private makeFighter(side: DuelSideId, c: DuelCombatantConfig): Fighter {
    const g = c.genome;
    const affixes = g.affixes ?? [];
    const maxHp = Math.round(70 + g.toughness * 8);
    return {
      side,
      name: c.name,
      element: c.element,
      art: c.art,
      affixes,
      sharp: g.sharpness + (affixes.includes('kill5') ? 1.5 : 0),
      tough: g.toughness + (affixes.includes('fight15') ? 1.5 : 0),
      speed: g.speed,
      perc: g.perception + (affixes.includes('roam400') ? 2 : 0),
      aggr: g.aggression,
      strat: g.strategy,
      hp: maxHp,
      maxHp,
      energy: MAX_ENERGY,
      maxEnergy: MAX_ENERGY,
      ap: 0,
      poison: 0,
      poisonDmg: 0,
      guarded: false,
    };
  }

  private apGain(f: Fighter): number {
    return 0.5 + f.speed * 0.32;
  }

  private clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  /** 玩家可选招式 */
  playerTechniques(): DuelTechnique[] {
    const g = this.p;
    return buildTechniques(
      { sharpness: g.sharp, toughness: g.tough, speed: g.speed, perception: g.perc, aggression: g.aggr, strategy: g.strat, element: g.element, affixes: g.affixes },
      g.element,
    );
  }

  /** 推进一帧 (NPC 行动；玩家满条则挂起等选招) */
  step(): DuelEvent[] {
    if (this.over) return [];
    this.tick++;
    const ev: DuelEvent[] = [];

    for (const f of [this.p, this.n]) {
      f.ap += this.apGain(f);
      const regen = 0.9 * (f.affixes.includes('eat30') ? 1.4 : 1);
      f.energy = Math.min(f.maxEnergy, f.energy + regen);
      if (f.poison > 0) {
        f.hp -= f.poisonDmg;
        ev.push({ text: `☠ ${f.name}淬毒入体，剑体溃烂 -${f.poisonDmg}。`, kind: 'poison', actor: f.side, dmg: f.poisonDmg });
        f.poison--;
        if (this.checkDeath(f, ev)) return ev;
      }
    }

    // 玩家满条 → 挂起等待选择
    if (this.p.ap >= ACT_COST) {
      this.p.ap = ACT_COST;
      this.pNeedsChoice = true;
      ev.push({ text: '行动条已满，请选择招式！', kind: 'info', actor: 'player' });
      this.events = ev;
      return ev;
    }

    // NPC 满条 → 自动出手
    if (this.n.ap >= ACT_COST) {
      this.n.ap -= ACT_COST;
      ev.push(...this.act(this.n, this.p, this.npcChoose(this.n)));
      if (this.over) {
        this.events = ev;
        return ev;
      }
    }

    // 时间耗尽 → 比剑体
    if (!this.over && this.tick >= 600) {
      this.over = true;
      this.winner = this.p.hp >= this.n.hp ? 'player' : 'npc';
      const w = this.winner === 'player' ? this.p : this.n;
      const l = this.winner === 'player' ? this.n : this.p;
      ev.push({ text: `百招已过，${w.name}剑体犹存 (${Math.max(0, Math.round(w.hp))} vs ${Math.max(0, Math.round(l.hp))})，判${w.name}胜！`, kind: 'end', actor: this.winner });
    }

    this.events = ev;
    return ev;
  }

  /** 玩家选择招式并出手 (此后若 NPC 已满条则立即自动出手) */
  playerChoose(techId: string): DuelEvent[] {
    if (!this.pNeedsChoice) return [];
    this.pNeedsChoice = false;
    this.p.ap = 0;
    const techs = this.playerTechniques();
    const tech = techs.find((t) => t.id === techId) ?? techs[0];
    const ev = this.act(this.p, this.n, tech);
    if (this.over) {
      this.events = ev;
      return ev;
    }
    if (this.n.ap >= ACT_COST) {
      this.n.ap -= ACT_COST;
      ev.push(...this.act(this.n, this.p, this.npcChoose(this.n)));
    }
    this.events = ev;
    return ev;
  }

  private checkDeath(f: Fighter, ev: DuelEvent[]): boolean {
    if (f.hp <= 0) {
      f.hp = 0;
      this.over = true;
      this.winner = f.side === 'player' ? 'npc' : 'player';
      const w = this.winner === 'player' ? this.p : this.n;
      ev.push({ text: `${f.name}剑体崩解，剑意陨落！—— ${w.name} 胜！`, kind: 'end', actor: this.winner });
      return true;
    }
    return false;
  }

  /** NPC 自动选招：低血回复 / 低精元回气 / 否则最高伤害 */
  private npcChoose(f: Fighter): DuelTechnique {
    const techs = buildTechniques(
      { sharpness: f.sharp, toughness: f.tough, speed: f.speed, perception: f.perc, aggression: f.aggr, strategy: f.strat, element: f.element, affixes: f.affixes },
      f.element,
    );
    const usable = techs.filter((t) => t.energyCost <= f.energy || t.energyCost === 0);
    const list = usable.length ? usable : techs;
    if (f.hp / f.maxHp < 0.3) {
      const heal = list.find((t) => t.heal);
      if (heal) return heal;
    }
    if (f.energy < 20) {
      const rec = list.find((t) => t.recoverEnergy);
      if (rec) return rec;
    }
    return [...list].sort((a, b) => b.dmgMult * b.hits - a.dmgMult * a.hits)[0];
  }

  /** 一次出招结算 (含终结事件) */
  private act(a: Fighter, d: Fighter, tech: DuelTechnique): DuelEvent[] {
    const ev: DuelEvent[] = [];
    const techName = tech.name;
    const fx = techFx(tech);
    // 回复/护盾类为辅助招式：不造成伤害，只增益自身
    const isSupport = tech.kind === 'recover' || tech.kind === 'guard';
    let total = 0;
    let crit = false;
    let dodged = false;

    const cost = a.art === 'quick' ? Math.ceil(tech.energyCost * 0.7) : tech.energyCost;
    if (a.energy >= cost) a.energy -= cost;

    if (!isSupport) {
      for (let h = 0; h < tech.hits; h++) {
        // 闪避：两边比感知，差值决定闪避率 (感知高者易避来剑)
        let dodge = this.clamp((d.perc - a.perc) * 0.06 + 0.08, 0.05, 0.45);
        if (d.art === 'agile') dodge += 0.12;
        dodge = this.clamp(dodge, 0, 0.45); // 游斗加成后仍不超上限
        if (dodge > 0 && Math.random() < dodge) {
          dodged = true;
          continue;
        }
        const raw = Math.max(2, (a.sharp - d.tough * 0.4) * 3);
        let dmg = Math.round(raw * tech.dmgMult * rand(0.85, 1.2));
        // 暴击：锋锐 + 杀性驱动 (凶悍之剑易出重创)
        const critChance = tech.critBonus + this.clamp(a.sharp * 0.02 + a.aggr * 0.15, 0, 0.4);
        if (Math.random() < critChance) {
          crit = true;
          dmg = Math.round(dmg * 1.5);
        }
        if (d.guarded) {
          dmg = Math.max(1, Math.round(dmg * 0.45));
          d.guarded = false;
        }
        if (tech.selfDmg) a.hp -= tech.selfDmg;
        d.hp -= dmg;
        total += dmg;
      }
    }

    // —— 文本 ——
    let text: string;
    let kind: DuelEvent['kind'];
    if (isSupport) {
      const parts: string[] = [];
      if (tech.heal) parts.push(`剑体回复 ${tech.heal} 点`);
      if (tech.recoverEnergy) parts.push(`精元回复 ${tech.recoverEnergy} 点`);
      if (tech.guard) parts.push('剑势内敛，严阵以待');
      text = `${a.name}施展「${techName}」${parts.length ? '，' + parts.join('，') : ''}。`;
      kind = tech.guard ? 'guard' : tech.heal ? 'heal' : 'recover';
    } else if (dodged && total === 0) {
      text = `${a.name}施展「${techName}」，${d.name}灵觉入微，堪堪避过！`;
      kind = 'dodge';
    } else {
      const opener = pick(OPENERS[a.element] ?? OPENERS.metal);
      const hit = pick(HIT_LINES);
      text = `${a.name}${opener}，使出「${techName}」${hit}，对${d.name}造成 ${total} 点剑伤！`;
      if (crit) text = `⚡ 剑意通神！${a.name}「${techName}」${pick(CRIT_LINES)}，对${d.name}造成 ${total} 点剑伤！`;
      kind = crit ? 'crit' : 'atk';
    }

    // —— 效果：攻击类附加效果 ——
    if (tech.poisonTicks && d.poison === 0) {
      d.poison = tech.poisonTicks;
      d.poisonDmg = tech.poisonDmg ?? 4;
      text += ` ☠ 淬毒入体，${d.name}剑体将溃烂！`;
      kind = 'poison';
    }
    if (tech.drain && total > 0) {
      const gained = Math.round(total * 0.5);
      a.hp = Math.min(a.maxHp, a.hp + gained);
      text += ` 寄灵夺舍，反噬${d.name}灵机，剑体回复 ${gained} 点！`;
      kind = 'drain';
    }
    // —— 效果：回复/护盾 (文本已在 support 分支构造) ——
    if (tech.heal) a.hp = Math.min(a.maxHp, a.hp + tech.heal);
    if (tech.recoverEnergy) a.energy = Math.min(a.maxEnergy, a.energy + tech.recoverEnergy);
    if (tech.guard) a.guarded = true;

    this.checkDeath(d, ev);
    ev.push({ text, kind, actor: a.side, dmg: total, techName, fx });
    return ev;
  }
}

/** 五行起手 */
const OPENERS: Record<string, string[]> = {
  metal: ['剑光如霜，凌空而起', '金戈铁马，寒芒乍现', '冷锋过处，金石为开'],
  wood: ['剑气如藤，蜿蜒缠杀', '青木生发，剑走偏锋', '万木回春，一剑成林'],
  water: ['剑势如潮，绵绵不绝', '水天一色，剑若游龙', '惊涛拍岸，剑气纵横'],
  fire: ['烈焰焚空，剑出如火', '焚天煮海，一剑燎原', '火舌吞吐，剑气如虹'],
  earth: ['重剑无锋，大巧不工', '山岳巍峨，一剑千钧', '厚土载物，剑意沉雄'],
};

const HIT_LINES = ['疾斩而下', '当头劈落', '横削而至', '直刺要害', '旋身挥出'];
const CRIT_LINES = ['直破命门', '一击中的', '洞穿剑体', '斩入经脉'];
