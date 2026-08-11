import type { SwordState } from '../types';
import { MAX_HP, ENERGY_SPLIT_THRESHOLD } from '../constants';

/**
 * 剑体上限 (v2.2.0)：剑心升级 +50/境后叠加；缺省为 MAX_HP(100)。
 */
export function maxHpOf(s: Pick<SwordState, 'maxHp'>): number {
  return s.maxHp ?? MAX_HP;
}

/**
 * 精元上限 (v2.2.0)：剑心升级 +50/境后叠加；缺省为 ENERGY_SPLIT_THRESHOLD(80)。
 * 分化阈值随上限同步提高——剑心愈高，愈能蓄积精元。
 */
export function maxEnergyOf(s: Pick<SwordState, 'maxEnergy'>): number {
  return s.maxEnergy ?? ENERGY_SPLIT_THRESHOLD;
}
