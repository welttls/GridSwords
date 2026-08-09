import type { Game } from '../Game';
import type { Genome } from '../types';
import { el, clearNode } from '../utils/dom';
import { drawSwordIcon } from './swordIcon';
import { ELEMENT_LABEL, ELEMENT_COLOR } from '../simulation/Genetics';
import type { SwordArt } from '../data/SwordArts';

export interface OpponentInfo {
  id: string;
  name: string;
  title: string;
  difficulty: number;
  genome: Genome;
  tags: string[];
  isNPC: boolean;
}

export interface BattleUI {
  getOpponent: () => string | null;
  getArt: () => string | null;
  setResult: (html: string, ok?: boolean) => void;
  setRunning: (running: boolean) => void;
  selectOpponent: (id: string) => void;
}

/** 宗门大比 · 试剑台 */
export function buildTournament(
  host: HTMLElement,
  game: Game,
  opponents: OpponentInfo[],
  playerGenome: Genome,
  playerName: string,
  arts: SwordArt[],
): BattleUI {
  clearNode(host);
  const screen = el('div', 'screen battle-screen');
  screen.appendChild(el('h2', 'menu-title small', '试 剑 台'));

  // 玩家剑意
  const playerRow = el('div', 'player-row');
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 56;
  pCanvas.height = 56;
  drawSwordIcon(pCanvas, playerGenome.element);
  const hex = `#${ELEMENT_COLOR[playerGenome.element].toString(16).padStart(6, '0')}`;
  playerRow.append(
    pCanvas,
    el('div', 'player-name', `${playerName} · ${ELEMENT_LABEL[playerGenome.element]}行本命剑`),
    el('div', 'player-stats', `锋锐${playerGenome.sharpness.toFixed(1)}　坚韧${playerGenome.toughness.toFixed(1)}　速度${playerGenome.speed.toFixed(1)}　感知${playerGenome.perception.toFixed(1)}`),
  );
  screen.appendChild(playerRow);

  // 剑诀选择 + 开战
  const ctrlRow = el('div', 'ctrl-row');
  const artSel = el('select', 'art-select') as HTMLSelectElement;
  for (const a of arts) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.name} —— ${a.description}`;
    artSel.appendChild(opt);
  }
  const startBtn = el('button', 'btn btn-gold', '开 战') as HTMLButtonElement;
  ctrlRow.append(el('span', 'ctrl-label', '剑诀'), artSel, startBtn);
  screen.appendChild(ctrlRow);

  // 主区域：斗剑台 + 对手列表
  const main = el('div', 'battle-main');
  const arenaWrap = el('div', 'arena-wrap');
  const canvasHost = el('div', 'canvas-host');
  arenaWrap.appendChild(canvasHost);
  const result = el('div', 'battle-result');
  result.appendChild(el('p', 'result-hint', '选择对手，选定剑诀，点击「开战」。'));
  arenaWrap.appendChild(result);

  const oppPanel = el('div', 'opponent-panel');
  oppPanel.appendChild(el('h3', 'section-title', '选择对手'));

  const listEl = el('div', 'opponent-list');
  let selectedId: string | null = opponents[0]?.id ?? null;

  for (const o of opponents) {
    const card = el('div', 'opponent-card' + (o.id === selectedId ? ' selected' : ''));
    const oCanvas = document.createElement('canvas');
    oCanvas.width = 44;
    oCanvas.height = 44;
    drawSwordIcon(oCanvas, o.genome.element);
    const info = el('div', 'opp-info');
    info.appendChild(el('div', 'opp-name', `${o.name} · ${o.title}`));
    info.appendChild(el('div', 'opp-desc', `${o.tags.map((t) => `「${t}」`).join(' ')}　·　难度 ×${o.difficulty}`));
    const isNPC = el('span', 'opp-type', o.isNPC ? '同门' : '名剑');
    card.append(oCanvas, info, isNPC);
    card.addEventListener('click', () => {
      selectedId = o.id;
      listEl.querySelectorAll('.opponent-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
    listEl.appendChild(card);
  }
  oppPanel.appendChild(listEl);
  main.append(arenaWrap, oppPanel);
  screen.appendChild(main);

  const back = el('button', 'btn btn-ghost', '← 返回主菜单');
  back.addEventListener('click', () => game.showMenu());
  screen.appendChild(back);

  host.appendChild(screen);

  const ui: BattleUI = {
    getOpponent: () => selectedId,
    getArt: () => artSel.value,
    setResult: (html: string, ok = true) => {
      clearNode(result);
      const box = el('div', ok ? 'result-ok' : 'result-fail');
      box.innerHTML = html;
      result.appendChild(box);
    },
    setRunning: (running: boolean) => {
      startBtn.disabled = running;
      startBtn.textContent = running ? '斗剑中…' : '开 战';
      artSel.disabled = running;
    },
    selectOpponent: (id: string) => {
      selectedId = id;
      listEl.querySelectorAll('.opponent-card').forEach((c) => c.classList.remove('selected'));
      const target = listEl.querySelector(`[data-opp="${id}"]`);
      target?.classList.add('selected');
    },
  };

  startBtn.addEventListener('click', () => {
    const opp = selectedId;
    const art = artSel.value;
    if (!opp) return;
    ui.setRunning(true);
    game.startTournament(opp, art, ui);
  });

  return ui;
}
