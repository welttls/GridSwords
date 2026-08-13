/**
 * v2.8.2：万剑榜解锁 / 成就累计统计——由 Game.ts 迁出的纯逻辑。
 * 不触 UI（toast 由调用方处理）；applyUnlocks 返回新解锁材料名供调用方提示。
 */
import type { MaterialUnlock } from '../types';
import type { World } from '../simulation/World';
import type { GameStats } from './SaveManager';
import { RankingManager } from './RankingManager';
import { RECIPES } from './RecipeDB';

/** 排名解锁需榜单有一定规模，保持成长曲线 (3 柄名剑以上) */
export function computeRankUnlocks(
  rank: number,
  historyLength: number,
  unlocked: string[],
): MaterialUnlock[] {
  if (rank <= 0) return []; // P3：rank=0 (未上榜) 时不解锁，避免 evaluateUnlocks 误判 0<=10
  if (historyLength < 3) return [];
  return RankingManager.evaluateUnlocks(rank, unlocked);
}

/** 应用解锁：把新解锁材料写入 unlocked，返回新解锁材料名（供调用方 toast） */
export function applyUnlocks(unlocks: MaterialUnlock[], unlocked: string[]): string[] {
  const newly: string[] = [];
  for (const u of unlocks) {
    for (const m of RECIPES) {
      if (m.unlock === u && !unlocked.includes(m.id)) {
        unlocked.push(m.id);
        newly.push(m.name);
      }
    }
  }
  return newly;
}

/** 本局 Chronicle 累计进 save.stats（结算时调用一次） */
export function accumulateStats(stats: GameStats, world: World): void {
  const ev = world.chronicle.all();
  stats.totalRuns++;
  stats.totalKills += world.chronicle.count('kill');
  if (world.chronicle.count('emerge') > 0) stats.totalEmergences++;
  let lk = 0;
  for (const e of ev) if (e.kind === 'lightning') lk += e.data?.kills ?? 0;
  stats.totalLightningKills += lk;
}
