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
  };
}

export class SaveManager {
  static load(): GameSave {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw) as GameSave;
      if (!parsed || parsed.version !== 1) return defaultSave();
      return { ...defaultSave(), ...parsed };
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
