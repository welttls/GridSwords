import type { Game } from '../Game';
import { el } from '../utils/dom';
import { openModal, openTaleModal } from './modals';
import { drawSwordIcon } from './swordIcon';

/** 万剑榜 (本地前20) */
export function openRanking(game: Game): void {
  const body = el('div', 'rank-list');
  const list = game.save.history;
  if (list.length === 0) {
    body.appendChild(el('p', 'empty', '万剑榜空无一物，待君执剑而来。'));
  }
  list.slice(0, 20).forEach((s, i) => {
    const item = el('div', 'rank-item' + (i < 3 ? ` top${i + 1}` : ''));
    if (s.tale) item.classList.add('has-tale'); // v2.5.0：有剑谱可回看
    const num = el('span', 'rank-num', `#${i + 1}`);
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    drawSwordIcon(canvas, s.element);
    const name = el('span', 'rank-name', s.name);
    const tags = el('span', 'rank-tags', s.tags.map((t) => `「${t}」`).join(' '));
    const meta = el('span', 'rank-meta', `${s.date} · 胜${s.wins}`);
    const score = el('span', 'rank-score', `${s.score}`);
    item.append(num, canvas, name, tags, meta, score);
    // v2.5.0：点击条目重读剑谱
    if (s.tale) {
      item.classList.add('clickable');
      item.addEventListener('click', () => openTaleModal(s.tale!));
    }
    body.appendChild(item);
  });
  openModal('万 剑 榜', body, { width: 660 });
}
