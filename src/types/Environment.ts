/** 世界/剑域配置 */
export interface WorldConfig {
  width: number;
  height: number;
  foodMax: number;
  foodRegenRate: number;   // 每 tick 生成概率
  currentDay: number;
  dayTickLimit: number;    // 每天 tick 数
  isShrinking: boolean;    // 第10天天劫收束
  shrinkTargetSpan: number;
  spawnFood: boolean;
}

/** 世界修正 (由每日投入的材料产生，持续至当日结束) */
export interface WorldModifiers {
  foodRegenMult: number;      // 庚金之气生成倍率
  speedBonus: number;         // 全体速度加成
  mutationBias: { stat: 'speed' | 'toughness'; rateMult: number; sideEffect?: 'speedDown' } | null;
  temperature: 'normal' | 'cold' | 'breeze';
  megaFood: boolean;          // 陨星铁母
  aggressionBonus: number;    // 攻击欲望加成
}
