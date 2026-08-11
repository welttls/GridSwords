import type { MaterialUnlock, RankedSword } from '../types';

export interface RankResult {
  /** 1 基排名 */
  rank: number;
  newUnlocks: MaterialUnlock[];
  inTop: boolean;
  /** 排序截断后的新榜单 (TOP_N) */
  list: RankedSword[];
}

/**
 * 万剑榜 (本地版，可扩展在线)。
 * 从历史剑意中取最高分排序，展示前 20 名。
 */
export class RankingManager {
  static readonly TOP_N = 20;

  /** 计算一条名剑的解锁进度 */
  static evaluateUnlocks(rank: number, unlocked: string[]): MaterialUnlock[] {
    const news: MaterialUnlock[] = [];
    if (rank <= 10 && !unlocked.includes('rankTop10')) news.push('rankTop10');
    if (rank <= 3 && !unlocked.includes('rankTop3')) news.push('rankTop3');
    if (rank === 1 && !unlocked.includes('rankFirst')) news.push('rankFirst');
    return news;
  }

  /** 将新名剑插入榜单，返回排名与新增解锁 */
  static submit(
    sword: RankedSword,
    history: RankedSword[],
    unlocked: string[],
  ): RankResult {
    // v2.2.1：按 id 去重，防同剑重复上榜（当前 uid 唯一未触发，纯防御）
    const list = [...history.filter((h) => h.id !== sword.id), sword]
      .sort((a, b) => b.score - a.score || b.dayReached - a.dayReached)
      .slice(0, RankingManager.TOP_N);
    const rank = list.findIndex((s) => s.id === sword.id) + 1;
    const inTop = rank > 0;
    const newUnlocks = inTop ? RankingManager.evaluateUnlocks(rank, unlocked) : [];
    return { rank, newUnlocks, inTop, list };
  }
}
