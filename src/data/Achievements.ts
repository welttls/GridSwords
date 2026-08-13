/**
 * v2.5.0：成就系统——定义玩家「玩出了什么风格」，而非「打了多少局」。
 *
 * 判定数据源全部来自 Chronicle 事件统计 + save.stats（累计）+ 现有存档字段，无需额外埋点。
 * 与现有规则冲突的成就一律不入表（灭门惨案 / 五行逆转 / 师慈徒孝）。
 */

import type { SwordState } from '../types';
import type { World } from '../simulation/World';
import type { GameSave } from './SaveManager';

export type AchievementCategory = 'narrative' | 'operation' | 'emergence' | 'cumulative';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  category: AchievementCategory;
  evaluate: (ctx: AchievementCtx, save: GameSave) => boolean;
}

/** 成就判定上下文（结算时由 Game 组装） */
export interface AchievementCtx {
  world: World | null;
  /** 本命剑（败局为 null） */
  champion: SwordState | null;
  score: number | null;
  /** 万剑榜名次（0=未上榜） */
  rank: number;
}

const c = (ctx: AchievementCtx): { world: World; ev: World['chronicle'] } | null => {
  if (!ctx.world) return null;
  return { world: ctx.world, ev: ctx.world.chronicle };
};

export const ACHIEVEMENTS: Achievement[] = [
  // —— 叙事型 ——
  {
    id: 'lone_sword',
    name: '孤勇者',
    desc: '一柄孤剑走完十日——本命剑全程未衍一子。',
    category: 'narrative',
    evaluate: (ctx) => {
      if (!ctx.champion || !ctx.world) return false;
      if (ctx.champion.origin !== 'seed') return false;
      return ![...ctx.world.lineage.values()].some((v) => v.parentId === ctx.champion!.id);
    },
  },
  {
    id: 'tribulation_kin',
    name: '天劫血亲',
    desc: '天劫之下血亲亦相残——见证同源一脉刀剑相向。',
    category: 'narrative',
    evaluate: (ctx) => {
      const r = c(ctx);
      return !!r && r.ev.count('kill', (e) => !!e.data?.kin) > 0;
    },
  },
  {
    id: 'thunder_lived',
    name: '雷劫余生',
    desc: '历天雷而不灭——雷劫余生者炼成本命剑。',
    category: 'narrative',
    evaluate: (ctx) => !!ctx.champion && !!ctx.champion.survivedThunder,
  },

  // —— 运营型 ——
  {
    id: 'zero_material',
    name: '一毛不拔',
    desc: '不借炉材外力，炼成通明境以上的本命剑。',
    category: 'operation',
    evaluate: (ctx) => {
      const r = c(ctx);
      return !!ctx.champion && !!r && r.ev.count('material') === 0 && (ctx.champion.mindRealm ?? 0) >= 1;
    },
  },
  {
    id: 'god_of_thunder',
    name: '雷神降世',
    desc: '一局之内，以「天雷」引落雷霆击杀十敌。',
    category: 'operation',
    evaluate: (ctx) => {
      const r = c(ctx);
      if (!r) return false;
      let k = 0;
      for (const e of r.ev.all()) if (e.kind === 'lightning') k += e.data?.kills ?? 0;
      return k >= 10;
    },
  },
  {
    id: 'terrain_master',
    name: '地形大师',
    desc: '熔岩吞噬五敌——善用地形者，兵不血刃。',
    category: 'operation',
    evaluate: (ctx) => {
      const r = c(ctx);
      return !!r && r.ev.count('death', (e) => e.data?.cause === 'lava') >= 5;
    },
  },
  {
    id: 'all_materials',
    name: '物尽其用',
    desc: '一局之内用遍八种炉材。',
    category: 'operation',
    evaluate: (ctx) => {
      const r = c(ctx);
      if (!r) return false;
      const used = new Set<string>();
      for (const e of r.ev.all()) if (e.kind === 'material' && e.data?.id) used.add(e.data.id as string);
      return used.size >= 8;
    },
  },
  {
    id: 'rain_bless',
    name: '普降甘霖',
    desc: '一局之内布霖百团庚金之气。',
    category: 'operation',
    evaluate: (ctx) => {
      const r = c(ctx);
      if (!r) return false;
      let f = 0;
      for (const e of r.ev.all()) if (e.kind === 'feed') f += e.data?.count ?? 0;
      return f >= 100;
    },
  },

  // —— 涌现型 ——
  {
    id: 'heaven_will',
    name: '天意自成',
    desc: '不加任何干预（布霖/炉材/布阵/天雷/重种），剑意自成气候。',
    category: 'emergence',
    evaluate: (ctx) => {
      const r = c(ctx);
      if (!r) return false;
      return (
        r.ev.count('emerge') > 0 &&
        r.ev.count('material') === 0 &&
        r.ev.count('feed') === 0 &&
        r.ev.count('formation') === 0 &&
        r.ev.count('lightning') === 0 &&
        r.ev.count('reseed') === 0
      );
    },
  },
  {
    id: 'parasite_king',
    name: '寄生之王',
    desc: '一局之内寄灵化敌为剑子，三度夺舍。',
    category: 'emergence',
    evaluate: (ctx) => {
      const r = c(ctx);
      return !!r && r.ev.count('birth', (e) => e.data?.via === 'parasite') >= 3;
    },
  },
  {
    id: 'poison_reaper',
    name: '毒噬群雄',
    desc: '一局之内毒毙五敌——毒道之威，闻者辟易。',
    category: 'emergence',
    evaluate: (ctx) => {
      const r = c(ctx);
      return !!r && r.ev.count('death', (e) => e.data?.cause === 'poison') >= 5;
    },
  },

  // —— 累计型 ——
  {
    id: 'iron_100',
    name: '百炼成钢',
    desc: '累计完成十局炼剑（成败皆算）。',
    category: 'cumulative',
    evaluate: (_ctx, save) => save.stats.totalRuns >= 10,
  },
  {
    id: 'sword_king',
    name: '万剑之王',
    desc: '炼成之剑登临万剑榜榜首。',
    category: 'cumulative',
    evaluate: (ctx) => ctx.rank === 1,
  },
  {
    id: 'dao_echo',
    name: '道韵常存',
    desc: '累计见证三次「涌现」。',
    category: 'cumulative',
    evaluate: (_ctx, save) => save.stats.totalEmergences >= 3,
  },
];

export const ACHIEVEMENTS_BY_CATEGORY: { key: AchievementCategory; label: string }[] = [
  { key: 'narrative', label: '叙事' },
  { key: 'operation', label: '运营' },
  { key: 'emergence', label: '涌现' },
  { key: 'cumulative', label: '累计' },
];

/**
 * v2.8.2：结算时评估全部未解锁成就（由 Game.checkAchievements 迁出的纯逻辑）。
 * 命中即写入 save.achievements，返回新解锁的成就 id（toast/存档由调用方处理）。
 */
export function evaluateNewAchievements(save: GameSave, ctx: AchievementCtx): string[] {
  const newly: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (save.achievements.includes(a.id)) continue;
    if (!a.evaluate(ctx, save)) continue;
    save.achievements.push(a.id);
    newly.push(a.id);
  }
  return newly;
}
