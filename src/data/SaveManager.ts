import type { Element, Genome, RankedSword, SwordState } from '../types';
import { SAVE_KEY } from '../constants';

/** 鉴定阶段持久化数据 (刷新后可重建「剑成鉴定」界面) */
export interface PendingAppraisal {
  winnerState: SwordState;
  score: number;
  breakdown: { label: string; value: number }[];
  tags: string[];
  tree: {
    id: string;
    generation: number;
    day: number;
    label: string;
    children: number;
    element: Element;
    isWinner?: boolean;
  }[];
  populationHistory: number[];
  totalTicks: number;
}

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
  embryoGenome: Genome | null;
  day: number;
  tickCounter: number;
  /** 材料剩余次数 (道具化) */
  materialCounts: Record<string, number>;
  /** 当日已投食团数 */
  feedDropped: number;
  /** 本局剑潮选择 (v1.10.0)：上次选择，弹窗超时/关闭时沿用；null=本局未选过 */
  dailyDropKind?: 'mild' | 'tide' | 'fierce' | 'auto' | 'none' | null;
  /** 本局免剑潮弹窗 (v1.10.0)：勾选后每日自动按上次选择投放 */
  dailyDropLocked?: boolean;
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
  // —— 中断续玩：记录当前所处阶段 (鉴定/大比，刷新后可回到原界面) ——
  pendingScene: 'appraisal' | 'tournament' | null;
  pendingAppraisal?: PendingAppraisal | null;
  pendingBattlePlayerState?: SwordState | null;
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
    embryoGenome: null,
    day: 1,
    tickCounter: 0,
    materialCounts: {},
    feedDropped: 0,
    dailyDropKind: null,
    dailyDropLocked: false,
    swords: [],
    rootId: null,
    maxGeneration: 1,
    eco: null,
    pendingScene: null,
    pendingAppraisal: null,
    pendingBattlePlayerState: null,
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
      // 鉴定续玩：补 winnerState 字段迁移
      const ws = save.pendingAppraisal?.winnerState;
      if (ws) {
        if (!ws.origin) ws.origin = 'seed';
        if (ws.genome && !Array.isArray(ws.genome.affixes)) ws.genome.affixes = [];
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
