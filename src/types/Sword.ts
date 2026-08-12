import type { Genome, Element } from './Genome';

/**
 * 剑意个体状态 (可序列化，用于存读档)。
 * 神经网络的权重/偏置以扁平数组保存，便于变异与序列化。
 */
export interface SwordState {
  id: string;
  name: string;
  genome: Genome;
  brainWeights: number[];
  brainBiases: number[];
  /** 动态状态 */
  energy: number;
  hp: number;
  /** 存活 tick 数 */
  age: number;
  birthTick: number;
  position: { x: number; y: number };
  /** 朝向 (渲染用) */
  facing: { x: number; y: number };
  /** 血统溯源 */
  parentId: string;
  generation: number;
  /** 来源：seed=本命血脉(玩家剑胚一脉)，wild=外来剑意(每日剑潮) */
  origin: 'seed' | 'wild';
  /** 中毒状态 (淬毒词条，运行时) */
  poisonDmg?: number;
  poisonTicks?: number;
  /** 战斗 buff (技能)：攻/防倍率与剩余 tick */
  buffAtkMult?: number;
  buffAtkTicks?: number;
  buffDefMult?: number;
  buffDefTicks?: number;
  /** v2.3.0：控制/灼烧/反震/免控/烈焰甲（运行时，不随血脉遗传） */
  rootedTicks?: number;      // 定身：剩余 tick 内不可移动（青藤缚）
  slowedTicks?: number;      // 减速：剩余 tick 内移动有概率受阻（地脉震/深水）
  burningTicks?: number;     // 灼烧：每 tick 灼伤剑体（焚天爆/烈焰甲附火）
  reflectPct?: number;       // 反震：受近战攻击时反弹伤害比例（金罡体/百炼守）
  reflectTicks?: number;
  immuneCCTicks?: number;    // 免控：免疫定身/击退/减速（磐石护）
  flameArmorTicks?: number;  // 烈焰甲：攻击命中附灼烧
  /** 经历天雷 (雷劫液) 而存续：鉴定「雷劫余生」标签判定 (v1.9.1) */
  survivedThunder?: boolean;
  /** 剑心境界 (0=凡心 1=通明 2=洞玄 3=忘我；决定 NN 隐藏层容量与境界加成，v1.12.0) */
  mindRealm?: number;
  /** 已悟剑心绝技 id (v2.0.0：晋升 3 选 1/大招获得，随血脉遗传) */
  mindSkillIds?: string[];
  /** 剑体上限 (v2.2.0：剑心升级 +50/境；缺省用 MAX_HP=100) */
  maxHp?: number;
  /** 精元上限 (v2.2.0：剑心升级 +50/境；缺省用 ENERGY_SPLIT_THRESHOLD=80) */
  maxEnergy?: number;
  /** 行为统计 (续档恢复用，随剑意序列化) */
  behavior?: BehaviorStats;
}

/** 行为统计 (运行时，不序列化) */
export interface BehaviorStats {
  eatCount: number;
  attackCount: number;
  killCount: number;
  moveCount: number;
  waitCount: number;
  cellsVisited: number;
  minHp: number;
  fightsSurvived: number;
}

/** 排行榜/名剑条目 */
export interface RankedSword {
  id: string;
  name: string;
  element: Element;
  genome: Genome;
  score: number;
  tags: string[];
  date: string;
  dayReached: number;
  wins: number;
}
