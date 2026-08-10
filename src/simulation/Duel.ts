import type { Element, Genome } from '../types';

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

/** 一帧决斗事件 (MUD 文字 + 动画指令) */
export interface DuelEvent {
  text: string;
  kind: 'atk' | 'crit' | 'dodge' | 'counter' | 'poison' | 'heal' | 'guard' | 'recover' | 'drain' | 'info' | 'end';
  actor: DuelSideId;
  dmg?: number;
  /** 使用的招式名 (用于大字 + 前冲动画) */
  techName?: string;
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

/** 依据剑谱属性 + 词条自然生成招式 */
export function buildTechniques(genome: Genome, element: Element): DuelTechnique[] {
  const g = genome;
  const affixes = g.affixes ?? [];
  const list: DuelTechnique[] = [];
  const add = (t: DuelTechnique) => list.push(t);

  // —— 属性招式 ——
  if (g.sharpness >= 5) add({ id: 'break', name: '破军斩', desc: '以力破巧，势大力沉。', kind: 'heavy', dmgMult: 1.7, hits: 1, critBonus: 0.1, energyCost: 22, source: '锋锐' });
  if (g.speed >= 5) add({ id: 'dash', name: '疾风刺', desc: '身随剑走，连刺数剑。', kind: 'quick', dmgMult: 0.7, hits: 2, critBonus: 0, energyCost: 18, source: '速度' });
  if (g.perception >= 5) add({ id: 'insight', name: '洞幽斩', desc: '洞若观火，直击破绽。', kind: 'attack', dmgMult: 0.95, hits: 1, critBonus: 0.3, energyCost: 18, source: '感知' });
  if (g.toughness >= 5) add({ id: 'guard', name: '磐石守', desc: '守御蓄势，伺机反扑。', kind: 'guard', dmgMult: 0.6, hits: 1, critBonus: 0, energyCost: 20, heal: 6, guard: true, source: '坚韧' });
  if (g.aggression >= 0.6) add({ id: 'rage', name: '怒意斩', desc: '怒而拔剑，不守反攻。', kind: 'heavy', dmgMult: 1.5, hits: 1, critBonus: 0.15, energyCost: 20, selfDmg: 6, source: '杀性' });

  // —— 词条招式 ——
  if (affixes.includes('kill5')) add({ id: 'kill', name: '斩念诀', desc: '斩断杂念，一剑定音。', kind: 'heavy', dmgMult: 2.1, hits: 1, critBonus: 0.15, energyCost: 26, source: '斩念成性' });
  if (affixes.includes('fight15')) add({ id: 'hundred', name: '百炼守', desc: '百炼成钢，不动如山。', kind: 'guard', dmgMult: 0.5, hits: 1, critBonus: 0, energyCost: 22, heal: 16, guard: true, source: '百炼之体' });
  if (affixes.includes('roam400')) add({ id: 'roam', name: '游龙步', desc: '游历万方，身法如龙。', kind: 'quick', dmgMult: 0.62, hits: 3, critBonus: 0.12, energyCost: 20, source: '游历万方' });
  if (affixes.includes('eat30')) add({ id: 'eat', name: '吞金术', desc: '吞纳庚金，气力大复。', kind: 'recover', dmgMult: 0.3, hits: 1, critBonus: 0, energyCost: 0, heal: 10, recoverEnergy: 28, source: '吞金成性' });
  if (affixes.includes('poison')) add({ id: 'poison', name: '淬毒剑', desc: '剑上淬毒，蚀骨销魂。', kind: 'poison', dmgMult: 0.85, hits: 1, critBonus: 0.05, energyCost: 22, poisonTicks: 4, poisonDmg: 4, source: '淬毒' });
  if (affixes.includes('parasite')) add({ id: 'parasite', name: '寄灵夺舍', desc: '夺敌灵机，反哺己身。', kind: 'drain', dmgMult: 1.0, hits: 1, critBonus: 0.1, energyCost: 22, drain: true, source: '寄灵' });

  // 无词条时仅保留最多 2 个属性招 + 基础招 = 3 招通用 (预设)
  if (affixes.length === 0) list.length = Math.min(list.length, 2);

  // 通用基础招
  const base: DuelTechnique = { id: 'strike', name: '锋行', desc: '凝神一剑，直取中路。', kind: 'attack', dmgMult: 1.0, hits: 1, critBonus: 0, energyCost: 12, source: '本能' };

  // 优先词条招式，最多 4 个
  const AFFIX_SOURCES = ['斩念成性', '百炼之体', '游历万方', '吞金成性', '淬毒', '寄灵'];
  const affixTechs = list.filter((t) => AFFIX_SOURCES.includes(t.source));
  const statTechs = list.filter((t) => !AFFIX_SOURCES.includes(t.source));
  const ordered = [base, ...affixTechs, ...statTechs];
  return ordered.slice(0, 4);
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
    let total = 0;
    let crit = false;
    let dodged = false;

    const cost = a.art === 'quick' ? Math.ceil(tech.energyCost * 0.7) : tech.energyCost;
    if (a.energy >= cost) a.energy -= cost;

    for (let h = 0; h < tech.hits; h++) {
      let dodge = this.clamp((d.speed - a.speed) * 0.05, 0, 0.3);
      if (d.art === 'agile') dodge += 0.12;
      if (dodge > 0 && Math.random() < dodge) {
        dodged = true;
        continue;
      }
      const raw = Math.max(2, (a.sharp - d.tough * 0.4) * 3);
      let dmg = Math.round(raw * tech.dmgMult * rand(0.85, 1.2));
      const critChance = tech.critBonus + this.clamp(a.perc * 0.035, 0, 0.3);
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

    let text: string;
    if (dodged && total === 0) {
      text = `${a.name}施展「${techName}」，${d.name}身法如电，堪堪避过！`;
    } else {
      const opener = pick(OPENERS[a.element] ?? OPENERS.metal);
      const hit = pick(HIT_LINES);
      text = `${a.name}${opener}，使出「${techName}」${hit}，对${d.name}造成 ${total} 点剑伤！`;
      if (crit) text = `⚡ 剑意通神！${a.name}「${techName}」${pick(CRIT_LINES)}，对${d.name}造成 ${total} 点剑伤！`;
    }
    let kind: DuelEvent['kind'] = crit ? 'crit' : 'atk';

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
    if (tech.heal) {
      a.hp = Math.min(a.maxHp, a.hp + tech.heal);
      text += ` ${a.name}凝神回气，剑体回复 ${tech.heal} 点。`;
      kind = 'heal';
    }
    if (tech.recoverEnergy) {
      a.energy = Math.min(a.maxEnergy, a.energy + tech.recoverEnergy);
      text += ` ${a.name}吞纳灵气，精元回复 ${tech.recoverEnergy} 点。`;
      kind = 'recover';
    }
    if (tech.guard) {
      a.guarded = true;
      text += ` ${a.name}剑势内敛，严阵以待（下次受击大幅减免）。`;
      kind = 'guard';
    }

    this.checkDeath(d, ev);
    ev.push({ text, kind, actor: a.side, dmg: total, techName });
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
