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
  metal: '锋锐无双，初始锋锐 +2',
  wood: '生生不息，初始坚韧 +2',
  water: '灵动缥缈，初始速度 +2',
  fire: '暴烈好战，攻击欲望略高',
  earth: '厚重沉稳，初始感知 +2',
};

/** 根据五行倾向生成初始剑谱 (凡铁剑意) */
export function randomGenome(element: Element): Genome {
  const g: Genome = {
    sharpness: 2 + Math.random() * 1.5,
    toughness: 2 + Math.random() * 1.5,
    speed: 2 + Math.random() * 1.5,
    perception: 2 + Math.random() * 1.5,
    aggression: 0.3 + Math.random() * 0.2,
    strategy: 0.3 + Math.random() * 0.4,
    element,
    affixes: [],
  };
  switch (element) {
    case 'metal': g.sharpness += 2; break;
    case 'wood': g.toughness += 2; break;
    case 'water': g.speed += 2; break;
    case 'fire': g.aggression = clamp(g.aggression + 0.25, 0, 1); break;
    case 'earth': g.perception += 2; break;
  }
  return g;
}

/** 生成一道游离剑意 (每日剑潮投放)，强度随天数抬升 */
export function randomWildGenome(day: number): Genome {
  const scale = 1 + day * 0.18; // 越往后越凶
  const g: Genome = {
    sharpness: clamp(1.5 + Math.random() * 4 * scale, GENE_MIN, GENE_MAX),
    toughness: clamp(1.5 + Math.random() * 4 * scale, GENE_MIN, GENE_MAX),
    speed: clamp(1.5 + Math.random() * 4 * scale, GENE_MIN, GENE_MAX),
    perception: clamp(1.5 + Math.random() * 4 * scale, GENE_MIN, GENE_MAX),
    aggression: clamp(0.25 + Math.random() * 0.6, 0, 1),
    strategy: Math.random(),
    element: pickRandom(ELEMENTS),
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

/** 天外凶剑 (凶潮)：高锋锐、高杀性、求战 */
export function randomFierceGenome(day: number): Genome {
  const g = randomWildGenome(day + 1);
  g.sharpness = clamp(g.sharpness + 2, GENE_MIN, GENE_MAX);
  g.aggression = clamp(g.aggression + 0.3, 0, 1);
  g.toughness = clamp(g.toughness + 1, GENE_MIN, GENE_MAX);
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
