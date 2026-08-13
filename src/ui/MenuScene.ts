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
  const mk = (label: string, fn: () => void, cls = 'btn-gold') => {
    const b = el('button', `btn ${cls}`, label);
    b.addEventListener('click', fn);
    buttons.appendChild(b);
  };
  mk('☰ 开始炼剑', () => game.showEmbryoSelect());
  if (game.save.activeRun || game.save.pendingScene) {
    mk('▶ 继续炼剑', () => game.continueRun(), 'btn-ghost');
  }
  mk('万剑榜', () => game.showRanking(), 'btn-ghost');
  mk('成就', () => game.showAchievements(), 'btn-ghost'); // v2.5.0
  mk('图鉴', () => game.showCodex(), 'btn-ghost');
  mk('音律', () => openAudioPanel(), 'btn-ghost'); // v2.3.1：音量设置
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

/** 剑胚选择 (五行五选一) */
export function buildEmbryoSelect(host: HTMLElement, game: Game): void {
  clearNode(host);
  const screen = el('div', 'screen embryo-screen');
  screen.appendChild(el('h2', 'menu-title small', '择 剑 胚'));
  screen.appendChild(el('p', 'menu-intro', '五行乃剑意之根。选择初始凡铁剑意的五行倾向，第一道剑意将因此而生。'));

  const grid = el('div', 'embryo-grid');
  const elements: Element[] = ['metal', 'wood', 'water', 'fire', 'earth'];
  for (const e of elements) {
    grid.appendChild(buildElementCard(e, { onClick: () => game.startNewRun(e) }));
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
