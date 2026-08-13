/**
 * v2.5.0：剑谱视图——剑成鉴定页与名剑回看（万剑榜/名剑遗录）共用渲染。
 * 结构：出身 → 重大纪事 → 总结评语 → 完整纪事（可折叠）。
 */
import type { SwordTaleData } from '../types';
import { el } from '../utils/dom';
import { ELEMENT_LABEL } from '../simulation/Genetics';
import { SHICHEN_NAMES } from '../constants';

export function renderTaleContent(tale: SwordTaleData): { el: HTMLElement; heroEl: HTMLElement } {
  const wrap = el('div', 'appraisal-tale');
  const shichen = (n: number) => SHICHEN_NAMES[Math.min(SHICHEN_NAMES.length - 1, n)];

  const head = el('div', 'tale-head');
  head.appendChild(el('span', 'tale-title', tale.title));
  const heroEl = el('span', 'tale-hero', `${tale.heroName} · ${ELEMENT_LABEL[tale.element]}行`);
  head.appendChild(heroEl);
  wrap.appendChild(head);

  wrap.appendChild(el('p', 'tale-prologue', tale.prologue));
  wrap.appendChild(el('div', 'tale-section-label', '重 大 纪 事'));

  const epList = el('div', 'tale-episodes');
  for (const ep of tale.episodes) {
    const line = el('div', 'tale-ep');
    line.append(
      el('span', 'tale-time', `第${ep.day}日·${shichen(ep.shichen)}时`),
      el('span', 'tale-text', ep.text),
    );
    epList.appendChild(line);
  }
  if (tale.episodes.length === 0) epList.appendChild(el('p', 'empty', '此剑一生平静无波，未留多少传奇。'));
  wrap.appendChild(epList);

  wrap.appendChild(el('p', 'tale-summary', tale.summary));

  // 完整纪事（折叠区）
  if (tale.chronicle.length > 0) {
    const details = el('details', 'tale-chronicle');
    details.appendChild(el('summary', '', `完整纪事（${tale.chronicle.length} 条）`));
    const full = el('div', 'tale-chronicle-list');
    for (const c of tale.chronicle) {
      const line = el('div', 'tale-chronicle-line');
      line.append(
        el('span', 'tale-time', `第${c.day}日·${shichen(c.shichen)}时`),
        el('span', 'tale-text', c.text),
      );
      full.appendChild(line);
    }
    details.appendChild(full);
    wrap.appendChild(details);
  }
  return { el: wrap, heroEl };
}
