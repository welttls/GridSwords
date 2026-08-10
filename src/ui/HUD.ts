import type { World } from '../simulation/World';
import type { Element } from '../types';
import { MAX_DAYS, SHICHEN_NAMES, TICKS_PER_SHICHEN } from '../constants';
import { ELEMENT_COLOR, ELEMENT_LABEL } from '../simulation/Genetics';
import { el, clearNode } from '../utils/dom';
import { eventBus, EVT, type LogMessage } from '../utils/eventBus';
import { toast } from './modals';

const GENES = [
  { key: 'sharpness', label: '锋锐', color: '#8ab4ff' },
  { key: 'toughness', label: '坚韧', color: '#6fd08a' },
  { key: 'speed', label: '速度', color: '#ffc24a' },
  { key: 'perception', label: '感知', color: '#d48aff' },
] as const;

/**
 * 炼剑主界面 HUD (DOM)：顶栏信息、种群基因直方图、事件日志、时间控制。
 */
export class HUD {
  host: HTMLElement;
  private canvasHostEl!: HTMLElement;
  private dayEl!: HTMLElement;
  private popEl!: HTMLElement;
  private tickEl!: HTMLElement;
  private histContainer!: HTMLElement;
  private logContainer!: HTMLElement;
  private speedEl!: HTMLElement;
  private materialBtn!: HTMLButtonElement;
  private feedBtn!: HTMLButtonElement;
  private tideBtn!: HTMLButtonElement;
  private reseedBtn!: HTMLButtonElement;
  private chartEls: { label: string; color: string; bars: HTMLElement[] }[] = [];
  /** 剑域构成分类 (v1.10.0)：五行文本元素 + 本命/外来 */
  private compElems!: { key: Element; el: HTMLElement }[];
  private compSeedEl!: HTMLElement;
  private compWildEl!: HTMLElement;
  /** 日志筛选：all=全部 / important=仅重要 */
  private logFilter: 'all' | 'important' = 'all';

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

  get canvasHost(): HTMLElement {
    return this.canvasHostEl;
  }

  private build(): void {
    clearNode(this.host);

    // —— 顶栏 ——
    const topbar = el('div', 'topbar');
    const title = el('div', 'title', '剑 域');
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

    // 底栏：投食 + 炉材 + 剑潮 + 重种本命 (v1.11.0)
    const footer = el('div', 'forge-footer');
    const feedBtn = el('button', 'btn btn-ghost', '投食') as HTMLButtonElement;
    feedBtn.id = 'feed-btn';
    this.feedBtn = feedBtn;
    const materialBtn = el('button', 'btn btn-gold', '炉材') as HTMLButtonElement;
    materialBtn.id = 'material-btn';
    this.materialBtn = materialBtn;
    const tideBtn = el('button', 'btn btn-ghost', '剑潮') as HTMLButtonElement;
    tideBtn.id = 'tide-btn';
    this.tideBtn = tideBtn;
    const reseedBtn = el('button', 'btn btn-ghost', '重种本命') as HTMLButtonElement;
    reseedBtn.id = 'reseed-btn';
    this.reseedBtn = reseedBtn;
    const hint = el('span', 'hint', '投食随时可施 · 炉材以次数计');
    footer.append(feedBtn, materialBtn, tideBtn, reseedBtn, hint);

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
    const si = Math.floor(dayTick / TICKS_PER_SHICHEN);
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
        const v = s.state.genome[c.label === '锋锐' ? 'sharpness' : c.label === '坚韧' ? 'toughness' : c.label === '速度' ? 'speed' : 'perception'];
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

  setFurnaceEnabled(enabled: boolean): void {
    this.materialBtn.disabled = !enabled;
    this.materialBtn.classList.toggle('dimmed', !enabled);
  }

  setFeedState(remaining: number, onFeed: () => void): void {
    this.feedBtn.disabled = remaining <= 0;
    this.feedBtn.classList.toggle('dimmed', remaining <= 0);
    this.feedBtn.textContent = `投食 ×${Math.max(0, remaining)}`;
    if (this.feedBtn.dataset.hooked !== '1') {
      this.feedBtn.dataset.hooked = '1';
      this.feedBtn.addEventListener('click', onFeed);
    }
  }

  onMaterialClick(fn: () => void): void {
    this.materialBtn.addEventListener('click', fn);
  }

  /** 剑潮偏好按钮 (v1.11.0) */
  onTideClick(fn: () => void): void {
    this.tideBtn.addEventListener('click', fn);
  }

  /** 手动重种本命按钮 (v1.11.0) */
  onReseedClick(fn: () => void): void {
    this.reseedBtn.addEventListener('click', fn);
  }
}
