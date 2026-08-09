/** 轻量 DOM 构建助手 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clearNode(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function appendChildren(parent: HTMLElement, ...children: (Node | null | undefined)[]): void {
  for (const c of children) {
    if (c) parent.appendChild(c);
  }
}

/** 简易防抖 */
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

/** 格式化数字 (万为单位) */
export function fmt(n: number, digits = 0): string {
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toFixed(digits);
}
