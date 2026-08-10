import type { Game } from '../Game';
import { el } from '../utils/dom';
import { openModal } from './modals';
import { recipesSorted, unlockLabel } from '../data/RecipeDB';

/** 每日剑潮类型 */
export type DailyDropKind = 'mild' | 'tide' | 'fierce' | 'auto' | 'none';

export const DROP_OPTIONS: { kind: DailyDropKind; name: string; desc: string }[] = [
  { kind: 'mild', name: '温养之潮', desc: '剑意温和而感知过人，来得少而稳。' },
  { kind: 'tide', name: '剑潮汹涌', desc: '大量剑意自天外涌入，良莠不齐，厮杀在所难免。' },
  { kind: 'fierce', name: '天外凶潮', desc: '凶剑裹挟杀意降临，数目少却个个凶悍。' },
  { kind: 'none', name: '静待天时', desc: '今日不投剑意，听凭剑域自生自灭。' },
];

/**
 * 炉府材料面板：道具次数使用，随时可用，改变整个炼剑炉的属性。
 */
export function openFurnacePanel(game: Game, onClose?: () => void): void {
  const unlocked = new Set(game.save.unlockedMaterialIds);
  const counts = game.save.materialCounts;
  const body = el('div', 'material-list');

  for (const m of recipesSorted()) {
    if (m.effect.type === 'swordDust') continue; // 开局专用
    // P1-13：缺键回退 0 而非 m.count，与实际消耗口径 (materialCounts[id] ?? 0) 保持一致
    const remaining = unlocked.has(m.id) ? counts[m.id] ?? 0 : 0;
    const card = el('div', 'material-card' + (remaining <= 0 ? ' locked' : ''));
    const name = el('div', 'material-name', `${m.name} ×${remaining}`);
    const desc = el('div', 'material-desc', m.description);
    if (remaining > 0) {
      card.append(name, desc);
      card.addEventListener('click', () => {
        overlay.remove();
        game.applyMaterial(m.id);
        onClose?.();
      });
    } else if (unlocked.has(m.id)) {
      card.append(name, el('div', 'material-lock', '已耗尽'));
    } else {
      card.append(name, el('div', 'material-lock', `🔒 ${unlockLabel(m.unlock)} 解锁`));
    }
    body.appendChild(card);
  }

  const overlay = openModal('炉府材料 · 以次数计', body, { width: 560, onClose });
}

/**
 * 每日子时剑潮投放：玩家选择本日剑潮，或默许天意 (自动随机)。
 */
export function openDailyDropPanel(
  game: Game,
  day: number,
  onClose?: () => void,
): void {
  const body = el('div', 'drop-panel');
  body.appendChild(el('p', 'drop-intro', `第 ${day} 日子时，游离剑意自天外涌来。择其一道，或默许天意。`));

  let chosen = false;

  const list = el('div', 'material-list');
  for (const o of DROP_OPTIONS) {
    const card = el('div', 'material-card');
    card.append(el('div', 'material-name', o.name), el('div', 'material-desc', o.desc));
    card.addEventListener('click', () => {
      chosen = true;
      overlay.remove();
      game.chooseDailyDrop(o.kind);
      onClose?.();
    });
    list.appendChild(card);
  }
  body.appendChild(list);

  const auto = el('button', 'btn btn-ghost', '默许天意');
  auto.addEventListener('click', () => {
    chosen = true;
    overlay.remove();
    game.chooseDailyDrop('auto');
    onClose?.();
  });
  body.appendChild(auto);

  const overlay = openModal('子时 · 剑潮至', body, {
    width: 520,
    onClose: () => {
      if (!chosen) game.chooseDailyDrop('auto'); // 未选择 → 默许天意
      onClose?.();
    },
  });
}
