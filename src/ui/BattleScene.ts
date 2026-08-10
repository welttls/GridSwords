import type { Game } from '../Game';
import type { Genome, Element } from '../types';
import { el, clearNode } from '../utils/dom';
import { drawSwordIcon } from './swordIcon';
import { ELEMENT_LABEL, ELEMENT_COLOR } from '../simulation/Genetics';
import { affixName } from '../data/AffixDB';
import type { SwordArt } from '../data/SwordArts';
import type { DuelEvent, DuelTechnique, DuelSideId, DuelFx } from '../simulation/Duel';

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

export interface FighterBar {
  hp: number;
  maxHp: number;
  energy: number;
  ap: number;
}

export interface BattleUI {
  getOpponent: () => string | null;
  getArt: () => string | null;
  setResult: (html: string, ok?: boolean) => void;
  setRunning: (running: boolean) => void;
  selectOpponent: (id: string) => void;
  /** 展开决斗舞台 (左右双剑 + 场景) */
  showDuel: (p: DuelFighterView, n: DuelFighterView) => void;
  /** 每帧推送事件(含前冲/大字/粒子动画)与双方状态 */
  pushEvents: (events: DuelEvent[], p: FighterBar, n: FighterBar) => void;
  /** 玩家行动条满：展示招式选择 */
  showTechniqueChoice: (techs: DuelTechnique[], onChoose: (id: string) => void) => void;
  /** 隐藏招式选择 (出招后) */
  hideTechniqueChoice: () => void;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** 宗门大比 · 试剑台 (场景决斗：前冲 + 碰撞粒子 + 大字招式 + 玩家选招) */
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

  // ===== 决斗场景 (左右双剑 + 场地) =====
  const stage = el('div', 'duel-stage hidden');
  const field = el('div', 'duel-field');
  const left = el('div', 'duel-side left-side');
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
  const lHpText = el('div', 'duel-hp-text');
  lHp.appendChild(lHpFill);
  lEnergy.appendChild(lEnergyFill);
  lAp.appendChild(lApFill);
  const lAffix = el('div', 'duel-affixes');
  left.append(lCanvas, lName, lTitle, lHp, lEnergy, lAp, lHpText, lAffix);

  const right = el('div', 'duel-side right-side');
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
  const rHpText = el('div', 'duel-hp-text');
  rHp.appendChild(rHpFill);
  rEnergy.appendChild(rEnergyFill);
  rAp.appendChild(rApFill);
  const rAffix = el('div', 'duel-affixes');
  right.append(rCanvas, rName, rTitle, rHp, rEnergy, rAp, rHpText, rAffix);

  // 场景：地面 + 两侧剑气蓄势
  field.append(left, el('div', 'duel-ground'), right);

  // 大招大字
  const techTitle = el('div', 'duel-tech-title hidden');

  // 玩家招式选择
  const choicePanel = el('div', 'duel-choice hidden');
  choicePanel.appendChild(el('div', 'duel-choice-hint', '行动条已满 — 请选择招式'));
  const choiceBtns = el('div', 'duel-choice-btns');

  const logBox = el('div', 'duel-log');
  const resultBox = el('div', 'duel-result hidden');
  stage.append(techTitle, field, choicePanel, resultBox, logBox);

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

  /** 碰撞粒子 (DOM) */
  function burst(cx: number, cy: number, color: string, count = 12): void {
    for (let i = 0; i < count; i++) {
      const p = el('div', 'duel-particle');
      const ang = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90;
      p.style.background = color;
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.setProperty('--dx', `${Math.cos(ang) * sp}px`);
      p.style.setProperty('--dy', `${Math.sin(ang) * sp}px`);
      p.style.setProperty('--ps', `${0.5 + Math.random() * 0.5}s`);
      field.appendChild(p);
      window.setTimeout(() => p.remove(), 900);
    }
  }

  /** 技能专属特效 (DOM 动画，按招式类型区分) */
  function playFx(fx: DuelFx, attacker: HTMLElement, defender: HTMLElement, color: string): void {
    const ac = attacker.querySelector('canvas');
    const dc = defender.querySelector('canvas');
    if (!ac || !dc) return;
    const f = field.getBoundingClientRect();
    const a = ac.getBoundingClientRect();
    const d = dc.getBoundingClientRect();
    const ax = a.left - f.left + a.width / 2;
    const ay = a.top - f.top + a.height / 2;
    const dx = d.left - f.left + d.width / 2;
    const dy = d.top - f.top + d.height / 2;
    const dist = Math.hypot(dx - ax, dy - ay);
    const ang = Math.atan2(dy - ay, dx - ax);
    const mk = (cls: string) => {
      const e = el('div', 'duel-fx ' + cls);
      field.appendChild(e);
      window.setTimeout(() => e.remove(), 1100);
      return e;
    };
    switch (fx) {
      case 'slash': {
        const s = mk('df-slash');
        s.style.width = `${Math.max(60, dist * 0.9)}px`;
        s.style.left = `${ax}px`;
        s.style.top = `${ay}px`;
        s.style.setProperty('--ang', `${ang}rad`);
        s.style.setProperty('--dist', `${Math.max(60, dist)}px`);
        s.style.background = `linear-gradient(90deg, transparent 0%, ${color} 40%, #ffffff 100%)`;
        break;
      }
      case 'beam': {
        const b = mk('df-beam');
        b.style.left = `${Math.min(ax, dx)}px`;
        b.style.top = `${(ay + dy) / 2 - 5}px`;
        b.style.width = `${dist}px`;
        b.style.background = `linear-gradient(90deg, ${color}, #ffffff 55%, ${color})`;
        break;
      }
      case 'blast': {
        const bo = mk('df-blast');
        bo.style.left = `${dx - 30}px`;
        bo.style.top = `${dy - 30}px`;
        bo.style.borderColor = color;
        bo.style.boxShadow = `0 0 26px 6px ${color}`;
        break;
      }
      case 'drain': {
        const dl = mk('df-drain');
        dl.style.width = `${dist}px`;
        dl.style.left = `${dx}px`;
        dl.style.top = `${dy}px`;
        dl.style.setProperty('--ang', `${ang + Math.PI}rad`);
        const g = mk('df-heal-flash');
        g.style.left = `${ax - 24}px`;
        g.style.top = `${ay - 24}px`;
        g.style.background = `radial-gradient(circle, rgba(111,208,138,.85), transparent 70%)`;
        break;
      }
      case 'poison': {
        const p = mk('df-poison');
        p.style.left = `${dx - 30}px`;
        p.style.top = `${dy - 30}px`;
        break;
      }
      case 'heal': {
        const h = mk('df-heal');
        h.style.left = `${ax - 18}px`;
        h.style.top = `${ay - 40}px`;
        h.style.background = `linear-gradient(180deg, ${color}, rgba(111,208,138,0))`;
        break;
      }
      case 'shield': {
        const sh = mk('df-shield');
        sh.style.left = `${ax - 34}px`;
        sh.style.top = `${ay - 34}px`;
        sh.style.borderColor = color;
        sh.style.boxShadow = `0 0 20px 2px ${color} inset, 0 0 14px 1px ${color}`;
        break;
      }
      case 'dash': {
        for (let i = 1; i <= 3; i++) {
          const g = mk('df-dash');
          g.style.left = `${ax - 30 + i * 8}px`;
          g.style.top = `${ay - 30}px`;
          g.style.setProperty('--i', String(i));
          g.style.borderColor = color;
        }
        break;
      }
      case 'heavy': {
        const hw = mk('df-heavy');
        hw.style.left = `${dx - 35}px`;
        hw.style.top = `${dy - 35}px`;
        hw.style.borderColor = color;
        hw.style.boxShadow = `0 0 22px 4px ${color}`;
        break;
      }
      default:
        break;
    }
  }

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

        // 招式动画：大字 + 前冲 + 碰撞粒子 + 技能专属特效
        if (e.techName) {
          const attacker = e.actor === 'player' ? left : right;
          const defender = e.actor === 'player' ? right : left;
          const color = e.actor === 'player' ? '#ffd76a' : '#c48aff';
          // 大字
          techTitle.classList.remove('hidden');
          techTitle.textContent = `${e.techName}！`;
          techTitle.classList.remove('show');
          void techTitle.offsetWidth; // 重置动画
          techTitle.classList.add('show');
          window.setTimeout(() => techTitle.classList.add('hidden'), 950);
          // 攻击类招式：前冲 + 碰撞粒子 + 受击 (回复/护盾类只在自身放特效，不出击)
          const fx = e.fx ?? 'strike';
          const isAttack = fx !== 'heal' && fx !== 'shield';
          if (isAttack) {
            attacker.classList.add('lunging');
            window.setTimeout(() => {
              attacker.classList.remove('lunging');
              // 碰撞粒子 (落在守方位置)
              const dCanvas = defender.querySelector('canvas');
              if (dCanvas) {
                const r = dCanvas.getBoundingClientRect();
                const f = field.getBoundingClientRect();
                burst(r.left - f.left + r.width / 2, r.top - f.top + r.height / 2, color, e.kind === 'crit' ? 20 : 12);
              }
              defender.classList.add('shaken');
              window.setTimeout(() => defender.classList.remove('shaken'), 350);
            }, 260);
          }
          // 技能专属特效
          if (fx && fx !== 'strike') playFx(fx, attacker, defender, color);
        }
      }
      const fill = (bar: HTMLElement, ratio: number, color: string) => {
        bar.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
        bar.style.background = color;
      };
      fill(lHpFill, p.hp / p.maxHp, p.hp / p.maxHp > 0.5 ? '#6fd08a' : p.hp / p.maxHp > 0.25 ? '#ffc24a' : '#ff4a4a');
      fill(lEnergyFill, p.energy / 100, '#5aa9ff');
      fill(lApFill, p.ap / 100, '#ffd76a');
      fill(rHpFill, n.hp / n.maxHp, n.hp / n.maxHp > 0.5 ? '#6fd08a' : n.hp / n.maxHp > 0.25 ? '#ffc24a' : '#ff4a4a');
      fill(rEnergyFill, n.energy / 100, '#5aa9ff');
      fill(rApFill, n.ap / 100, '#ffd76a');
      lHpText.textContent = `${Math.max(0, Math.round(p.hp))} / ${p.maxHp}`;
      rHpText.textContent = `${Math.max(0, Math.round(n.hp))} / ${n.maxHp}`;
    },
    showTechniqueChoice: (techs, onChoose) => {
      clearNode(choiceBtns);
      for (const t of techs) {
        const btn = el('button', 'btn duel-tech-btn', '');
        btn.append(
          el('span', 'duel-tech-name', `${t.name} · ${t.source}`),
          el('span', 'duel-tech-desc', t.desc),
        );
        btn.addEventListener('click', () => onChoose(t.id));
        choiceBtns.appendChild(btn);
      }
      choicePanel.appendChild(choiceBtns);
      choicePanel.classList.remove('hidden');
    },
    hideTechniqueChoice: () => {
      choicePanel.classList.add('hidden');
      clearNode(choiceBtns);
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
