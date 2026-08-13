/**
 * v2.8.2：剑成鉴定纯逻辑——特质 / 悟道之树 / 评分。
 * 从 Game.ts 拆分迁出：全部为纯函数（不触 Game 状态，仅依赖 World / 剑意 / 剑胚）。
 */
import type { Element, Genome } from '../types';
import type { SwordAgent } from './SwordAgent';
import type { World } from './World';
import { writeSwordTale } from './SwordTale';
import { genomeSimilarity, genomeSum } from './Genetics';
import { TOTAL_TICKS } from '../constants';
import type { AppraisalData, EvoNode } from '../ui/AppraisalScene';

/** 鉴定特质（行为标签，上限 3），与 recheckAffixes 词条门槛一致 */
export function computeTags(s: SwordAgent): string[] {
  const b = s.behavior;
  const tags: string[] = [];
  if (b.killCount >= 3) tags.push('斩念成性');
  if (b.eatCount >= 20) tags.push('吞金成性'); // 与 eat30 词条门槛一致
  if (b.minHp > 60) tags.push('百炼之体');
  if (b.cellsVisited >= 350 && b.cellsVisited / Math.max(1, s.state.age) >= 0.35) tags.push('游历万方'); // 与 roam400 词条门槛一致 (v1.11.0：足迹+游走密度)
  if (b.waitCount >= 200 && s.state.age > 2000) tags.push('静若渊渟');
  if (s.state.survivedThunder) tags.push('雷劫余生'); // v1.9.1：个体经历 (曾历雷击而存续)，不再按世界级开关全员标注
  return tags.slice(0, 3);
}

/** 悟道之树——追链到血统根，链根为本命剑胚才拼接胚源 (v1.11.0 血统溯源) */
export function buildEvolutionTree(
  world: World,
  winnerId: string,
  embryoElement: Element | undefined,
): EvoNode[] {
  const chain: { id: string; generation: number; day: number; element: Element }[] = [];
  let id = winnerId;
  let guard = 0;
  let chainRootId = '';
  while (id && guard++ < 2000) {
    const info = world.lineage.get(id);
    if (!info) break;
    chain.push({ id, generation: info.generation, day: info.day, element: info.element });
    chainRootId = id;
    id = info.parentId;
  }
  // v1.11.0：血统溯源——链根为本命剑胚才拼接胚源；
  // 若本命剑是外来剑意（剑潮投放的独立血脉），其树根即外来根，勿拼接成本命后代误导血缘
  const rootIsSeed = chainRootId === world.rootId;
  const rootElement = rootIsSeed
    ? (embryoElement ?? chain[chain.length - 1]?.element ?? 'metal')
    : chain[chain.length - 1]?.element ?? 'metal';
  if (rootIsSeed) {
    chain.push({ id: world.rootId ?? 'root', generation: 1, day: 0, element: rootElement });
  }
  chain.reverse();

  const childrenCount = (parentId: string): number => {
    let n = 0;
    for (const v of world.lineage.values()) if (v.parentId === parentId) n++;
    return n;
  };

  return chain.map((n, i) => {
    const isWinner = i === chain.length - 1;
    let label = '血脉延续';
    if (i === 0) label = rootIsSeed ? '凡铁剑意' : '外来剑意';
    else if (n.element !== chain[i - 1].element) label = '血脉蜕变';
    if (isWinner) label = '本命剑';
    return { id: n.id, generation: n.generation, day: n.day, label, children: childrenCount(n.id), element: n.element, isWinner };
  });
}

/** 剑成鉴定——幸存剑意评分，取最优；无幸存者返回 null */
export function computeAppraisal(
  world: World,
  embryo: Genome | null,
  finishedGames: number,
): AppraisalData | null {
  const survivors = [...world.swords.values()];
  if (survivors.length === 0) return null;
  const totalTicks = TOTAL_TICKS;

  const scored = survivors.map((s) => {
    const tags = computeTags(s);
    const survivalRatio = Math.min(1, s.state.age / totalTicks);
    const sim = embryo ? genomeSimilarity(s.state.genome, embryo) : 0.5;
    const sum = genomeSum(s.state.genome);
    const behaviorBonus = Math.min(15, 5 + tags.length * 5);
    const score = survivalRatio * 10 + sim * 20 + sum * 0.5 + behaviorBonus;
    return { s, tags, score, survivalRatio, sim, sum, behaviorBonus };
  });
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const tree = buildEvolutionTree(world, winner.s.state.id, embryo?.element);
  // v2.5.0：剑谱——剑成时生成（占位名「无名剑」，命名后于 finishAppraisal 重生成定稿）
  const tale = writeSwordTale(world, winner.s.state, finishedGames + 1, Math.round(winner.score * 10) / 10);
  return {
    winner: winner.s,
    score: Math.round(winner.score * 10) / 10,
    breakdown: [
      { label: `存续 ${(winner.survivalRatio * 100).toFixed(0)}%`, value: winner.survivalRatio * 10 },
      { label: '血脉相承', value: winner.sim * 20 },
      { label: '剑谱总和', value: winner.sum * 0.5 },
      { label: '本性殊异', value: winner.behaviorBonus },
    ],
    tags: winner.tags,
    tree,
    populationHistory: world.populationHistory,
    totalTicks,
    tale,
  };
}
