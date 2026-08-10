// ===== 世界与网格 =====
export const GRID_WIDTH = 64;
export const GRID_HEIGHT = 64;

// ===== 庚金之气 (食物) =====
export const FOOD_MAX = 15;
export const FOOD_REGEN_RATE = 0.022; // 每 tick 生成一份食物的概率基准 (荒域灵气极其稀薄)
export const FOOD_ENERGY = 19;
export const MEGA_FOOD_ENERGY = 60;
export const MEGA_FOOD_COUNT = 4;

// ===== 剑意 =====
export const MAX_HP = 100;
export const START_ENERGY = 70;
export const START_HP = 100;
export const ENERGY_SPLIT_THRESHOLD = 80;
export const BASE_ENERGY_CONSUMPTION = 0.0117; // 基础精元消耗 (随剑谱属性加成，见 SwordAgent)
/** 静养 (不动) 时精元消耗倍率：约 7-8 日而竭 */
export const IDLE_MULT = 0.4;
export const HP_REGEN_PER_TICK = 0.08;
/** v2.0.0：水系回血倍率——「生生不息」回血最高，存活第二（土铁壁第一） */
export const WATER_REGEN_MULT = 2.0;
export const DECISION_THRESHOLD = 0.2;

// ===== 基因 =====
export const GENE_MIN = 0.1;
export const GENE_MAX = 10;
export const MUTATION_RATE = 0.05;      // 基础突变概率
export const MUTATION_STRENGTH = 0.5;   // 基础突变强度(正态分布标准差)
export const ELEMENT_MUTATION_RATE = 0.008; // 五行属性突变概率

// ===== 神经网络 (剑心) =====
export const NN_INPUT = 26;
export const NN_HIDDEN = 8;
export const NN_OUTPUT = 4;
export const NN_LAYERS = [NN_INPUT, NN_HIDDEN, NN_OUTPUT];

// ===== 剑心境界 (v1.12.0) =====
/** 剑心境界：名称 + 隐藏层节点数 (凡心 26-8-4 → 忘我 26-16-4) */
export const MIND_REALMS = [
  { name: '凡心', hidden: 8 },
  { name: '通明', hidden: 10 },
  { name: '洞玄', hidden: 12 },
  { name: '忘我', hidden: 16 },
] as const;

/** 晋升条件：只看击破（击杀数）达标即开悟下一境 (v2.0.0：历经或击破 → 历经且击破 → 仅击破；击破门槛 1/3/6) */
export const MIND_REALM_THRESHOLDS = [
  { battles: 8, kills: 1 },
  { battles: 20, kills: 3 },
  { battles: 45, kills: 6 },
] as const;

/** 各境界精元消耗倍率 (剑心愈明，维持愈省；野外与大比共用) */
export const MIND_ENERGY_MULT = [1, 0.95, 0.9, 0.85] as const;
/** 各境界技能触发倍率 (洞玄/忘我更擅施法) */
export const MIND_CAST_MULT = [1, 1, 1.25, 1.5] as const;
/** 各境界宗门大比战力加成：攻伐/坚韧/速度/感知 各 +N (v1.12.0) */
export const MIND_DUEL_BONUS = [0, 0.5, 1, 2] as const;
/** 各境界剑意体型缩放 (v2.0.0)：剑身随境界变大，肉眼可辨 */
export const MIND_SWORD_SCALE = [1, 1.12, 1.25, 1.4] as const;

/** 剑心境界 → NN 结构 (输入 26、输出 4 固定，仅隐藏层随境界变化) */
export function mindSizes(realm: number): number[] {
  const r = Math.min(MIND_REALMS.length - 1, Math.max(0, realm));
  return [NN_INPUT, MIND_REALMS[r].hidden, NN_OUTPUT];
}

// ===== 时间与天数 (修仙计时：1日 = 12时辰) =====
export const TICKS_PER_SECOND = 4;   // 1x 速度
export const MAX_DAYS = 10;
export const TICKS_PER_DAY = 960;    // 1x 时约 4 分钟/日
export const TOTAL_TICKS = MAX_DAYS * TICKS_PER_DAY;
export const SHRINK_INTERVAL_TICKS = TICKS_PER_SECOND * 2; // 每2秒收缩一格
export const SHRINK_TARGET_SPAN = 4; // 收缩到最内圈 4x4 即止

/** 十二时辰 */
export const SHICHEN_NAMES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;
export const SHICHEN_COUNT = 12;
export const TICKS_PER_SHICHEN = TICKS_PER_DAY / SHICHEN_COUNT;

// ===== 手动投食 (随时可投，每日有量) =====
export const DAILY_FOOD_DROP = 12;   // 每日可投庚金之气团数
export const FOOD_DROP_BATCH = 3;    // 每次点击落下团数

// ===== 涌现 =====
export const EMERGENCE_THRESHOLD = 20; // 剑意达到此数即视为「涌现」
export const EMERGENCE_MIN_GEN = 6;    // 且血脉世代达到此深度，方称「自成气候」

// ===== 感知 =====
export const MAX_PERCEPTION_RANGE = 20; // 感知基因*2 的最大视野
/** 本能行动半径上限 (感知=NN 视野 20 / 本能=行动半径 10，有意差异：防高感知剑跨图行动) */
export const INSTINCT_RANGE = 10;

// ===== 技能 =====
/** buff 技能每 tick 施放概率 (刻意低于 castChance：防 buff 过期立刻重放、保留增益空窗，见 tryCastSkill) */
export const BUFF_CAST_CHANCE = 0.01;

// ===== 宗门大比 =====
export const ARENA_SIZE = 15;
export const BATTLE_TICK_LIMIT = 600;
export const BATTLE_TPS = 20;          // 大比战斗播放速率 (tick/秒)，半即时制
export const BATTLE_WIN_SCORE = 1000;
export const BATTLE_LOSE_SCORE = 100;

// ===== 存档 =====
export const SAVE_KEY = 'swordforge-save-v1';
export const SAVE_INTERVAL_MS = 5000;

// (v2.0.0：剑尘系统下架，重设计待办「剑尘商店」——见 AI_HANDOFF 九)
