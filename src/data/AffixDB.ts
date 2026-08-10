/** 词条定义：剑意满足条件即悟得，可遗传，有特殊效果 */

export interface AffixDef {
  id: string;
  name: string;
  desc: string;
  /** 稀有词条 (淬毒/寄灵等)，悟得时有醒目提示 */
  rare?: boolean;
}

export const AFFIXES: AffixDef[] = [
  {
    id: 'eat30',
    name: '吞金成性',
    desc: '采气 ≥ 20 团。此后灵力消耗 -30%，吞吐如意。',
  },
  {
    id: 'kill5',
    name: '斩念成性',
    desc: '击破 ≥ 3 敌。此后锋锐 +1.5，杀伐果决。',
  },
  {
    id: 'fight15',
    name: '百炼之体',
    desc: '历经 ≥ 12 战而存续。此后坚固 +1.5。',
  },
  {
    id: 'roam400',
    name: '游历万方',
    desc: '足迹 ≥ 250 格。此后感知 +2，洞悉先机。',
  },
  {
    id: 'poison',
    name: '淬毒',
    desc: '锋锐 ≥ 7 且杀性高、久历杀伐（存续 ≥ 3 日且历经 ≥ 15 战）。攻击附毒，令敌剑体持续溃烂。',
    rare: true,
  },
  {
    id: 'parasite',
    name: '寄灵',
    desc: '木行且策略近合击、世代 ≥ 4。击破者可为己所寄，化作剑子。',
    rare: true,
  },
];

export function affixName(id: string): string {
  return AFFIXES.find((a) => a.id === id)?.name ?? id;
}

export function affixDesc(id: string): string {
  return AFFIXES.find((a) => a.id === id)?.desc ?? '';
}
