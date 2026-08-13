/** 解锁条件 */
export type MaterialUnlock =
  | 'start'
  | 'firstCompletion'
  | 'beatFirstOpponent'
  | 'rankTop10'
  | 'rankTop3'
  | 'rankFirst';

/** 投入物效果描述 */
export type MaterialEffect =
  | { type: 'foodRegenRate'; multiplier: number }
  | { type: 'allSpeedBonus'; value: number }
  | { type: 'temperature'; value: 'cold' | 'breeze' }
  | { type: 'mutationBias'; stat: 'speed' | 'toughness'; rateMult: number; sideEffect?: 'speedDown' }
  | { type: 'megaFood'; count: number }
  // v2.6.0：奇遇灵种——炉材直接武装选位种下 + 手动天雷
  | { type: 'encounterSeed' }
  | { type: 'manualLightning' };

/** 投入物 (材料)：以道具次数使用，改变整个炼剑炉的属性 */
export interface Material {
  id: string;
  name: string;
  description: string;
  unlock: MaterialUnlock;
  effect: MaterialEffect;
  /** 每局可用次数（「天雷」为每日次数，每日子时恢复） */
  count: number;
}

/** 解锁条件的中文描述 */
export const UNLOCK_LABEL: Record<MaterialUnlock, string> = {
  start: '初始拥有',
  firstCompletion: '首次完成炼剑',
  beatFirstOpponent: '击败第一名对手',
  rankTop10: '万剑榜前10',
  rankTop3: '万剑榜前3',
  rankFirst: '万剑榜第1',
};
