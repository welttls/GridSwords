import type { Element, Genome } from '../types';
import { GENE_MIN, GENE_MAX, ELEMENT_MUTATION_RATE } from '../constants';
import { clamp, gaussianRandom, pickRandom } from '../utils/mathUtils';

const ELEMENTS: Element[] = ['metal', 'wood', 'water', 'fire', 'earth'];

/** 五行基础色 (渲染用) */
export const ELEMENT_COLOR: Record<Element, number> = {
  metal: 0xd8dee9,
  wood: 0x7ddb8f,
  water: 0x5aa9ff,
  fire: 0xff6a4a,
  earth: 0xd0a86a,
};

/** 五行中文名 */
export const ELEMENT_LABEL: Record<Element, string> = {
  metal: '金',
  wood: '木',
  water: '水',
  fire: '火',
  earth: '土',
};

/** 五行说明 */
export const ELEMENT_DESC: Record<Element, string> = {
  metal: '速度极快、攻伐中上，好战如风',
  wood: '五维均衡，性情温和，生生不息',
  water: '感知过人、灵动缥缈，料敌机先',
  fire: '攻伐最高、杀性最强，嗜战追杀',
  earth: '坚韧如岳、极耐打，反震克近战',
};

/** v2.0.0：五行初始剑谱模板（攻伐/坚韧/速度/感知，上限 10；特色：火爆发/木中庸/土铁壁/金快剑/水感知） */
export const ELEMENT_TEMPLATE: Record<Element, { sharpness: number; toughness: number; speed: number; perception: number }> = {
  fire: { sharpness: 8, toughness: 4, speed: 5, perception: 5 },
  wood: { sharpness: 5, toughness: 6, speed: 6, perception: 6 },
  earth: { sharpness: 5, toughness: 9, speed: 3, perception: 5 },
  metal: { sharpness: 6, toughness: 5, speed: 8, perception: 5 },
  water: { sharpness: 5, toughness: 6, speed: 6, perception: 7 },
};

/** 根据五行倾向生成初始剑谱 (凡铁剑意)：按五行模板 + 小幅浮动；杀性按五行（火最高、金中高、木土水中等） */
export function randomGenome(element: Element): Genome {
  const t = ELEMENT_TEMPLATE[element];
  // v2.0.0：五行基础杀性——火最高嗜战、金调高好战、木/土温和守御、水中等；杀性驱动追击执着度
  let aggression: number;
  switch (element) {
    case 'fire': aggression = 0.55 + Math.random() * 0.25; break;
    case 'metal': aggression = 0.5 + Math.random() * 0.2; break;
    case 'wood':
    case 'earth': aggression = 0.35 + Math.random() * 0.12; break; // 温和守御（土靠反震被动、木靠续航）
    default: aggression = 0.4 + Math.random() * 0.15; break; // water 水
  }
  const g: Genome = {
    sharpness: clamp(t.sharpness + (Math.random() * 1.2 - 0.6), GENE_MIN, GENE_MAX),
    toughness: clamp(t.toughness + (Math.random() * 1.2 - 0.6), GENE_MIN, GENE_MAX),
    speed: clamp(t.speed + (Math.random() * 1.2 - 0.6), GENE_MIN, GENE_MAX),
    perception: clamp(t.perception + (Math.random() * 1.2 - 0.6), GENE_MIN, GENE_MAX),
    aggression: clamp(aggression, 0, 1),
    strategy: 0.3 + Math.random() * 0.4,
    element,
    affixes: [],
  };
  return g;
}

/** 生成一道游离剑意 (每日剑潮投放)：按五行模板 + 强度随天数抬升，保留五行特色 */
export function randomWildGenome(day: number): Genome {
  const scale = 1 + day * 0.12; // 越往后越凶 (v1.9.1：放缓增速，第10天不再大量顶格同质化)
  const elem = pickRandom(ELEMENTS);
  const t = ELEMENT_TEMPLATE[elem];
  const g: Genome = {
    sharpness: clamp(t.sharpness * 0.6 + Math.random() * 3 * scale, GENE_MIN, GENE_MAX),
    toughness: clamp(t.toughness * 0.6 + Math.random() * 3 * scale, GENE_MIN, GENE_MAX),
    speed: clamp(t.speed * 0.6 + Math.random() * 3 * scale, GENE_MIN, GENE_MAX),
    perception: clamp(t.perception * 0.6 + Math.random() * 3 * scale, GENE_MIN, GENE_MAX),
    aggression: clamp(0.25 + Math.random() * 0.6, 0, 1),
    strategy: Math.random(),
    element: elem,
    affixes: [],
  };
  return g;
}

/** 温和剑潮 (温养)：低杀性、高感知、求稳 */
export function randomMildGenome(day: number): Genome {
  const g = randomWildGenome(day);
  g.aggression = clamp(g.aggression * 0.5, 0.1, 0.5);
  g.perception = clamp(g.perception + 1.5, GENE_MIN, GENE_MAX);
  g.speed = clamp(g.speed + 0.5, GENE_MIN, GENE_MAX);
  g.strategy = clamp(0.3 + Math.random() * 0.4, 0, 1);
  return g;
}

/** 天外凶剑 (凶潮)：高攻伐、高杀性、求战 */
export function randomFierceGenome(day: number): Genome {
  const g = randomWildGenome(day);
  g.sharpness = clamp(g.sharpness + 1.5, GENE_MIN, GENE_MAX);
  g.aggression = clamp(g.aggression + 0.3, 0, 1);
  g.toughness = clamp(g.toughness + 0.8, GENE_MIN, GENE_MAX);
  g.strategy = clamp(0.2 + Math.random() * 0.6, 0, 1);
  return g;
}

/** 剑谱突变 (剑悟) */
export function mutateGenome(
  parent: Genome,
  rate: number,
  strength = 0.5,
  bias?: Partial<Record<'sharpness' | 'toughness' | 'speed' | 'perception', number>>,
): Genome {
  const child: Genome = { ...parent, affixes: parent.affixes.slice() };
  for (const key of ['sharpness', 'toughness', 'speed', 'perception'] as const) {
    const r = bias?.[key] ?? rate;
    if (Math.random() < r) {
      child[key] = clamp(child[key] + gaussianRandom(0, strength), GENE_MIN, GENE_MAX);
    }
  }
  if (Math.random() < rate) {
    child.aggression = clamp(child.aggression + gaussianRandom(0, 0.12), 0, 1);
  }
  if (Math.random() < rate) {
    child.strategy = clamp(child.strategy + gaussianRandom(0, 0.15), 0, 1);
  }
  // 五行属性小概率突变 (对应“突变的蓝色水行剑意”)
  if (Math.random() < ELEMENT_MUTATION_RATE) {
    const others = ELEMENTS.filter((e) => e !== child.element);
    child.element = pickRandom(others);
  }
  return child;
}

/** 归一化的基因相似度 [0,1] */
export function genomeSimilarity(a: Genome, b: Genome): number {
  const d = Math.hypot(
    (a.sharpness - b.sharpness) / GENE_MAX,
    (a.toughness - b.toughness) / GENE_MAX,
    (a.speed - b.speed) / GENE_MAX,
    (a.perception - b.perception) / GENE_MAX,
  );
  return Math.max(0, 1 - d / Math.sqrt(4));
}

/** 基因总和 */
export function genomeSum(g: Genome): number {
  return g.sharpness + g.toughness + g.speed + g.perception;
}

/** 判断两个剑谱是否有显著变化 (用于事件日志) */
export function genomeChanged(a: Genome, b: Genome): boolean {
  return (
    Math.abs(a.sharpness - b.sharpness) > 0.8 ||
    Math.abs(a.toughness - b.toughness) > 0.8 ||
    Math.abs(a.speed - b.speed) > 0.8 ||
    Math.abs(a.perception - b.perception) > 0.8 ||
    a.element !== b.element
  );
}

/** 策略标签 */
export function strategyLabel(s: number): string {
  if (s >= 0.65) return '合击';
  if (s <= 0.35) return '孤狼';
  return '兼修';
}
