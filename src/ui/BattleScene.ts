import type { Game } from '../Game';
import type { Genome, Element } from '../types';
import { el, clearNode } from '../utils/dom';
import { drawSwordIcon } from './swordIcon';
import { ELEMENT_LABEL, ELEMENT_COLOR } from '../simulation/Genetics';
import { affixName } from '../data/AffixDB';
import type { SwordArt } from '../data/SwordArts';
import type { DuelEvent } from '../simulation/Duel';

export interface OpponentInfo {
  id: string;
  name: string;
  title: string;
  difficulty: number;
  genome: Genome;
  tags: string[];
  isNPC: boolean;
}

export interface DuelFighterView {
  name: string;
  element: Element;
  affixes: string[];
  art?: string;
  isPlayer?: boolean;
  title?: string;
}

export interface BattleUI {
  getOpponent: () => string | null;
  getArt: () => string | null;
  setResult: (html: string, ok?: boolean) => void;
  setRunning: (running: boolean) => void;
  selectOpponent: (id: string) => void;
  /** 展开决斗舞台 (左右双剑) */
  showDuel: (p: DuelFighterView, n: DuelFighterView) => void;
  /** 每帧推送事件与双方状态 */
  pushEvents: (events: DuelEvent[], p: { hp: number; energy: number; ap: number }, n: { hp: number; energy: number; ap: number }) => void;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** 宗门大比 · 试剑台 (半即时决斗 + 文字 MUD) */
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

  // 玩家本命剑
  const playerRow = el('div', 'player-row');
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 56;
  pCanvas.height = 56;
  drawSwordIcon(pCanvas, playerGenome.element);
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

  // ===== 决斗舞台 (左右双剑) =====
  const stage = el('div', 'duel-stage hidden');
  const left = el('div', 'duel-side');
  const lCanvas = document.createElement('canvas');
  lCanvas.width = 96;
  lCanvas.height = 96;
  const lName = el('div', 'duel-name');
  const lTitle = el('div', 'duel-title');
  const lHp = el('div', 'duel-bar');
  const lHpFill = el('div', 'duel-fill');
  const lEnergy = el('div', 'duel-bar slim');
  const lEnergyFill = el('div', 'duel-fill');
  const lAp = el('div', 'duel-bar ap');
  const lApFill = el('div', 'duel-fill');
  lHp.appendChild(lHpFill);
  lEnergy.appendChild(lEnergyFill);
  lAp.appendChild(lApFill);
  const lAffix = el('div', 'duel-affixes');
  left.append(lCanvas, lName, lTitle, lHp, lEnergy, lAp, lAffix);

  const middle = el('div', 'duel-mid');
  middle.appendChild(el('div', 'duel-vs', '⚔'));
  middle.appendChild(el('div', 'duel-vs-text', '剑 试 高 下'));

  const right = el('div', 'duel-side');
  const rCanvas = document.createElement('canvas');
  rCanvas.width = 96;
  rCanvas.height = 96;
  const rName = el('div', 'duel-name');
  const rTitle = el('div', 'duel-title');
  const rHp = el('div', 'duel-bar');
  const rHpFill = el('div', 'duel-fill');
  const rEnergy = el('div', 'duel-bar slim');
  const rEnergyFill = el('div', 'duel-fill');
  const rAp = el('div', 'duel-bar ap');
  const rApFill = el('div', 'duel-fill');
  rHp.appendChild(rHpFill);
  rEnergy.appendChild(rEnergyFill);
  rAp.appendChild(rApFill);
  const rAffix = el('div', 'duel-affixes');
  right.append(rCanvas, rName, rTitle, rHp, rEnergy, rAp, rAffix);

  const duelTop = el('div', 'duel-top');
  duelTop.append(left, middle, right);

  const logBox = el('div', 'duel-log');
  const resultBox = el('div', 'duel-result hidden');
  stage.append(duelTop, resultBox, logBox);

  // ===== 对手选择 =====
  const oppPanel = el('div', 'opponent-panel');
  oppPanel.appendChild(el('h3', 'section-title', '选择对手'));
  const listEl = el('div', 'opponent-list');
  let selectedId: string | null = opponents[0]?.id ?? null;

  for (const o of opponents) {
    const card = el('div', 'opponent-card' + (o.id === selectedId ? ' selected' : ''));
    card.dataset.opp = o.id;
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

  const main = el('div', 'battle-main');
  main.append(stage, oppPanel);
  screen.appendChild(main);

  const back = el('button', 'btn btn-ghost', '← 返回主菜单');
  back.addEventListener('click', () => game.showMenu());
  screen.appendChild(back);

  host.appendChild(screen);

  const ui: BattleUI = {
    getOpponent: () => selectedId,
    getArt: () => artSel.value,
    setResult: (html: string, ok = true) => {
      clearNode(resultBox);
      resultBox.classList.remove('hidden');
      const box = el('div', ok ? 'result-ok' : 'result-fail');
      box.innerHTML = html;
      resultBox.appendChild(box);
    },
    setRunning: (running: boolean) => {
      startBtn.disabled = running;
      startBtn.textContent = running ? '斗剑中…' : '开 战';
      artSel.disabled = running;
      oppPanel.classList.toggle('disabled', running);
      if (running) {
        stage.classList.remove('hidden');
        clearNode(logBox);
        resultBox.classList.add('hidden');
        oppPanel.classList.add('minimized');
      }
    },
    selectOpponent: (id: string) => {
      selectedId = id;
      listEl.querySelectorAll('.opponent-card').forEach((c) => c.classList.remove('selected'));
      const target = listEl.querySelector(`[data-opp="${id}"]`);
      target?.classList.add('selected');
    },
    showDuel: (p, n) => {
      drawSwordIcon(lCanvas, p.element);
      lName.textContent = p.name;
      lTitle.textContent = p.isPlayer ? '本命剑' : p.title ?? '';
      drawSwordIcon(rCanvas, n.element);
      rName.textContent = n.name;
      rTitle.textContent = n.title ?? '';
      const setAffixes = (elBox: HTMLElement, affixes: string[]) => {
        clearNode(elBox);
        for (const a of affixes) {
          const tag = el('span', 'duel-affix', `「${affixName(a)}」`);
          tag.title = a;
          elBox.appendChild(tag);
        }
      };
      setAffixes(lAffix, p.affixes);
      setAffixes(rAffix, n.affixes);
    },
    pushEvents: (events, p, n) => {
      for (const e of events) {
        const line = el('div', 'duel-log-line ' + e.kind + (e.actor === 'player' ? ' from-player' : ' from-npc'));
        line.textContent = e.text;
        logBox.appendChild(line);
        logBox.scrollTop = logBox.scrollHeight;
      }
      const fill = (bar: HTMLElement, ratio: number, color: string) => {
        bar.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
        bar.style.background = color;
      };
      fill(lHpFill, p.hp / 100, p.hp > 50 ? '#6fd08a' : p.hp > 25 ? '#ffc24a' : '#ff4a4a');
      fill(lEnergyFill, p.energy / 100, '#5aa9ff');
      fill(lApFill, p.ap / 20, '#ffd76a');
      fill(rHpFill, n.hp / 100, n.hp > 50 ? '#6fd08a' : n.hp > 25 ? '#ffc24a' : '#ff4a4a');
      fill(rEnergyFill, n.energy / 100, '#5aa9ff');
      fill(rApFill, n.ap / 20, '#ffd76a');
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
