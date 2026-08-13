/**
 * v2.8.0：剑域地图（多地图 · 择剑域）——MapDef 定义表。
 *
 * 每张图 = 静态初始地形生成(genStatic) + 主题配色(theme) + 资源覆盖(resource)
 *         + 专属随机事件(event) + 五行相性(affinity)。
 * 解锁靠成就 id（unlockAchievementId；null = 默认恒可选）。
 * 只依赖 World 的类型与公共 API，可 headless。
 */

import type { World } from '../simulation/World';
import type { Element } from '../types';

export interface MapTheme {
  bg: number;        // 背景
  chaos: number;     // 天劫吞噬区
  wall: number;      // 火墙/障碍
  lava: number;      // 熔岩
  deepwater: number; // 深水
  food: number;      // 庚金之气
}

/** v2.8.0：地图五行相性——某行剑意在本域的永久修正（增益/受制，全局生效） */
export interface ElementAffinity {
  /** 相性名（如「地火共鸣」「炎域煎灼」） */
  label: string;
  /** 攻伐加成（伤害公式四维；负 = 受制） */
  atkBonus?: number;
  /** 杀性加成（负 = 受制） */
  aggressionBonus?: number;
  /** 精元消耗倍率（>1 = 耗神加剧） */
  costMult?: number;
  /** 剑体回复倍率（<1 = 回血受阻） */
  regenMult?: number;
  /** 采食回能倍率（>1 = 食之更补） */
  energyGainMult?: number;
}

export interface MapEvent {
  /** 每 tick 触发概率（触发后进入冷却） */
  perTickChance: number;
  /** 触发冷却（tick；0 = 无冷却） */
  cooldownTicks: number;
  /** 触发回调：修改世界并返回日志文本（headless 安全，禁触 DOM） */
  onTrigger: (world: World) => string;
}

export interface MapDef {
  id: string;
  name: string;
  /** 择剑域卡片大字（如 荒/焰/寒）——视觉快速辨识 */
  char: string;
  desc: string;
  /** 解锁成就 id；null = 默认恒可选 */
  unlockAchievementId: string | null;
  theme: MapTheme;
  /** 五行相性（无 = 诸行平等） */
  affinity?: Partial<Record<Element, ElementAffinity>>;
  /** 资源覆盖（缺省沿用默认数值） */
  resource?: { foodMax?: number; foodRegenRate?: number; initialFood?: number };
  /** 静态初始地形生成（须避开中心出生区，保证剑意可存活） */
  genStatic?: (world: World) => void;
  /** 专属随机事件 */
  event?: MapEvent;
}

/** 默认剑域（荒域）——当前游戏的原始状态 */
const WASTELAND_THEME: MapTheme = {
  bg: 0x0c1017,
  chaos: 0x1c0f18,
  wall: 0xff5a2a,
  lava: 0xff4a12,
  deepwater: 0x1a5a9a,
  food: 0xffd76a,
};

/** 熔岩炼狱（解锁：地形大师）——暗红灼底，辨识度强于荒域 */
const LAVA_REALM_THEME: MapTheme = {
  bg: 0x1f0b05,
  chaos: 0x220f08,
  wall: 0xff6a3a,
  lava: 0xff5a1f,
  deepwater: 0x2a4a7a,
  food: 0xffb347,
};

/** 寒潭幽谷（解锁：雷劫余生）——深靛寒底 */
const COLD_POOL_THEME: MapTheme = {
  bg: 0x0a1a2c,
  chaos: 0x071019,
  wall: 0x4a7ab0,
  lava: 0xff4a12,
  deepwater: 0x1a7a9a,
  food: 0xc8e6ff,
};

/** [min,max] 闭区间随机整数 */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 撒斑块地形：数量 count 个，每块半径 radius（曼哈顿）、填充概率 fill，
 * 避开中心 keep 边长的正方形出生区，也不落于边界 1 格内。返回实际放置格数。
 */
function scatterPatches(
  world: World,
  type: 'lava' | 'deepwater',
  count: number,
  radius: number,
  fill: number,
  keep: number,
): number {
  const { width, height } = world.config;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  let placed = 0;
  for (let p = 0; p < count; p++) {
    // 斑块中心随机，避开中心 keep×keep 出生区与边界
    const x = randInt(2, width - 3);
    const y = randInt(2, height - 3);
    if (Math.abs(x - cx) < keep && Math.abs(y - cy) < keep) continue;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        if (Math.abs(px - cx) < keep && Math.abs(py - cy) < keep) continue;
        if (Math.random() >= fill) continue;
        world.setTerrain(px, py, type);
        placed++;
      }
    }
  }
  return placed;
}

/** 熔岩炼狱：开局自带熔岩斑块（剑意一步踏入即死；斑块小而分散，不阻断连通） */
function genLavaRealm(world: World): void {
  scatterPatches(world, 'lava', 8, 1, 0.7, 3);
}

/** 寒潭幽谷：开局自带深水潭（可通行，减速耗神） */
function genColdPool(world: World): void {
  scatterPatches(world, 'deepwater', 7, 2, 0.8, 3);
}

/** 临时地形事件通用：在随机空地铺一圈 type（durationTicks 后自动消退），避开剑意占位。返回放置格数。 */
function eruptTerrain(
  world: World,
  type: 'lava' | 'deepwater',
  attempts: number,
  radius: number,
  fill: number,
  durationTicks: number,
): number {
  const { width, height } = world.config;
  let placed = 0;
  for (let i = 0; i < attempts; i++) {
    const ox = randInt(1, width - 2);
    const oy = randInt(1, height - 2);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = ox + dx;
        const py = oy + dy;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        if (world.isWall(px, py)) continue;        // 已有墙/熔岩不再覆盖
        if (world.terrainAt(px, py)) continue;     // 已有地形不再覆盖
        if (world.swordIdAt(px, py)) continue;     // 剑意占位不覆盖（防原地瞬死）
        if (Math.random() >= fill) continue;
        world.setTerrain(px, py, type, durationTicks);
        placed++;
      }
    }
  }
  return placed;
}

/** 地图定义表 */
export const MAPS: MapDef[] = [
  {
    id: 'wasteland',
    name: '荒域',
    char: '荒',
    desc: '寂寥旷野，庚金之气稀薄而均匀。剑意从零开始，随你布霖、布阵而各显其道。诸行平等，各凭造化。',
    unlockAchievementId: null,
    theme: WASTELAND_THEME,
  },
  {
    id: 'lava_realm',
    name: '熔岩炼狱',
    char: '焰',
    desc: '赤地千里，熔岩斑驳横陈。灼热之地步步杀机，却也淬炼出更凶的剑意；地火会不时喷涌。火行如鱼得水，水行备受煎熬。',
    unlockAchievementId: 'terrain_master', // 地形大师：一局熔岩吞噬五敌
    theme: LAVA_REALM_THEME,
    affinity: {
      fire: { label: '地火共鸣', atkBonus: 1, aggressionBonus: 0.08 },
      water: { label: '炎域煎灼', costMult: 1.25, regenMult: 0.6 },
      metal: { label: '金销于焰', atkBonus: -1 },
      wood: { label: '薪火添势', energyGainMult: 1.1 },
    },
    genStatic: genLavaRealm,
    event: {
      perTickChance: 0.0015,
      cooldownTicks: 480, // 半日——平均每半日~一日随机触发一次
      onTrigger: (world) => {
        const n = eruptTerrain(world, 'lava', 1, 1, 0.65, 300);
        return n > 0
          ? '地火喷涌——剑域某处岩层迸裂，赤浆漫溢，化作一片短时熔岩！'
          : '地火喷涌，却又倏然沉寂，未及成势。';
      },
    },
  },
  {
    id: 'cold_pool',
    name: '寒潭幽谷',
    char: '寒',
    desc: '幽谷深潭，寒水浸骨。深水虽可通行却滞剑意身形、耗其精元；寒潮会不时涌起。水行如鱼得水，火行深受其制。',
    unlockAchievementId: 'thunder_lived', // 雷劫余生：历天雷而不灭者炼成本命剑
    theme: COLD_POOL_THEME,
    affinity: {
      water: { label: '如鱼得水', regenMult: 1.25, energyGainMult: 1.15 },
      fire: { label: '寒潭冽冽', atkBonus: -1, aggressionBonus: -0.08 },
      wood: { label: '寒潭润木', regenMult: 1.2 },
      metal: { label: '金生丽水', costMult: 0.95 },
    },
    genStatic: genColdPool,
    event: {
      perTickChance: 0.0015,
      cooldownTicks: 480,
      onTrigger: (world) => {
        const n = eruptTerrain(world, 'deepwater', 2, 1, 0.7, 480);
        return n > 0
          ? '寒潮涌起——幽谷深处寒气翻腾，几处洼地漫成新潭！'
          : '寒潮掠过幽谷，只在石间留下些许水汽。';
      },
    },
  },
];

export const DEFAULT_MAP_ID = 'wasteland';

const MAP_BY_ID = new Map(MAPS.map((m) => [m.id, m]));

/** 取地图定义；未知 id 回退默认荒域 */
export function getMap(id?: string | null): MapDef {
  return (id && MAP_BY_ID.get(id)) || MAPS[0];
}
