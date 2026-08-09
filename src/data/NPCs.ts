import type { Genome } from '../types';

/** 同门弟子剑意 (NPC 对手，难度递增) */
export const NPC_OPPONENTS: { id: string; name: string; title: string; difficulty: number; genome: Genome; tags: string[] }[] = [
  {
    id: 'npc-1',
    name: '陈师侄',
    title: '青莲剑',
    difficulty: 1,
    tags: ['初窥门径'],
    genome: {
      sharpness: 4.2,
      toughness: 3.6,
      speed: 3.8,
      perception: 3.4,
      aggression: 0.45,
      strategy: 0.6,
      element: 'wood',
      affixes: [],
    },
  },
  {
    id: 'npc-2',
    name: '周师兄',
    title: '玄铁重剑',
    difficulty: 1.4,
    tags: ['力大势沉'],
    genome: {
      sharpness: 6.0,
      toughness: 6.5,
      speed: 2.2,
      perception: 3.0,
      aggression: 0.6,
      strategy: 0.25,
      element: 'earth',
      affixes: [],
    },
  },
  {
    id: 'npc-3',
    name: '大师姐',
    title: '惊鸿剑',
    difficulty: 1.9,
    tags: ['身法如电', '出手如风'],
    genome: {
      sharpness: 5.5,
      toughness: 4.2,
      speed: 7.0,
      perception: 6.0,
      aggression: 0.72,
      strategy: 0.75,
      element: 'water',
      affixes: [],
    },
  },
];
