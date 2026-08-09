import type { Game } from '../Game';
import type { Genome, Element } from '../types';
import type { SwordAgent } from '../simulation/SwordAgent';
import { el, clearNode } from '../utils/dom';
import { drawSwordIcon } from './swordIcon';
import { ELEMENT_LABEL, ELEMENT_COLOR } from '../simulation/Genetics';

export interface EvoNode {
  id: string;
  generation: number;
  day: number;
  label: string;
  children: number;
  element: Element;
  isWinner?: boolean;
}

export interface AppraisalData {
  winner: SwordAgent;
  score: number;
  breakdown: { label: string; value: number }[];
  tags: string[];
  tree: EvoNode[];
  populationHistory: number[];
  totalTicks: number;
}

/** 剑成鉴定演出 */
export function buildAppraisal(host: HTMLElement, game: Game, data: AppraisalData): void {
  clearNode(host);
  const screen = el('div', 'screen appraisal-screen');
  screen.appendChild(el('h2', 'menu-title small', '剑 成 鉴 定'));

  const layout = el('div', 'appraisal-layout');

  // —— 左：本命剑 ——
  const left = el('div', 'appraisal-left');
  const big = document.createElement('canvas');
  big.width = 180;
  big.height = 180;
  big.className = 'sword-big';
  drawSwordIcon(big, data.winner.state.genome.element);

  const nameRow = el('div', 'name-row');
  const nameInput = el('input', 'name-input') as HTMLInputElement;
  nameInput.placeholder = '为本命剑命名';
  nameInput.maxLength = 12;
  nameRow.appendChild(nameInput);

  const tags = el('div', 'tags');
  for (const t of data.tags) tags.appendChild(el('span', 'tag-badge', `「${t}」`));

  const scoreBox = el('div', 'score-box');
  scoreBox.appendChild(el('div', 'score-title', '综合评分'));
  scoreBox.appendChild(el('div', 'score-num', `${data.score}`));
  const breakdown = el('div', 'breakdown');
  for (const b of data.breakdown) {
    breakdown.appendChild(el('div', 'break-line', `${b.label}　+${b.value.toFixed(1)}`));
  }
  scoreBox.appendChild(breakdown);

  const radar = document.createElement('canvas');
  radar.width = 220;
  radar.height = 220;
  radar.className = 'radar-canvas';
  drawRadar(radar, data.winner.state.genome);

  const stats = el('div', 'final-stats');
  stats.append(
    statLine('锋锐', data.winner.state.genome.sharpness),
    statLine('坚韧', data.winner.state.genome.toughness),
    statLine('速度', data.winner.state.genome.speed),
    statLine('感知', data.winner.state.genome.perception),
    statLine('杀性', data.winner.state.genome.aggression),
    statLine('世代', data.winner.state.generation),
    statLine('存续', `${Math.min(100, Math.floor((data.winner.state.age / data.totalTicks) * 100))}%`),
  );

  left.append(big, nameRow, tags, scoreBox, radar, stats);

  // —— 右：演化之树 + 剑潮起落 ——
  const right = el('div', 'appraisal-right');
  right.appendChild(el('h3', 'section-title', '悟道之树'));

  const tree = el('div', 'evo-tree');
  data.tree.forEach((n, i) => {
    const node = el('div', 'evo-node' + (n.isWinner ? ' winner' : ''));
    node.style.setProperty('--el', `#${ELEMENT_COLOR[n.element].toString(16).padStart(6, '0')}`);
    node.appendChild(el('span', 'evo-gen', `第${n.generation}代`));
    node.appendChild(el('span', 'evo-info', `${n.day ? `第${n.day}日 · ` : ''}${ELEMENT_LABEL[n.element]}行${n.label}`));
    node.appendChild(el('span', 'evo-kids', `衍${n.children}`));
    tree.appendChild(node);
    if (i < data.tree.length - 1) tree.appendChild(el('div', 'evo-line', '│'));
  });
  right.appendChild(tree);

  right.appendChild(el('h3', 'section-title', '剑潮起落'));
  const pop = document.createElement('canvas');
  pop.width = 440;
  pop.height = 90;
  pop.className = 'pop-canvas';
  drawPopulation(pop, data.populationHistory);
  right.appendChild(pop);

  layout.append(left, right);
  screen.appendChild(layout);

  const footer = el('div', 'appraisal-footer');
  const submit = el('button', 'btn btn-gold', '命名 · 赴宗门大比');
  submit.addEventListener('click', () => {
    const name = (nameInput.value || '无名剑').trim();
    game.finishAppraisal(name || '无名剑');
  });
  footer.appendChild(submit);
  screen.appendChild(footer);

  host.appendChild(screen);
}

function statLine(label: string, value: number | string): HTMLElement {
  const row = el('div', 'stat-line');
  row.append(el('span', 'sl-label', label), el('span', 'sl-value', String(typeof value === 'number' ? value.toFixed(1) : value)));
  return row;
}

/** 四维雷达图 */
export function drawRadar(canvas: HTMLCanvasElement, genome: Genome): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cx = 110;
  const cy = 110;
  const R = 78;
  ctx.clearRect(0, 0, 220, 220);
  const keys: (keyof Genome)[] = ['sharpness', 'toughness', 'speed', 'perception'];
  const labels = ['锋锐', '坚韧', '速度', '感知'];
  const angles = keys.map((_, i) => -Math.PI / 2 + (i * Math.PI * 2) / keys.length);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    angles.forEach((a, i) => {
      const x = cx + Math.cos(a) * R * (ring / 4);
      const y = cy + Math.sin(a) * R * (ring / 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  angles.forEach((a) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();
  });

  const values = keys.map((k) => Math.min(1, (genome[k] as number) / 10));
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = cx + Math.cos(angles[i]) * R * v;
    const y = cy + Math.sin(angles[i]) * R * v;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(120,170,255,0.25)';
  ctx.fill();
  ctx.strokeStyle = '#8ab4ff';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.lineWidth = 1;

  ctx.fillStyle = '#c8d0e0';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  labels.forEach((l, i) => {
    ctx.fillText(l, cx + Math.cos(angles[i]) * (R + 18), cy + Math.sin(angles[i]) * (R + 18));
  });
}

/** 种群数量折线图 */
export function drawPopulation(canvas: HTMLCanvasElement, history: number[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (history.length < 2) return;

  const max = Math.max(1, ...history);
  const stepX = W / (history.length - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(138,180,255,0.5)');
  grad.addColorStop(1, 'rgba(138,180,255,0.02)');

  ctx.beginPath();
  history.forEach((v, i) => {
    const x = i * stepX;
    const y = H - (v / max) * (H - 8) - 4;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#8ab4ff';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1;
}
