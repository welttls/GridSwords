import type { Element } from '../types';
import { ELEMENT_COLOR } from '../simulation/Genetics';

/** 在 canvas 上绘制一柄五行小剑 (用于卡片/鉴定/榜单) */
export function drawSwordIcon(canvas: HTMLCanvasElement, element: Element): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const len = size * 0.38;
  const hex = `#${ELEMENT_COLOR[element].toString(16).padStart(6, '0')}`;

  // 光晕
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
  grad.addColorStop(0, `${hex}33`);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

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
