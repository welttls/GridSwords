import { el } from '../utils/dom';
import type { SwordTaleData } from '../types';
import { renderTaleContent } from './taleView';

/** 打开一个模态框，返回 overlay 元素 */
export function openModal(
  title: string,
  body: HTMLElement,
  opts: { onClose?: () => void; width?: number } = {},
): HTMLElement {
  const overlay = el('div', 'modal-overlay');
  const modal = el('div', 'modal');
  if (opts.width) modal.style.maxWidth = `${opts.width}px`;
  const head = el('div', 'modal-head');
  head.appendChild(el('h2', 'modal-title', title));
  const close = el('button', 'modal-close', '×');
  close.addEventListener('click', () => {
    overlay.remove();
    opts.onClose?.();
  });
  head.appendChild(close);
  modal.append(head, body);
  overlay.appendChild(modal);
  document.getElementById('app')!.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      opts.onClose?.();
    }
  });
  return overlay;
}

/** 顶部提示 toast (可点击) */
export function toast(msg: string, ms = 2600, onClick?: () => void): void {
  const t = el('div', 'toast', msg);
  if (onClick) {
    t.classList.add('clickable');
    t.addEventListener('click', () => {
      t.remove();
      onClick();
    });
  }
  document.getElementById('app')!.appendChild(t);
  window.setTimeout(() => t.remove(), ms);
}

/** v2.5.0：名剑回看——弹窗重读剑谱 */
export function openTaleModal(tale: SwordTaleData): void {
  const body = el('div', 'tale-modal-body');
  const { el: content } = renderTaleContent(tale);
  body.appendChild(content);
  openModal(`剑谱 · ${tale.heroName}`, body, { width: 560 });
}
