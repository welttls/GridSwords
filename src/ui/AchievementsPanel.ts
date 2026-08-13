/**
 * v2.5.0：成就面板——按分类展示，已解锁 🏆 高亮 / 未解锁 🔒 灰显。
 */
import type { Game } from '../Game';
import { el } from '../utils/dom';
import { openModal } from './modals';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_CATEGORY } from '../data/Achievements';

export function openAchievements(game: Game): void {
  const body = el('div', 'ach-wrap');
  const unlocked = game.save.achievements;

  for (const cat of ACHIEVEMENTS_BY_CATEGORY) {
    body.appendChild(el('h3', 'section-title', cat.label));
    const list = ACHIEVEMENTS.filter((a) => a.category === cat.key);
    const grid = el('div', 'ach-grid');
    if (list.length === 0) {
      grid.appendChild(el('p', 'empty', '暂无此分类成就。'));
    }
    for (const a of list) {
      const has = unlocked.includes(a.id);
      const card = el('div', 'ach-card' + (has ? ' unlocked' : ''));
      card.append(
        el('div', 'ach-name', `${has ? '🏆' : '🔒'} ${a.name}`),
        el('div', 'ach-desc', a.desc),
      );
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  openModal(`成 就（${unlocked.length}/${ACHIEVEMENTS.length}）`, body, { width: 560 });
}
