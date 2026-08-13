import type { Game } from '../Game';
import type { Element } from '../types';
import { el, clearNode } from '../utils/dom';
import { ELEMENT_LABEL, ELEMENT_DESC, ELEMENT_COLOR } from '../simulation/Genetics';
import { drawSwordIcon } from './swordIcon';
import { openAudioPanel } from './AudioPanel';

/** 主菜单 */
export function buildMenu(host: HTMLElement, game: Game): void {
  clearNode(host);
  const screen = el('div', 'screen menu-screen');
  screen.appendChild(el('h1', 'menu-title', '炼 剑'));
  screen.appendChild(el('p', 'menu-subtitle', '十日育剑 · 剑心自明'));

  const intro = el('p', 'menu-intro', '你是一名剑修弟子。十日内，于剑域之中投放炉材、布霖庚金之气、默许剑潮起落，观凡铁剑意在采气、搏杀、衍生与剑悟中蜕变，最终淬炼出独属于你的本命剑意，赴宗门大比，名动万剑榜。');
  screen.appendChild(intro);

  const buttons = el('div', 'menu-buttons');
  const mk = (
    label: string,
    fn: () => void,
    cls = 'btn-gold',
    opts: { disabled?: boolean; span2?: boolean } = {},
  ) => {
    const b = el('button', `btn ${cls}`, label) as HTMLButtonElement;
    if (opts.disabled) b.disabled = true; // v2.8.0：无档禁用但不隐藏
    if (opts.span2) b.classList.add('menu-span2');
    b.addEventListener('click', fn);
    buttons.appendChild(b);
  };
  // v2.8.1：上排 4 个次要按钮（按使用频率）——万剑榜 / 成就 / 图鉴 / 音律
  mk('万剑榜', () => game.showRanking(), 'btn-ghost');
  mk('成就', () => game.showAchievements(), 'btn-ghost'); // v2.5.0
  mk('图鉴', () => game.showCodex(), 'btn-ghost');
  mk('音律', () => openAudioPanel(), 'btn-ghost'); // v2.3.1：音量设置
  // v2.8.1：下排两个大按钮（最高频）——开始炼剑 / 继续炼剑（各占两列；继续炼剑无档禁用但始终显示）
  const hasRun = !!(game.save.activeRun || game.save.pendingScene);
  mk('☰ 开始炼剑', () => game.showEmbryoSelect(), 'btn-gold menu-primary', { span2: true });
  mk('▶ 继续炼剑', () => game.continueRun(), hasRun ? 'btn-gold menu-primary' : 'btn-ghost menu-primary', { disabled: !hasRun, span2: true });
  screen.appendChild(buttons);
  host.appendChild(screen);
}

/** 五行剑胚卡片 (v2.3.0 抽取复用：主菜单择剑胚 / 重种本命弹窗) */
export function buildElementCard(
  element: Element,
  opts: { compact?: boolean; selected?: boolean; onClick?: (e: Element) => void } = {}
): HTMLElement {
  const card = el('div', 'embryo-card');
  if (opts.compact) card.classList.add('compact');
  if (opts.selected) card.classList.add('selected');
  card.style.setProperty('--el-color', hex(ELEMENT_COLOR[element]));
  const canvas = document.createElement('canvas');
  canvas.width = opts.compact ? 56 : 96;
  canvas.height = opts.compact ? 56 : 96;
  drawSwordIcon(canvas, element);
  const label = el('div', 'embryo-name', `${ELEMENT_LABEL[element]}行剑意`);
  const desc = el('div', 'embryo-desc', ELEMENT_DESC[element]);
  card.append(canvas, label, desc);
  card.addEventListener('click', () => opts.onClick?.(element));
  return card;
}

/** 剑胚选择 (五行五选一；v2.8.0：点选后进入「择剑域」再开局) */
export function buildEmbryoSelect(host: HTMLElement, game: Game): void {
  clearNode(host);
  const screen = el('div', 'screen embryo-screen');
  screen.appendChild(el('h2', 'menu-title small', '择 剑 胚'));
  screen.appendChild(el('p', 'menu-intro', '五行乃剑意之根。选择初始凡铁剑意的五行倾向，再择剑域，第一道剑意将因此而生。'));

  const grid = el('div', 'embryo-grid');
  const elements: Element[] = ['metal', 'wood', 'water', 'fire', 'earth'];
  for (const e of elements) {
    grid.appendChild(buildElementCard(e, { onClick: () => game.openMapSelect(e) }));
  }
  screen.appendChild(grid);

  const back = el('button', 'btn btn-ghost', '← 返回');
  back.addEventListener('click', () => game.showMenu());
  screen.appendChild(back);
  host.appendChild(screen);
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
