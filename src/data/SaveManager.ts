import type { Element, Genome, RankedSword, SwordState } from '../types';
import { SAVE_KEY } from '../constants';

/** 存档结构 (JSON 序列化，无循环引用) */
export interface GameSave {
  version: number;
  // —— 全局进度 ——
  unlockedMaterialIds: string[];
  history: RankedSword[];
  bestScore: number;
  finishedGames: number;
  hasBeatenFirstOpponent: boolean;
  hasSwordDust: boolean;
  // —— 当前局 (支持中断续玩) ——
  activeRun: boolean;
  embryoElement: Element | null;
  embryoGenome: Genome | null;
  day: number;
  tickCounter: number;
  /** 材料剩余次数 (道具化) */
  materialCounts: Record<string, number>;
  /** 当日已投食团数 */
  feedDropped: number;
  swords: SwordState[];
  rootId: string | null;
  maxGeneration: number;
  /** 生态状态 (边界/庚金/火墙/天劫开关，续档恢复用) */
  eco?: {
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    food: [number, number, number][];
    walls: [number, number][];
    spawnFood: boolean;
    isShrinking: boolean;
  } | null;
}

export function defaultSave(): GameSave {
  return {
    version: 1,
    unlockedMaterialIds: ['cold_iron', 'fusang_spark', 'rootless_water', 'wind_talisman'],
    history: [],
    bestScore: 0,
    finishedGames: 0,
    hasBeatenFirstOpponent: false,
    hasSwordDust: false,
    activeRun: false,
    embryoElement: null,
    embryoGenome: null,
    day: 1,
    tickCounter: 0,
    materialCounts: {},
    feedDropped: 0,
    swords: [],
    rootId: null,
    maxGeneration: 1,
    eco: null,
  };
}

export class SaveManager {
  static load(): GameSave {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw) as GameSave;
      if (!parsed || parsed.version !== 1) return defaultSave();
      const save = { ...defaultSave(), ...parsed };
      // P1-6：字段级迁移 —— 旧档 swords[].origin 缺失时按 rootId 补默认
      if (Array.isArray(save.swords)) {
        for (const s of save.swords) {
          if (!s.origin) s.origin = s.id === save.rootId ? 'seed' : 'wild';
          if (s.genome && !Array.isArray(s.genome.affixes)) s.genome.affixes = [];
        }
      }
      if (!Array.isArray(save.materialCounts)) save.materialCounts = {};
      return save;
    } catch {
      return defaultSave();
    }
  }

  static save(save: GameSave): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch {
      // 存储已满或不可用，忽略
    }
  }

  static clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }
}
