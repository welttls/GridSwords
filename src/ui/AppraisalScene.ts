import type { Game } from '../Game';
import type { Genome, Element } from '../types';
import type { SwordAgent } from '../simulation/SwordAgent';
import { el, clearNode } from '../utils/dom';
import { drawSwordIcon } from './swordIcon';
import { toast } from './modals';
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

/** 鉴定页属性/评分/特质的悬浮说明 */
const APPRAISE_TIPS: Record<string, string> = {
  锋锐: '攻伐之力：碰撞伤害 = 锋锐 − 敌方坚固×0.5（至少 1 点）；锋锐亦增暴击之威。锋刃越利，日常维持耗神越多。',
  坚韧: '防御之体：直接削弱所受伤害，反震亦轻。剑体越沉，行动越耗精元。',
  速度: '身法：越快则移动耗精元越多，宗门大比中蓄势越快、出手越频。',
  感知: '灵识：探查范围 = 感知×2 格；与对手比感知，感知高者闪避来剑更易。',
  杀性: '好战之心：越高越主动寻敌；杀性凶者易出暴击重创。',
  世代: '血脉传承的代数：本命剑胚为第 1 代，分化衍续则代代递增。',
  存续: '自诞生起存活的时间占比，越久说明越能自续。',
  评分: '剑成评分 = 存续×10 + 血脉相承×20 + 剑谱总和×0.5 + 本性殊异(≤15)。越高越是好剑。',
  血脉相承: '剑谱与最初剑胚的相似程度 ×20。血脉越是承继正脉，愈显纯粹。',
  剑谱总和: '五行属性（锋锐/坚韧/速度/感知）之和 ×0.5。剑体底子越厚越好。',
  本性殊异: '十日内体现出的独特本性（特质）越多越高，上限 15：基础 5 + 特质数×5。',
  斩念成性: '十日内击破 ≥ 3 敌，杀伐果决之证。',
  吞金成性: '十日内采气 ≥ 25 团，吞吐如意之证。',
  百炼之体: '剑体始终保持在极高水准（最低剑体 > 60），久战不坠之证。',
  游历万方: '足迹遍布 ≥ 200 格，身经百炼之证。',
  静若渊渟: '长时蛰伏（≥200 刻不动），藏锋守拙、不动如山。',
  雷劫余生: '曾历雷劫（炉府引雷）而仍存续，劫后余生之证。',
};

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
  nameRow.appendChild(el('div', 'name-label', '为你的本命剑命名'));
  const nameInput = el('input', 'name-input') as HTMLInputElement;
  nameInput.placeholder = '例：青锋 · 无垢';
  nameInput.maxLength = 12;
  nameRow.appendChild(nameInput);

  const tags = el('div', 'tags');
  for (const t of data.tags) {
    const badge = el('span', 'tag-badge tip', `「${t}」`);
    const tip = APPRAISE_TIPS[t];
    if (tip) badge.setAttribute('data-tip', tip);
    tags.appendChild(badge);
  }

  const scoreBox = el('div', 'score-box');
  const scoreTitle = el('div', 'score-title tip', '综合评分');
  scoreTitle.setAttribute('data-tip', APPRAISE_TIPS['评分'] ?? '');
  scoreBox.appendChild(scoreTitle);
  scoreBox.appendChild(el('div', 'score-num', `${data.score}`));
  const breakdown = el('div', 'breakdown');
  for (const b of data.breakdown) {
    const line = el('div', 'break-line', `${b.label}　+${b.value.toFixed(1)}`);
    // 评分明细说明：存续动态项 + 固定项
    if (b.label.startsWith('存续')) {
      line.classList.add('tip');
      line.setAttribute('data-tip', '存活越久越能自续：存续占比 ×10。');
    } else {
      const tip = APPRAISE_TIPS[b.label];
      if (tip) {
        line.classList.add('tip');
        line.setAttribute('data-tip', tip);
      }
    }
    breakdown.appendChild(line);
  }
  scoreBox.appendChild(breakdown);

  const radar = document.createElement('canvas');
  radar.width = 220;
  radar.height = 220;
  radar.className = 'radar-canvas';
  drawRadar(radar, data.winner.state.genome);

  const stats = el('div', 'final-stats');
  stats.append(
    statLine('锋锐', data.winner.state.genome.sharpness, APPRAISE_TIPS['锋锐']),
    statLine('坚韧', data.winner.state.genome.toughness, APPRAISE_TIPS['坚韧']),
    statLine('速度', data.winner.state.genome.speed, APPRAISE_TIPS['速度']),
    statLine('感知', data.winner.state.genome.perception, APPRAISE_TIPS['感知']),
    statLine('杀性', data.winner.state.genome.aggression, APPRAISE_TIPS['杀性']),
    statLine('世代', data.winner.state.generation, APPRAISE_TIPS['世代']),
    statLine('存续', `${Math.min(100, Math.floor((data.winner.state.age / data.totalTicks) * 100))}%`, APPRAISE_TIPS['存续']),
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
    if (submit.disabled) return; // 防重复提交
    submit.disabled = true;
    const name = (nameInput.value || '').trim() || '无名剑';
    toast(`本命剑「${name}」剑成！`);
    submit.textContent = '剑成，赴试剑台…';
    // 短暂停留让玩家确认命名生效，再进宗门大比
    window.setTimeout(() => game.finishAppraisal(name), 900);
  });
  footer.appendChild(submit);
  screen.appendChild(footer);

  host.appendChild(screen);
}

function statLine(label: string, value: number | string, tip?: string): HTMLElement {
  const row = el('div', 'stat-line');
  const lab = el('span', 'sl-label' + (tip ? ' tip' : ''), label);
  if (tip) lab.setAttribute('data-tip', tip);
  row.append(lab, el('span', 'sl-value', String(typeof value === 'number' ? value.toFixed(1) : value)));
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
