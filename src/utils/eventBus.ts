/** 全局事件名 */
export const EVT = {
  LOG: 'log',                       // 事件日志
  DAY_START: 'day-start',           // 新的一天开始
  DAY_CHANGE: 'day-change',
  POP_CHANGE: 'pop-change',         // 种群数量变化
  TRIBULATION_END: 'tribulation-end',
  BATTLE_END: 'battle-end',
  SAVE: 'save',
  // —— 粒子事件 (仅渲染端监听，headless 无副作用) ——
  BATTLE_HIT: 'battle-hit',         // 剑体碰撞火花
  SPLIT: 'split',                   // 分化衍生灵光
  DEATH: 'death',                   // 剑意陨落
  EAT: 'eat',                       // 采气星屑
  THUNDER: 'thunder',               // 天劫雷光
  EMERGENCE: 'emergence',           // 涌现庆典
  SKILL: 'skill',                   // 剑意技能特效
} as const;

/** 技能特效事件 */
export interface SkillVisual {
  kind: 'projectile' | 'aoe' | 'line' | 'teleport' | 'heal' | 'buff';
  x: number;
  y: number;
  dx?: number;
  dy?: number;
  element?: string;
  radius?: number;
  /** 飘字文本 (技能名，渲染端上浮淡出；headless 无监听即忽略) */
  text?: string;
}

/** 粒子事件负载 (网格坐标 + 五行) */
export interface ParticleEvent {
  x: number;
  y: number;
  element?: string;
  intensity?: number;
}

/** 事件日志消息 (可带聚焦 / 重要标记) */
export interface LogMessage {
  text: string;
  /** 点击聚焦某道剑意 (如涌现代表剑、悟得词条之剑、重种的本命剑胚) */
  focusId?: string;
  /** 重要事件：可在「剑域纪事」的「重要」tab 中筛出 (涌现/血脉断绝/悟得词条/寄灵…) */
  important?: boolean;
  /** 需要弹出 toast 的文本 (由 UI 层 HUD 处理，simulation 不直接调 DOM) */
  rareToast?: string;
}

type Handler = (payload: any) => void;

class EventBus {
  private map = new Map<string, Set<Handler>>();

  on(evt: string, fn: Handler): () => void {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt)!.add(fn);
    return () => this.off(evt, fn);
  }

  off(evt: string, fn: Handler): void {
    this.map.get(evt)?.delete(fn);
  }

  emit(evt: string, payload?: unknown): void {
    this.map.get(evt)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        // 事件处理器异常不应中断主循环
      }
    });
  }
}

export const eventBus = new EventBus();
