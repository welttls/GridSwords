import type { Element, Genome } from '../types';
import { ELEMENT_LABEL } from './Genetics';

export type DuelSideId = 'player' | 'npc';

/** 一帧决斗事件 (MUD 文字) */
export interface DuelEvent {
  text: string;
  kind: 'info' | 'atk' | 'crit' | 'dodge' | 'counter' | 'poison' | 'heal' | 'thunder' | 'end';
  actor: DuelSideId;
  dmg?: number;
}

export interface DuelCombatantConfig {
  name: string;
  element: Element;
  genome: Genome;
  /** 剑诀 id (仅玩家) */
  art?: string;
  /** 额外先手行动值 */
  apAdvance?: number;
}

/** 决斗者内部状态 */
interface Fighter {
  side: DuelSideId;
  name: string;
  element: Element;
  art?: string;
  affixes: string[];
  // 有效属性 (含词条加成)
  sharp: number;
  tough: number;
  speed: number;
  perc: number;
  aggr: number;
  strat: number;
  // 状态
  hp: number;
  energy: number;
  ap: number;
  poison: number;
  poisonDmg: number;
}

const MAX_HP = 100;
const MAX_ENERGY = 100;
const ACT_COST = 20;

/**
 * 宗门大比 · 半即时制决斗 (headless 可测)。
 * - 速度决定行动频率：每 tick 蓄行动值 AP = 1 + 速度×0.5，AP 满 20 即出手，速度快者先手。
 * - 所有剑技以文字 MUD 描述，效果与属性 (锋锐/坚韧/速度/感知/杀性/策略)、词条、剑诀相关。
 */
export class Duel {
  p: Fighter;
  n: Fighter;
  tick = 0;
  over = false;
  winner: DuelSideId | null = null;
  /** 最近一帧产生的事件 */
  events: DuelEvent[] = [];

  constructor(pc: DuelCombatantConfig, nc: DuelCombatantConfig) {
    this.p = this.makeFighter('player', pc);
    this.n = this.makeFighter('npc', nc);
    if (this.p.art === 'strike') this.p.ap += ACT_COST * 0.5; // 抢攻剑诀：先手
    if (nc.art === 'strike') this.n.ap += ACT_COST * 0.5;
    this.p.ap += pc.apAdvance ?? 0;
    this.n.ap += nc.apAdvance ?? 0;
  }

  private makeFighter(side: DuelSideId, c: DuelCombatantConfig): Fighter {
    const g = c.genome;
    const affixes = g.affixes ?? [];
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
      hp: MAX_HP,
      energy: MAX_ENERGY,
      ap: 0,
      poison: 0,
      poisonDmg: 0,
    };
  }

  private apGain(f: Fighter): number {
    return 1 + f.speed * 0.35;
  }

  private clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  /** 推进一帧：蓄气 → 毒发 → 依 AP 出手 */
  step(): DuelEvent[] {
    if (this.over) return [];
    this.tick++;
    const ev: DuelEvent[] = [];

    for (const f of [this.p, this.n]) {
      f.ap += this.apGain(f);
      const regen = 0.7 * (f.affixes.includes('eat30') ? 1.35 : 1);
      f.energy = Math.min(MAX_ENERGY, f.energy + regen);
      if (f.poison > 0) {
        f.hp -= f.poisonDmg;
        ev.push({ text: `☠ ${f.name}淬毒入体，剑体溃烂 -${f.poisonDmg}。`, kind: 'poison', actor: f.side, dmg: f.poisonDmg });
        f.poison--;
        if (this.checkDeath(f, ev)) return ev;
      }
    }

    let guard = 0;
    while (!this.over && guard++ < 8) {
      const pReady = this.p.ap >= ACT_COST;
      const nReady = this.n.ap >= ACT_COST;
      if (!pReady && !nReady) break;
      const actor = pReady && nReady ? (this.p.ap >= this.n.ap ? this.p : this.n) : pReady ? this.p : this.n;
      actor.ap -= ACT_COST;
      const e = this.act(actor, actor === this.p ? this.n : this.p);
      ev.push(e);
      if (this.over) break;
    }

    // 时间耗尽 → 比剑体
    if (!this.over && this.tick >= 600) {
      this.over = true;
      const pRatio = this.p.hp - this.n.hp;
      this.winner = pRatio >= 0 ? 'player' : 'npc';
      const w = this.winner === 'player' ? this.p : this.n;
      const l = this.winner === 'player' ? this.n : this.p;
      ev.push({ text: `百招已过，${w.name}剑体犹存 (${Math.max(0, Math.round(w.hp))} vs ${Math.max(0, Math.round(l.hp))})，判${w.name}胜！`, kind: 'end', actor: this.winner });
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
      ev.push({ text: `${f.name}剑体崩解，剑意陨落！\u2014— ${w.name} 胜！`, kind: 'end', actor: this.winner });
      return true;
    }
    return false;
  }

  /** 出手：一次剑技结算 */
  private act(a: Fighter, d: Fighter): DuelEvent {
    const aEl = ELEMENT_LABEL[a.element];
    // 闪避：速度压制 + 游斗剑诀
    let dodge = this.clamp((d.speed - a.speed) * 0.04, 0, 0.28);
    if (d.art === 'agile') dodge += 0.15;
    if (dodge > 0 && Math.random() < dodge) {
      return { text: `${d.name}身法如电，${a.name}一剑落空。`, kind: 'dodge', actor: a.side };
    }

    // 气力
    let cost = a.art === 'quick' ? 3 : 4;
    let weak = false;
    if (a.energy < cost) {
      weak = true; // 力竭：仍出剑但势弱
      a.energy = 0;
    } else {
      a.energy -= cost;
    }

    // 基础伤害 (决斗倍率 ×5，短促凌厉)
    let dmg = Math.max(2, Math.round((a.sharp - d.tough * 0.5) * 5 * (0.85 + Math.random() * 0.3)));
    if (weak) dmg = Math.max(1, Math.round(dmg * 0.6));
    let crit = false;
    const critChance = this.clamp(a.perc * 0.03, 0, 0.35) + (a.art === 'thunder' ? 0.12 : 0);
    if (Math.random() < critChance) {
      crit = true;
      dmg = Math.round(dmg * 1.5);
    }
    // 快剑：速度压制连击
    let combo = false;
    if ((a.art === 'quick' || a.speed - d.speed >= 2) && Math.random() < 0.3) {
      combo = true;
      dmg = Math.round(dmg * 1.3);
    }
    // 孤狼：破釜沉舟
    if (a.strat <= 0.3 && Math.random() < 0.4) dmg = Math.round(dmg * 1.2);
    // 雷引：天雷加持
    let thunder = false;
    if (a.art === 'thunder' && Math.random() < 0.2) {
      thunder = true;
      dmg = Math.round(dmg * 1.6);
    }

    d.hp -= dmg;
    let kind: DuelEvent['kind'] = crit ? 'crit' : 'atk';
    let text = `${a.name}${this.atkOpener(a, d, thunder)}，对${d.name}造成 ${dmg} 点剑伤！`;
    if (weak) text = `${a.name}力不从心，剑势走弱，只对${d.name}造成 ${dmg} 点剑伤！`;
    if (crit) text = `⚡ ${a.name}剑意通神，会心一击！对${d.name}造成 ${dmg} 点剑伤！`;
    if (combo) text = `${a.name}身法如电、剑势连绵，追风连击共 ${dmg} 点剑伤！`;
    if (thunder) {
      kind = 'thunder';
      text = `⚡ 雷引剑诀引动天雷，${a.name}一剑裹雷，对${d.name}造成 ${dmg} 点剑伤！`;
    }

    // 淬毒 (决斗尺度)
    if (a.affixes.includes('poison') && d.poison === 0 && Math.random() < 0.4) {
      d.poison = 4;
      d.poisonDmg = 3;
      text += ` ☠ 淬毒入体，${d.name}剑体将溃烂四息！`;
    }
    // 寄灵：夺灵续命
    if (a.affixes.includes('parasite') && Math.random() < 0.3) {
      const heal = Math.min(24, Math.round(dmg * 0.35));
      a.hp = Math.min(MAX_HP, a.hp + heal);
      text += ` 寄灵夺舍，${a.name}反噬对方灵机，剑体回复 ${heal} 点！`;
      kind = 'heal';
    }
    // 后发制人：反击 (反击剑诀 / 高杀性)
    const counterChance = (d.art === 'counter' ? 0.3 : 0) + (d.aggr >= 0.7 ? 0.12 : 0);
    if (!this.over && Math.random() < counterChance) {
      const cdmg = Math.max(2, Math.round((d.sharp - a.tough * 0.5) * 3));
      a.hp -= cdmg;
      text += ` ${d.name}后发制人，反击 ${cdmg} 点剑伤！`;
      kind = 'counter';
    }

    this.checkDeath(d, []);
    return { text, kind, actor: a.side, dmg };
  }

  /** 五行/属性联动的攻击起手描述 */
  private atkOpener(a: Fighter, d: Fighter, thunder: boolean): string {
    const openers: Record<string, string> = {
      metal: '剑光如霜，直刺而来',
      wood: '剑气如藤，蜿蜒缠绕',
      water: '剑势如潮，连绵不绝',
      fire: '烈焰焚空，剑出如火',
      earth: '重剑无锋，大巧不工',
    };
    let s = openers[a.element] ?? '剑意凌厉';
    if (thunder) s = '剑引天雷，紫电环绕';
    else if (a.strat <= 0.3 && Math.random() < 0.3) s = '孤狼一剑，破釜沉舟';
    else if (a.speed - d.speed >= 3 && Math.random() < 0.3) s = '身形一晃，先发而至';
    return s;
  }
}
