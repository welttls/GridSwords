import type { Material, MaterialUnlock } from '../types';
import { UNLOCK_LABEL } from '../types';
import { MEGA_FOOD_COUNT } from '../constants';

/** 投入物数据库 (对应 SRD 3.7 解锁表；以道具次数使用，炉府属性随次数叠加) */
export const RECIPES: Material[] = [
  {
    id: 'cold_iron',
    name: '千年寒铁',
    unlock: 'start',
    description: '寒铁化金，庚金之气愈发丰沛。炉府庚金生成 +40%（可叠加）。',
    effect: { type: 'foodRegenRate', multiplier: 0.4 },
    count: 4,
  },
  {
    id: 'rootless_water',
    name: '无根水',
    unlock: 'start',
    description: '流水无形，炉府灵动。全体剑意身法 +0.5（可叠加）：每 tick 有几率额外行动一步，移动更迅疾。',
    effect: { type: 'allSpeedBonus', value: 0.5 },
    count: 3,
  },
  {
    id: 'wind_talisman',
    name: '御风符',
    unlock: 'start',
    description: '清风入炉，剑意御风而行，灵力消耗大幅降低。',
    effect: { type: 'temperature', value: 'breeze' },
    count: 3,
  },
  // ===== v2.3.0 布阵/奇遇系：与剑域地形/奇遇玩法深度联动（v2.6.0：奇遇改由炉材直接选位种下） =====
  {
    id: 'encounter_seed',
    name: '奇遇灵种',
    unlock: 'start', // v2.5.1：初始拥有直接解锁（种奇遇是核心乐趣）
    description: '灵种入域，机缘自现。使用后点击剑域自选位置种下，被剑意取得者剑心境界 +1；可自行以熔岩/深水封锁设下试炼。',
    effect: { type: 'encounterSeed' },
    count: 1,
  },
  {
    id: 'fast_sword',
    name: '《快剑总纲》残篇',
    unlock: 'beatFirstOpponent',
    description: '残篇记载剑势真意。此后分化时速度剑谱突变率大幅提升。',
    effect: { type: 'mutationBias', stat: 'speed', rateMult: 3 },
    count: 2,
  },
  {
    id: 'heavy_sword',
    name: '《重剑无锋诀》',
    unlock: 'rankTop10',
    description: '重剑无锋，大巧不工。此后分化时坚固剑谱突变率提升，速度突变率下降。',
    effect: { type: 'mutationBias', stat: 'toughness', rateMult: 3, sideEffect: 'speedDown' },
    count: 2,
  },
  {
    id: 'thunder_potion',
    name: '天雷',
    unlock: 'start', // v2.4.0：手动天雷直接解锁（玩家乐趣）；v2.6.0：每日 5 次，每日子时恢复
    description: '引天雷于指尖，每日可引 5 次（每日子时恢复）。使用后点击剑域任意处降下雷霆——闪电劈落、范围雷暴（半径 2 内剑意同受天雷：剑体-28、精元-12），可击杀剑意。',
    effect: { type: 'manualLightning' },
    count: 5,
  },
  {
    id: 'meteor_iron',
    name: '陨星铁母',
    unlock: 'rankFirst',
    description: '陨星坠落，化作超高灵力的天外真金，也激起剑意间杀伐。',
    effect: { type: 'megaFood', count: MEGA_FOOD_COUNT },
    count: 1,
  },
];

export function getMaterial(id: string): Material | undefined {
  return RECIPES.find((m) => m.id === id);
}

export function unlockLabel(u: MaterialUnlock): string {
  return UNLOCK_LABEL[u];
}

/** 排序：起始材料在前，其余按解锁难度 */
export function recipesSorted(): Material[] {
  const order: MaterialUnlock[] = ['start', 'firstCompletion', 'beatFirstOpponent', 'rankTop10', 'rankTop3', 'rankFirst'];
  return [...RECIPES].sort((a, b) => order.indexOf(a.unlock) - order.indexOf(b.unlock));
}
