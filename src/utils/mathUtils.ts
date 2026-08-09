/** 数值钳制 */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 高斯随机数 (Box-Muller) */
export function gaussianRandom(mean = 0, stddev = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** [min, max] 闭区间整数 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 随机取一个元素 */
export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Fisher-Yates 洗牌 (返回新数组) */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 线性插值 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 均值 */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** 生成唯一 id */
export function uid(prefix = 'sw'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 今日日期字符串 YYYY-MM-DD */
export function nowDateStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 随机中文剑名 */
export function randomSwordName(): string {
  const prefixes = ['青霜', '赤霄', '寒渊', '紫电', '流云', '破军', '惊鸿', '太阿', '承影', '湛卢', '鱼肠', '干将'];
  const suffixes = ['剑', '刃', '锋', '诀', '气', '芒', '影', '魄'];
  return `${pickRandom(prefixes)}${pickRandom(suffixes)}`;
}
