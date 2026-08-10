/**
 * 全局悬浮解释 (v1.12.0)
 * 原 `.tip:hover::after` 伪元素在滚动容器（灵鉴等）内会被 `overflow` 裁剪——
 * 如右侧「精元」列浮窗显示不全。现改为 body 级单一 fixed 提示层，
 * 由 JS 定位并钳制在视口内（空间不足自动翻到下方/夹左右）。
 */
let tipEl: HTMLDivElement | null = null;
let current: HTMLElement | null = null;

function ensureTip(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'ui-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function positionTip(target: HTMLElement): void {
  const el = ensureTip();
  const text = target.getAttribute('data-tip');
  if (!text) return;
  el.textContent = text;
  const rect = target.getBoundingClientRect();
  const pad = 10;
  // 先隐藏测量尺寸（max-width 约束下获取实际宽高）
  el.style.visibility = 'hidden';
  el.style.display = 'block';
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  // 默认显示在元素上方；上方放不下则翻到下方
  let top = rect.top - th - 8;
  let below = false;
  if (top < pad) {
    top = rect.bottom + 8;
    below = true;
  }
  // 视口上下夹紧（翻到下方仍超界则再压回上方）
  if (top + th > window.innerHeight - pad) {
    top = below ? rect.top - th - 8 : window.innerHeight - th - pad;
    if (top < pad) top = pad;
  }
  // 水平居中 + 视口左右夹紧
  let left = rect.left + rect.width / 2 - tw / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
  el.style.visibility = 'visible';
}

function showTip(target: HTMLElement): void {
  current = target;
  const el = ensureTip();
  el.style.display = 'block';
  positionTip(target);
}

function hideTip(): void {
  if (tipEl) tipEl.style.display = 'none';
  current = null;
}

/** 初始化：document 级事件委托，任何 `.tip[data-tip]` 元素悬浮即显示 */
export function initTooltips(): void {
  document.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest?.('.tip[data-tip]') as HTMLElement | null;
    if (t) {
      if (t !== current) showTip(t);
    } else {
      hideTip();
    }
  });
  // 鼠标在元素内移动时跟随重定位（保持贴合物件）
  document.addEventListener('mousemove', (e) => {
    if (!current) return;
    const t = (e.target as HTMLElement).closest?.('.tip[data-tip]');
    if (t === current) positionTip(current);
  });
  document.addEventListener('mouseleave', hideTip);
  // 点击任意处（含关闭弹窗）即隐藏，防残留
  document.addEventListener('click', hideTip);
  // 任何滚动（捕获阶段）隐藏，避免提示层错位悬空
  document.addEventListener('scroll', hideTip, true);
  window.addEventListener('blur', hideTip);
}
