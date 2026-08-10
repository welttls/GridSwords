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
    id: 'fusang_spark',
    name: '扶桑火种',
    unlock: 'start',
    description: '火种迸溅，炉中生出一道道暂时性火墙，阻绝退路。',
    effect: { type: 'spawnFireWalls', count: 24 },
    count: 3,
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
  {
    id: 'sword_dust',
    name: '剑尘',
    unlock: 'firstCompletion',
    description: '前次炼剑的遗蜕。可在开局淬入剑胚，微量提升初始剑谱。',
    effect: { type: 'swordDust' },
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
    name: '雷劫液',
    unlock: 'rankTop3',
    description: '引动天雷灌入炼剑炉，唯有速度最快的剑意能在雷劫中存续。',
    effect: { type: 'thunderstorm' },
    count: 2,
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
