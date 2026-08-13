import type { World } from '../simulation/World';
import type { Element } from '../types';
import { MAX_DAYS, SHICHEN_NAMES, TICKS_PER_SHICHEN } from '../constants';
import { ELEMENT_COLOR, ELEMENT_LABEL } from '../simulation/Genetics';
import { el, clearNode } from '../utils/dom';
import { eventBus, EVT, type LogMessage } from '../utils/eventBus';
import { toast } from './modals';

const GENES = [
  { key: 'sharpness', label: '攻伐', color: '#8ab4ff' },
  { key: 'toughness', label: '坚韧', color: '#6fd08a' },
  { key: 'speed', label: '速度', color: '#ffc24a' },
  { key: 'perception', label: '感知', color: '#d48aff' },
] as const;

/** v2.3.0：布阵笔刷类型（v2.6.0 起纯地形编辑——奇遇改由炉材「奇遇灵种」直接选位种下） */
export type FormationBrush = 'lava' | 'deepwater' | 'clear';
export const FORMATION_BRUSHES: FormationBrush[] = ['lava', 'deepwater', 'clear'];

/** v2.3.0：布阵笔刷悬浮说明 */
export const FORMATION_TIPS: Record<FormationBrush, string> = {
  lava: '布置熔岩：剑意一步踏入即剑体崩解（一击必杀）；瞬移可渡；不限次数',
  deepwater: '布置深水：剑意减速且耗神，水行免疫；不限次数',
  clear: '恢复地形：一次清除 3×3 范围内熔岩/深水，还原为平地（不限次数）',
};

/** v2.8.0：炉材常驻按钮数据 */
export interface MaterialItem {
  id: string;
  name: string;
  count: number;
  unlocked: boolean;
  desc: string;
  lock: string;
}

/** v2.8.1：武装型炉材 id——使用后需点击剑域操作（天雷引雷 / 奇遇灵种种下） */
const ARMED_MATERIALS = new Set(['thunder_potion', 'encounter_seed']);

/**
 * 炼剑主界面 HUD (DOM)：顶栏信息、种群基因直方图、事件日志、时间控制。
 */
export class HUD {
  host: HTMLElement;
  private canvasHostEl!: HTMLElement;
  private titleEl!: HTMLElement; // v2.8.0：顶栏标题（显示当前剑域名）
  private dayEl!: HTMLElement;
  private popEl!: HTMLElement;
  private tickEl!: HTMLElement;
  private histContainer!: HTMLElement;
  private logContainer!: HTMLElement;
  private speedEl!: HTMLElement;
  private feedBtn!: HTMLButtonElement;
  private tideBtn!: HTMLButtonElement;
  private reseedBtn!: HTMLButtonElement;
  /** v2.6.1：音律按钮（背景乐/音效 开关+滑块合一，由 Game 接线） */
  private soundBtn!: HTMLButtonElement;
  /** v2.8.0：常驻操作条——剑域气象 / 炉材 / 布阵笔刷 */
  private auraEl!: HTMLElement;
  private matGridEl!: HTMLElement;
  private canvasSlotEl!: HTMLElement;
  private brushEls!: Record<FormationBrush, HTMLButtonElement>;
  private brushOnPick: ((b: FormationBrush) => void) | null = null;
  private brushHooked = false;
  private matHooked = false;
  private matUse: ((id: string) => void) | null = null;
  private matBtns = new Map<string, HTMLButtonElement>();
  private lastAuraKey = '';
  private chartEls: { label: string; color: string; bars: HTMLElement[] }[] = [];
  /** 剑域构成分类 (v1.10.0)：五行文本元素 + 本命/外来 */
  private compElems!: { key: Element; el: HTMLElement }[];
  private compSeedEl!: HTMLElement;
  private compWildEl!: HTMLElement;
  /** 日志筛选：all=全部 / important=仅重要 */
  private logFilter: 'all' | 'important' = 'all';
  /** v2.2.1：上次写入值缓存——仅变化时才写 DOM（原每帧写入 ~300 次/秒） */
  private lastFeedRemaining: number | null = null;

  /** 日志中「聚焦剑意」的回调 */
  focusHandler: ((id: string) => void) | null = null;

  /** 字段级日志 handler (便于 destroy 时精确解绑) */
  private logHandler = (msg: LogMessage | string) => this.addLog(msg);

  constructor(host: HTMLElement) {
    this.host = host;
    this.build();
    eventBus.on(EVT.LOG, this.logHandler);
  }

  /** 销毁：解绑事件监听，防止多局后重复触发 */
  destroy(): void {
    eventBus.off(EVT.LOG, this.logHandler);
  }

  /** v2.8.0：显示本局剑域名（如「剑 域 · 熔岩炼狱」） */
  setMapName(name: string): void {
    this.titleEl.textContent = `剑 域 · ${name}`;
  }

  get canvasHost(): HTMLElement {
    return this.canvasHostEl;
  }

  /** v2.8.1：画布挂载槽（两侧栏之间的中央画布容器） */
  get canvasSlot(): HTMLElement {
    return this.canvasSlotEl;
  }

  private build(): void {
    clearNode(this.host);

    // —— 顶栏 ——
    const topbar = el('div', 'topbar');
    const title = el('div', 'title', '剑 域');
    this.titleEl = title;
    const dayEl = el('div', 'stat', '—');
    const popEl = el('div', 'stat', '—');
    const tickEl = el('div', 'stat', '—');
    this.dayEl = dayEl;
    this.popEl = popEl;
    this.tickEl = tickEl;

    const stats = el('div', 'stats');
    stats.append(this.statBox('天', dayEl), this.statBox('剑意', popEl), this.statBox('时辰', tickEl));

    // 时间控制
    const speedEl = el('div', 'speed');
    this.speedEl = speedEl;
    topbar.append(title, stats, speedEl);
    this.host.appendChild(topbar);

    // —— 剑域构成分类条 (v1.10.0)：五行 + 本命/外来 ——
    const comp = el('div', 'composition-bar');
    const ELEMS: Element[] = ['metal', 'wood', 'water', 'fire', 'earth'];
    this.compElems = [];
    for (const e of ELEMS) {
      const item = el('span', 'comp-item');
      const dot = el('span', 'comp-dot');
      dot.style.background = `#${ELEMENT_COLOR[e].toString(16).padStart(6, '0')}`;
      const label = el('span', 'comp-text', `${ELEMENT_LABEL[e]} 0`);
      item.append(dot, label);
      comp.appendChild(item);
      this.compElems.push({ key: e, el: label });
    }
    comp.appendChild(el('span', 'comp-sep', '·'));
    const seedItem = el('span', 'comp-item');
    seedItem.append(el('span', 'comp-dot comp-dot-seed'), (this.compSeedEl = el('span', 'comp-text', '本命 0')));
    comp.appendChild(seedItem);
    const wildItem = el('span', 'comp-item');
    wildItem.append(el('span', 'comp-dot comp-dot-wild'), (this.compWildEl = el('span', 'comp-text', '外来 0')));
    comp.appendChild(wildItem);
    this.host.appendChild(comp);

    // —— 主体 ——
    const main = el('div', 'forge-main');
    const canvasHost = el('div', 'canvas-host');
    this.canvasHostEl = canvasHost;

    // v2.8.1：剑域气象/炉材/布阵分列画布两侧——左=剑域气象，右=炉材+布阵（不再堆在画布上方）
    const sideLeft = el('div', 'side-left');
    this.auraEl = el('div', 'aura');
    sideLeft.appendChild(this.auraEl);
    const canvasWrap = el('div', 'canvas-wrap');
    this.canvasSlotEl = canvasWrap;
    const sideRight = el('div', 'side-right');
    this.matGridEl = el('div', 'mat-grid');
    sideRight.appendChild(this.matGridEl);
    const brushGroup = el('div', 'brush-group');
    brushGroup.appendChild(el('span', 'brush-title', '布阵'));
    this.brushEls = {} as Record<FormationBrush, HTMLButtonElement>;
    const BRUSH_LABELS: Record<FormationBrush, string> = { lava: '🔥 熔岩', deepwater: '🌊 深水', clear: '🧹 恢复' };
    for (const b of FORMATION_BRUSHES) {
      const btn = el('button', 'brush-btn tip', BRUSH_LABELS[b]) as HTMLButtonElement;
      btn.dataset.tip = FORMATION_TIPS[b];
      this.brushEls[b] = btn;
      brushGroup.appendChild(btn);
    }
    sideRight.appendChild(brushGroup);
    canvasHost.append(sideLeft, canvasWrap, sideRight);

    const panel = el('aside', 'side-panel');

    const histWrap = el('div', 'panel-section');
    histWrap.appendChild(el('h3', 'section-title', '剑意气象'));
    this.histContainer = el('div', 'hist-grid');
    histWrap.appendChild(this.histContainer);

    const logWrap = el('div', 'panel-section grow');
    logWrap.appendChild(el('h3', 'section-title', '剑域纪事'));
    // 分类 tab：全部 / 重要
    const tabBar = el('div', 'log-tabs');
    const tabAll = el('button', 'log-tab active', '全部');
    const tabImp = el('button', 'log-tab', '重要');
    tabBar.append(tabAll, tabImp);
    const applyFilter = () => {
      tabAll.classList.toggle('active', this.logFilter === 'all');
      tabImp.classList.toggle('active', this.logFilter === 'important');
      for (const child of this.logContainer.children) {
        const line = child as HTMLElement;
        const hide = this.logFilter === 'important' && line.dataset.important !== '1';
        line.style.display = hide ? 'none' : '';
      }
    };
    tabAll.addEventListener('click', () => {
      this.logFilter = 'all';
      applyFilter();
    });
    tabImp.addEventListener('click', () => {
      this.logFilter = 'important';
      applyFilter();
    });
    logWrap.appendChild(tabBar);
    this.logContainer = el('div', 'log-list');
    logWrap.appendChild(this.logContainer);

    panel.append(histWrap, logWrap);

    // 底栏：布霖 + 炉材 + 布阵 + 剑潮 + 重种本命 (v1.11.0 / v2.3.0)
    // v2.6.0：全部底栏按钮加悬浮解释（复用 .tip[data-tip] 全局委托浮窗）
    const footer = el('div', 'forge-footer');
    const feedBtn = el('button', 'btn btn-ghost tip', '布霖') as HTMLButtonElement;
    feedBtn.id = 'feed-btn';
    feedBtn.dataset.tip = '布霖庚金之气：在剑域随机落下 3 团庚金（每日 12 团配额，随时可施）。剑意采食回能、积满分化。';
    this.feedBtn = feedBtn;
    const tideBtn = el('button', 'btn btn-ghost tip', '剑潮') as HTMLButtonElement;
    tideBtn.id = 'tide-btn';
    tideBtn.dataset.tip = '剑潮偏好：调整每日子时投放的游离剑意类型，下次子时生效。';
    this.tideBtn = tideBtn;
    const reseedBtn = el('button', 'btn btn-ghost tip', '重种本命') as HTMLButtonElement;
    reseedBtn.id = 'reseed-btn';
    reseedBtn.dataset.tip = '重种本命：本命血脉断绝后，重新种下一柄剑胚（可自选五行）。';
    this.reseedBtn = reseedBtn;
    // 音律（v2.6.1：背景乐/音效 开关+滑块合一面板，与主菜单/大比共用；由 Game 接线暂停走时）
    const soundBtn = el('button', 'btn btn-ghost tip', '音律') as HTMLButtonElement;
    soundBtn.dataset.tip = '音律：背景乐与音效的开关、音量滑块——两个同在一处调节。';
    this.soundBtn = soundBtn;
    footer.append(feedBtn, tideBtn, reseedBtn, soundBtn);

    main.append(canvasHost, panel);
    this.host.append(main, footer);

    this.buildHistogram();
    this.addLog('剑域初开，凡铁剑意落入其中。');
  }

  private statBox(label: string, valueEl: HTMLElement): HTMLElement {
    const box = el('div', 'stat-box');
    box.append(el('span', 'stat-label', label), valueEl);
    return box;
  }

  private buildHistogram(): void {
    clearNode(this.histContainer);
    this.chartEls = [];
    for (const g of GENES) {
      const chart = el('div', 'chart');
      chart.appendChild(el('div', 'chart-label', g.label));
      const barsRow = el('div', 'chart-bars');
      const bars: HTMLElement[] = [];
      for (let i = 0; i < 10; i++) {
        const bar = el('div', 'bar');
        bar.style.background = g.color;
        bars.push(bar);
        barsRow.appendChild(bar);
      }
      chart.appendChild(barsRow);
      this.histContainer.appendChild(chart);
      this.chartEls.push({ label: g.label, color: g.color, bars });
    }
  }

  /** 更新顶栏与直方图 */
  update(world: World): void {
    const day = Math.min(MAX_DAYS, Math.floor(world.tickCounter / world.config.dayTickLimit) + 1);
    this.dayEl.textContent = `第 ${day} / ${MAX_DAYS} 日`;
    this.popEl.textContent = `${world.swords.size}`;
    const dayTick = world.tickCounter % world.config.dayTickLimit;
    let si = Math.floor(dayTick / TICKS_PER_SHICHEN);
    // v2.6.0：天劫超时（越过第 10 日）不再回绕时辰，固定显示亥时（与剑谱 dayShichen 一致）
    if (world.tickCounter >= MAX_DAYS * world.config.dayTickLimit) si = SHICHEN_NAMES.length - 1;
    const ke = Math.floor((dayTick % TICKS_PER_SHICHEN) / 10); // 每刻 10 tick
    const shichen = SHICHEN_NAMES[Math.min(SHICHEN_NAMES.length - 1, si)];
    this.tickEl.textContent = `${shichen}时${ke}刻`;

    // 直方图 (分 10 桶)
    const all = [...world.swords.values()];

    // 剑域构成分类统计 (v1.10.0)：五行 + 本命/外来
    const counts: Record<Element, number> = { metal: 0, wood: 0, water: 0, fire: 0, earth: 0 };
    let seedN = 0;
    for (const s of all) {
      counts[s.state.genome.element]++;
      if (s.state.origin === 'seed') seedN++;
    }
    for (const c of this.compElems) c.el.textContent = `${ELEMENT_LABEL[c.key]} ${counts[c.key]}`;
    this.compSeedEl.textContent = `本命 ${seedN}`;
    this.compWildEl.textContent = `外来 ${all.length - seedN}`;

    for (const c of this.chartEls) {
      const buckets = new Array(10).fill(0);
      for (const s of all) {
        const v = s.state.genome[c.label === '攻伐' ? 'sharpness' : c.label === '坚韧' ? 'toughness' : c.label === '速度' ? 'speed' : 'perception'];
        const idx = Math.min(9, Math.max(0, Math.floor(v / 10 * 9.999)));
        buckets[idx]++;
      }
      const max = Math.max(1, ...buckets);
      c.bars.forEach((bar, i) => {
        const h = Math.max(4, (buckets[i] / max) * 100);
        bar.style.height = `${h}%`;
      });
    }
  }

  addLog(msg: LogMessage | string): void {
    const text = typeof msg === 'string' ? msg : msg.text;
    const focusId = typeof msg === 'string' ? undefined : msg.focusId;
    const important = typeof msg === 'string' ? false : !!msg.important;
    const line = el('div', 'log-line' + (focusId ? ' log-focus' : '') + (important ? ' log-important' : ''));
    line.dataset.important = important ? '1' : '0';
    line.textContent = text;
    if (focusId) {
      line.title = '点击聚焦此剑意';
      line.addEventListener('click', () => this.focusHandler?.(focusId));
    }
    this.logContainer.prepend(line);
    if (this.logFilter === 'important' && !important) line.style.display = 'none';
    while (this.logContainer.children.length > 500) {
      this.logContainer.lastElementChild?.remove();
    }
    // 稀有词条 toast (UI 层处理)
    if (typeof msg !== 'string' && msg.rareToast) {
      toast(msg.rareToast);
    }
  }

  setSpeedControl(speed: number, paused: boolean, onSpeed: (s: number) => void, onPause: () => void): void {
    clearNode(this.speedEl);
    const mk = (label: string, active: boolean, fn: () => void) => {
      const b = el('button', `speed-btn${active ? ' active' : ''}`, label) as HTMLButtonElement;
      b.addEventListener('click', fn);
      return b;
    };
    this.speedEl.append(
      mk(paused ? '▶' : '⏸', paused, onPause),
      mk('1x', !paused && speed === 1, () => onSpeed(1)),
      mk('2x', !paused && speed === 2, () => onSpeed(2)),
      mk('5x', !paused && speed === 5, () => onSpeed(5)),
      mk('10x', !paused && speed === 10, () => onSpeed(10)),
    );
  }

  setFeedState(remaining: number, onFeed: () => void): void {
    if (remaining === this.lastFeedRemaining) return; // v2.2.1：值未变不写 DOM
    this.lastFeedRemaining = remaining;
    this.feedBtn.disabled = remaining <= 0;
    this.feedBtn.classList.toggle('dimmed', remaining <= 0);
    this.feedBtn.textContent = `布霖 ×${Math.max(0, remaining)}`; // v2.3.0：改名「布霖」
    if (this.feedBtn.dataset.hooked !== '1') {
      this.feedBtn.dataset.hooked = '1';
      this.feedBtn.addEventListener('click', onFeed);
    }
  }

  /** 剑潮偏好按钮 (v1.11.0) */
  onTideClick(fn: () => void): void {
    this.tideBtn.addEventListener('click', fn);
  }

  /** 手动重种本命按钮 (v1.11.0) */
  onReseedClick(fn: () => void): void {
    this.reseedBtn.addEventListener('click', fn);
  }

  /** v2.6.1：音律按钮（由 Game 接线打开共享音律面板） */
  onAudioClick(fn: () => void): void {
    this.soundBtn.addEventListener('click', fn);
  }

  /** v2.8.0：剑域气象常驻（无修正时显示「风平浪静」；值未变不写 DOM） */
  setAura(lines: string[]): void {
    const key = lines.join('|');
    if (key === this.lastAuraKey) return;
    this.lastAuraKey = key;
    clearNode(this.auraEl);
    this.auraEl.appendChild(el('span', 'aura-title', '剑域气象'));
    if (lines.length === 0) {
      this.auraEl.appendChild(el('span', 'aura-line', '风平浪静'));
    } else {
      for (const l of lines) this.auraEl.appendChild(el('span', 'aura-line', l));
    }
  }

  /** v2.8.0：炉材常驻按钮（首次构建，后续只刷新次数/禁用态） */
  setMaterials(items: MaterialItem[], onUse: (id: string) => void): void {
    if (!this.matHooked) {
      this.matHooked = true;
      this.matUse = onUse;
      for (const it of items) {
        const btn = el('button', 'mat-btn tip') as HTMLButtonElement;
        btn.dataset.tip = `${it.desc}${it.lock ? `（${it.lock} 解锁）` : ''}`;
        btn.appendChild(el('span', 'mat-count', `${it.name} ×${it.count}`));
        // v2.8.1：武装型炉材（使用后需点击剑域操作）加视觉区分 + 徽章提示
        if (ARMED_MATERIALS.has(it.id)) {
          btn.classList.add('armed');
          btn.appendChild(el('span', 'mat-badge', it.id === 'thunder_potion' ? '点击引雷' : '点击种下'));
        }
        btn.addEventListener('click', () => {
          const cur = this.matBtns.get(it.id);
          if (cur && !cur.classList.contains('locked')) this.matUse?.(it.id);
        });
        this.matBtns.set(it.id, btn);
        this.matGridEl.appendChild(btn);
      }
    }
    for (const it of items) {
      const btn = this.matBtns.get(it.id);
      if (!btn) continue;
      const countEl = btn.querySelector('.mat-count');
      if (countEl) countEl.textContent = `${it.name} ×${it.count}`;
      btn.classList.toggle('locked', it.count <= 0 || !it.unlocked);
    }
  }

  /** v2.8.0：布阵笔刷常驻（选中高亮；null=未武装） */
  setBrush(brush: FormationBrush | null, onPick: (b: FormationBrush) => void): void {
    if (!this.brushHooked) {
      this.brushHooked = true;
      this.brushOnPick = onPick;
      for (const b of FORMATION_BRUSHES) {
        this.brushEls[b].addEventListener('click', () => this.brushOnPick?.(b));
      }
    }
    for (const b of FORMATION_BRUSHES) this.brushEls[b].classList.toggle('active', b === brush);
  }
}
