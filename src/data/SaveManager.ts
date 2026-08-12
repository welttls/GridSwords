import type { Element, Genome, RankedSword, SwordState } from '../types';
import type { World } from '../simulation/World'; // v2.2.1：type-only——GameSave.eco 与 exportEcoState 类型联动（含 wallExpiry）
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
  /** 万剑谱 (v2.0.0)：本命剑收藏，最多 5 柄可替换；旧剑可作大比对手 */
  swordCodex: RankedSword[];
  // —— 当前局 (支持中断续玩) ——
  activeRun: boolean;
  embryoGenome: Genome | null;
  day: number;
  tickCounter: number;
  /** 材料剩余次数 (道具化) */
  materialCounts: Record<string, number>;
  /** 当日已布霖团数 */
  feedDropped: number;
  /** v2.3.0：布阵次数（本局语义，由炉材提供；现仅奇遇种子计次，熔岩/深水无限） */
  formation: { seed: number };
  /** 本局剑潮选择 (v1.10.0)：上次选择，弹窗超时/关闭时沿用；null=本局未选过 */
  dailyDropKind?: 'mild' | 'tide' | 'fierce' | 'auto' | 'none' | null;
  /** 本局免剑潮弹窗 (v1.10.0)：勾选后每日自动按上次选择投放 */
  dailyDropLocked?: boolean;
  swords: SwordState[];
  rootId: string | null;
  maxGeneration: number;
  /** 生态状态 (边界/庚金/火墙/天劫开关，续档恢复用) */
  eco?: ReturnType<World['exportEcoState']> | null;
  // —— 中断续玩：记录当前所处阶段 (鉴定/大比，刷新后可回到原界面) ——
  pendingScene: 'appraisal' | 'tournament' | null;
  pendingAppraisal?: PendingAppraisal | null;
  pendingBattlePlayerState?: SwordState | null;
}

export function defaultSave(): GameSave {
  return {
    version: 1,
    // v2.4.0：雷劫液改初始拥有（手动天雷直接解锁）
    unlockedMaterialIds: ['cold_iron', 'rootless_water', 'wind_talisman', 'thunder_potion'],
    history: [],
    bestScore: 0,
    finishedGames: 0,
    hasBeatenFirstOpponent: false,
    swordCodex: [],
    activeRun: false,
    embryoGenome: null,
    day: 1,
    tickCounter: 0,
    materialCounts: {},
    feedDropped: 0,
    formation: { seed: 0 },
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
      if (!parsed || typeof parsed.version !== 'number') return defaultSave();
      // v2.2.1：未知高版本存档不整档静默丢弃——保留数据按当前结构兼容读取（缺失字段由 defaultSave 兜底）
      if (parsed.version > 1) console.warn('[炼剑] 检测到更高版本存档 (v' + parsed.version + ')，按当前版本兼容读取，部分新字段可能缺失。');
      const save = { ...defaultSave(), ...parsed };
      // v2.4.0：初始炉材迁移——起始解锁材料缺则补（雷劫液改初始拥有，兼容旧档；否则老玩家用不了）
      const START_UNLOCKED = ['cold_iron', 'rootless_water', 'wind_talisman', 'thunder_potion'];
      for (const id of START_UNLOCKED) {
        if (!save.unlockedMaterialIds.includes(id)) save.unlockedMaterialIds.push(id);
      }
      // v2.0.0：万剑谱兜底（旧档无此字段）
      if (!Array.isArray(save.swordCodex)) save.swordCodex = [];
      // P1-6：字段级迁移 —— 旧档 swords[].origin 缺失时按 rootId 补默认
      if (Array.isArray(save.swords)) {
        for (const s of save.swords) {
          if (!s.origin) s.origin = s.id === save.rootId ? 'seed' : 'wild';
          if (s.genome && !Array.isArray(s.genome.affixes)) s.genome.affixes = [];
          // v1.12.0：剑心境界缺省补凡心
          if (s.mindRealm === undefined) s.mindRealm = 0;
        }
      }
      // 鉴定续玩：补 winnerState 字段迁移
      const ws = save.pendingAppraisal?.winnerState;
      if (ws) {
        if (!ws.origin) ws.origin = 'seed';
        if (ws.genome && !Array.isArray(ws.genome.affixes)) ws.genome.affixes = [];
        if (ws.mindRealm === undefined) ws.mindRealm = 0;
      }
      // v2.2.1：materialCounts 是 Record 对象——Array.isArray(对象) 恒 false 导致每次读档把数据覆盖成 {}（刷新后炉材次数归零）→ 改类型判断
      if (!save.materialCounts || typeof save.materialCounts !== 'object' || Array.isArray(save.materialCounts)) save.materialCounts = {};
      // v2.3.0：布阵次数兜底（旧档含熔岩/深水字段 → 精简为仅奇遇种子）
      if (!save.formation || typeof save.formation !== 'object') save.formation = { seed: 0 };
      else save.formation = { seed: save.formation.seed ?? 0 };
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
