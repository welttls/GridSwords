import type { Game } from '../Game';
import type { Element } from '../types';
import { el, clearNode } from '../utils/dom';
import { ELEMENT_LABEL, ELEMENT_DESC, ELEMENT_COLOR } from '../simulation/Genetics';
import { drawSwordIcon } from './swordIcon';

/** 主菜单 */
export function buildMenu(host: HTMLElement, game: Game): void {
  clearNode(host);
  const screen = el('div', 'screen menu-screen');
  screen.appendChild(el('h1', 'menu-title', '炼 剑'));
  screen.appendChild(el('p', 'menu-subtitle', '十日育剑 · 剑心自明'));

  const intro = el('p', 'menu-intro', '你是一名剑修弟子。十日内，于剑域之中投放炉材、撒布庚金之气、默许剑潮起落，观凡铁剑意在采气、搏杀、衍生与剑悟中蜕变，最终淬炼出独属于你的本命剑意，赴宗门大比，名动万剑榜。');
  screen.appendChild(intro);

  const buttons = el('div', 'menu-buttons');
  const mk = (label: string, fn: () => void, cls = 'btn-gold') => {
    const b = el('button', `btn ${cls}`, label);
    b.addEventListener('click', fn);
    buttons.appendChild(b);
  };
  mk('☰ 开始炼剑', () => game.showEmbryoSelect());
  if (game.save.activeRun) {
    mk('▶ 继续炼剑', () => game.continueRun(), 'btn-ghost');
  }
  mk('万剑榜', () => game.showRanking(), 'btn-ghost');
  mk('图鉴', () => game.showCodex(), 'btn-ghost');
  screen.appendChild(buttons);
  host.appendChild(screen);
}

/** 剑胚选择 (五行五选一) */
export function buildEmbryoSelect(host: HTMLElement, game: Game): void {
  clearNode(host);
  const screen = el('div', 'screen embryo-screen');
  screen.appendChild(el('h2', 'menu-title small', '择 剑 胚'));
  screen.appendChild(el('p', 'menu-intro', '五行乃剑意之根。选择初始凡铁剑意的五行倾向，第一道剑意将因此而生。'));

  const grid = el('div', 'embryo-grid');
  const elements: Element[] = ['metal', 'wood', 'water', 'fire', 'earth'];
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  for (const e of elements) {
    const card = el('div', 'embryo-card');
    card.style.setProperty('--el-color', hex(ELEMENT_COLOR[e]));
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    drawSwordIcon(canvas, e);
    const label = el('div', 'embryo-name', `${ELEMENT_LABEL[e]}行剑意`);
    const desc = el('div', 'embryo-desc', ELEMENT_DESC[e]);
    card.append(canvas, label, desc);
    card.addEventListener('click', () => game.startNewRun(e));
    grid.appendChild(card);
  }
  screen.appendChild(grid);

  if (game.hasSwordDust()) {
    screen.appendChild(el('p', 'menu-intro dim', '（已持有「剑尘」，将自动淬入剑胚，微量提升初始属性）'));
  }

  const back = el('button', 'btn btn-ghost', '← 返回');
  back.addEventListener('click', () => game.showMenu());
  screen.appendChild(back);
  host.appendChild(screen);
}
