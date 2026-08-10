import type { Element } from '../types';
import { ELEMENT_COLOR } from '../simulation/Genetics';

/** 五行色 hex */
function elementHex(element: Element): string {
  return `#${ELEMENT_COLOR[element].toString(16).padStart(6, '0')}`;
}

/** 光晕 */
function drawGlow(ctx: CanvasRenderingContext2D, size: number, element: Element): void {
  const cx = size / 2;
  const cy = size / 2;
  const hex = elementHex(element);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
  grad.addColorStop(0, `${hex}33`);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
}

/** 程序化五行小剑 (占位/兜底，无需素材) */
function drawProceduralSword(ctx: CanvasRenderingContext2D, size: number, element: Element): void {
  const cx = size / 2;
  const cy = size / 2;
  const len = size * 0.38;
  const hex = elementHex(element);

  ctx.strokeStyle = hex;
  ctx.lineWidth = Math.max(2, size * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - len);
  ctx.lineTo(cx, cy + len);
  ctx.stroke();

  ctx.strokeStyle = '#e0b870';
  ctx.lineWidth = Math.max(1.5, size * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx - len * 0.42, cy);
  ctx.lineTo(cx + len * 0.42, cy);
  ctx.stroke();

  ctx.fillStyle = '#e0b870';
  ctx.beginPath();
  ctx.arc(cx, cy + len * 0.95, Math.max(2, size * 0.045), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 在 canvas 上绘制五行小剑 (用于卡片/鉴定/榜单)。
 * 立即绘制程序剑占位，异步加载五行色 katana 素材 (game-icons, CC BY 3.0) 后替换。
 */
/** 每个 canvas 的代际 token：防止同一 canvas 上一帧的 onload 晚于本次绘制覆盖成错误五行剑 */
const canvasGens = new WeakMap<HTMLCanvasElement, number>();
let iconSeq = 0;

export function drawSwordIcon(canvas: HTMLCanvasElement, element: Element): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = canvas.width;
  const gen = ++iconSeq;
  canvasGens.set(canvas, gen); // 记录本次绘制代际

  const paint = () => {
    ctx.clearRect(0, 0, size, size);
    drawGlow(ctx, size, element);
    drawProceduralSword(ctx, size, element);
  };
  paint();

  // 异步加载五行色剑图 (透明底 SVG)，加载完成即以真图重绘
  const img = new Image();
  img.onload = () => {
    if (canvasGens.get(canvas) !== gen) return; // 该 canvas 已被更新的绘制取代
    const c = canvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, size, size);
    drawGlow(c, size, element);
    const pad = size * 0.14;
    c.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
  };
  img.onerror = () => {
    /* 加载失败则保持程序剑占位 */
  };
  img.src = `img/swords/katana_${element}.svg`;
}
