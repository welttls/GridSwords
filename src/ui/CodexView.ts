import type { Game } from '../Game';
import { el } from '../utils/dom';
import { openModal, openTaleModal } from './modals';
import { drawSwordIcon } from './swordIcon';
import { recipesSorted, unlockLabel } from '../data/RecipeDB';

/** 图鉴：已解锁材料 + 历史名剑 */
export function openCodex(game: Game): void {
  const body = el('div', 'codex-wrap');

  body.appendChild(el('h3', 'section-title', '投入物'));
  const grid = el('div', 'codex-grid');
  for (const m of recipesSorted()) {
    const unlocked = game.save.unlockedMaterialIds.includes(m.id);
    const card = el('div', 'codex-card' + (unlocked ? '' : ' locked'));
    card.append(
      el('div', 'codex-name', m.name),
      el('div', 'codex-desc', m.description),
      el('div', 'codex-unlock', unlocked ? '已解锁' : `🔒 ${unlockLabel(m.unlock)}`),
    );
    grid.appendChild(card);
  }
  body.appendChild(grid);

  body.appendChild(el('h3', 'section-title', '名剑遗录'));
  if (game.save.history.length === 0) {
    body.appendChild(el('p', 'empty', '尚无炼成的名剑。'));
  } else {
    const hist = el('div', 'rank-list');
    for (const s of game.save.history.slice(0, 10)) {
      const item = el('div', 'rank-item');
      const canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 40;
      drawSwordIcon(canvas, s.element);
      item.append(
        el('span', 'rank-name', s.name),
        canvas,
        el('span', 'rank-tags', s.tags.map((t) => `「${t}」`).join(' ')),
        el('span', 'rank-score', `${s.score}`),
      );
      // v2.5.0：点击条目重读剑谱
      if (s.tale) {
        item.classList.add('clickable', 'has-tale');
        item.addEventListener('click', () => openTaleModal(s.tale!));
      }
      hist.appendChild(item);
    }
    body.appendChild(hist);
  }

  openModal('图 鉴', body, { width: 680 });
}
