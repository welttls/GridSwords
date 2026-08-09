/** 全局事件名 */
export const EVT = {
  LOG: 'log',                       // 事件日志
  DAY_START: 'day-start',           // 新的一天开始
  DAY_CHANGE: 'day-change',
  POP_CHANGE: 'pop-change',         // 种群数量变化
  TRIBULATION_END: 'tribulation-end',
  BATTLE_END: 'battle-end',
  SAVE: 'save',
} as const;

/** 事件日志消息 (可带聚焦 / 重要标记) */
export interface LogMessage {
  text: string;
  /** 点击聚焦某道剑意 (如涌现代表剑、悟得词条之剑、重种的本命剑胚) */
  focusId?: string;
  /** 重要事件：可在「剑域纪事」的「重要」tab 中筛出 (涌现/血脉断绝/悟得词条/寄灵…) */
  important?: boolean;
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
