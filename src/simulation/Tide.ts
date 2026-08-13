/**
 * v2.8.2：每日子时剑潮投放纯逻辑——由 Game.chooseDailyDrop 迁出。
 * 仅改世界状态（spawnWildSword），不触 Game 状态；日志 / 纪事 / 存档由调用方处理。
 */
import type { Genome } from '../types';
import type { World } from './World';
import { SimpleNN } from './NeuralNet';
import { randomMildGenome, randomWildGenome, randomFierceGenome } from './Genetics';
import { MIND_SKILL_POOLS } from './Skills';
import { mindSizes, NN_LAYERS, MAX_HP, ENERGY_SPLIT_THRESHOLD, MIND_MAX_BONUS } from '../constants';
import { randomInt } from '../utils/mathUtils';
import type { DailyDropKind } from '../ui/DayPanel';

export interface TideDropResult {
  spawned: number;
  label: string;
}

/** 按剑潮偏好投放游离剑意，返回实际落位数量与文案标签 */
export function dropDailyTide(world: World, kind: DailyDropKind, day: number): TideDropResult {
  const range = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
  let spawned = 0;
  let label = '默许天意';
  // v2.2.0：凶潮投洞玄（剑心 2 级）剑意——NN 用洞玄容量、上限随境界抬升、随机洞玄绝技，打破种群优势
  const spawnBatch = (n: number, make: () => Genome, opts?: { mindRealm?: number }) => {
    for (let i = 0; i < n; i++) {
      const realm = opts?.mindRealm ?? 0;
      const brain = new SimpleNN(realm > 0 ? mindSizes(realm) : NN_LAYERS);
      let mindSkillIds: string[] | undefined;
      if (realm > 0) {
        const pool = MIND_SKILL_POOLS[realm - 1] ?? [];
        if (pool.length > 0) mindSkillIds = [pool[randomInt(0, pool.length - 1)].id];
      }
      const maxHp = MAX_HP + MIND_MAX_BONUS * realm;
      const maxEnergy = ENERGY_SPLIT_THRESHOLD + MIND_MAX_BONUS * realm;
      if (world.spawnWildSword(make(), brain, { mindRealm: realm, maxHp, maxEnergy, mindSkillIds })) spawned++;
    }
  };
  switch (kind) {
    case 'mild':
      spawnBatch(range(2, 3), () => randomMildGenome(day));
      label = '温养之潮';
      break;
    case 'tide':
      spawnBatch(range(6, 8), () => randomWildGenome(day));
      label = '剑潮汹涌';
      break;
    case 'fierce':
      spawnBatch(range(2, 3), () => randomFierceGenome(day), { mindRealm: 2 }); // v2.2.0：凶潮投洞玄剑意
      label = '天外凶潮';
      break;
    case 'none':
      label = '静待天时';
      break;
    default: {
      const r = Math.random();
      if (r < 0.34) {
        spawnBatch(range(2, 3), () => randomMildGenome(day));
        label = '温养之潮';
      } else if (r < 0.67) {
        spawnBatch(range(6, 8), () => randomWildGenome(day));
        label = '剑潮汹涌';
      } else {
        // auto 默许天意：凶潮为普通凡心（洞玄凶剑只限玩家主动选「天外凶潮」，防无干预局被高境剑碾压致种群崩溃）
        spawnBatch(range(2, 3), () => randomFierceGenome(day));
        label = '天外凶潮';
      }
    }
  }
  return { spawned, label };
}
