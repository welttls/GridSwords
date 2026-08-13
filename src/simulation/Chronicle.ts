/**
 * v2.5.0：剑域纪事（Chronicle）——结构化事件采集层。
 *
 * 为「剑谱」叙事与「成就」判定提供统一数据源；纯数据、headless 安全（不触 DOM/eventBus）。
 * World 持有单例 world.chronicle（随 World 实例生灭，不随存档持久化——
 * 结算时消费并转成剑谱文本 / 成就统计）。
 */

/** 剑意陨落之因（die 事件与剑谱/成就共用） */
export type DeathCause =
  | 'starve'   // 饿死（精元耗尽）
  | 'melee'    // 近战相杀
  | 'skill'    // 剑意技能击杀
  | 'counter'  // 反震 / 后手反击致死
  | 'lava'     // 熔岩焚身
  | 'thunder'  // 天雷轰杀
  | 'poison'   // 淬毒溃烂
  | 'burn'     // 灼烧焚身
  | 'wound';   // 伤重不治（未明死因）

export type ChronicleEventKind =
  | 'birth'          // 剑意诞生（剑胚/分化/剑潮/重种/寄灵）
  | 'split'          // 分化/寄灵（母剑视角，剑谱重大纪事用）
  | 'firstKill'      // 首杀（剑意生涯第一杀）
  | 'kill'           // 击杀
  | 'death'          // 陨落（带死因/凶手/血亲标记）
  | 'promotion'      // 剑心晋境
  | 'affix'          // 悟得词条
  | 'mindSkill'      // 悟得剑心绝技
  | 'encounter'      // 取得奇遇种子
  | 'thunderSurvive' // 历天雷而存续（雷劫余生）
  | 'nadir'          // 濒死逃生（跌破 20% 又回血过 60%）
  | 'emerge'         // 涌现（自成气候）
  | 'tribulation'    // 天劫收缩
  | 'feed'           // 玩家布霖
  | 'material'       // 玩家使用炉材
  | 'formation'      // 玩家布阵
  | 'lightning'      // 玩家手动天雷（含击杀数）
  | 'tide'           // 玩家择选剑潮
  | 'reseed';        // 玩家重种本命

export interface ChronicleEvent {
  kind: ChronicleEventKind;
  /** 全局 tick（world.tickCounter） */
  tick: number;
  actorId?: string;
  targetId?: string;
  data?: {
    /** birth：诞生途径；encounter：显现来源（world=每日随机 / player=布阵种下） */
    via?: 'seed' | 'split' | 'tide' | 'reseed' | 'parasite' | 'world' | 'player';
    generation?: number;
    origin?: 'seed' | 'wild';
    element?: string;
    parentId?: string;
    /** kill / death */
    cause?: DeathCause;
    /** 是否血亲相残（天劫期） */
    kin?: boolean;
    /** 天雷来源：手动雷劫液 / 天劫落雷 */
    source?: 'manual' | 'tribulation';
    /** promotion：晋境来源 */
    promoVia?: 'slaughter' | 'fortune';
    /** promotion：新境界（1=通明 2=洞玄 3=忘我） */
    realm?: number;
    /** affix：词条 id */
    affix?: string;
    /** mindSkill：绝技 id */
    skillId?: string;
    /** lightning：手动天雷击杀数 */
    kills?: number;
    /** feed / tide / material / formation */
    count?: number;
    id?: string;
    brush?: string;
    /** emerge：当时种群规模 / 世代 */
    population?: number;
    gen?: number;
    /** tribulation：收缩圈数 */
    ring?: number;
    /** nadir：回血后剑体比 */
    hpRatio?: number;
  };
}

export class Chronicle {
  private items: ChronicleEvent[] = [];
  private readonly tickOf: () => number;

  constructor(tickOf: () => number) {
    this.tickOf = tickOf;
  }

  record(
    kind: ChronicleEventKind,
    opts: { actorId?: string; targetId?: string; data?: ChronicleEvent['data'] } = {},
  ): void {
    this.items.push({ kind, tick: this.tickOf(), ...opts });
  }

  /** 全部事件（记录序即时间序） */
  all(): readonly ChronicleEvent[] {
    return this.items;
  }

  /** 与某剑相关的事件（作为攻击/当事人 或 目标） */
  ofSword(id: string): ChronicleEvent[] {
    return this.items.filter((e) => e.actorId === id || e.targetId === id);
  }

  /** 某类事件计数（可带过滤） */
  count(kind: ChronicleEventKind, pred?: (e: ChronicleEvent) => boolean): number {
    let n = 0;
    for (const e of this.items) {
      if (e.kind === kind && (!pred || pred(e))) n++;
    }
    return n;
  }

  /** 某剑作为 actor 的某类事件计数 */
  countBy(kind: ChronicleEventKind, actorId: string): number {
    let n = 0;
    for (const e of this.items) {
      if (e.kind === kind && e.actorId === actorId) n++;
    }
    return n;
  }
}
