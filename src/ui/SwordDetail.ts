import type { Game } from '../Game';
import type { SwordAgent } from '../simulation/SwordAgent';
import { el } from '../utils/dom';
import { openModal } from './modals';
import { drawSwordIcon } from './swordIcon';
import { ELEMENT_LABEL, strategyLabel } from '../simulation/Genetics';
import { affixDesc, affixName } from '../data/AffixDB';
import { skillsFor } from '../simulation/Skills';
import { TICKS_PER_DAY, TICKS_PER_SHICHEN, MIND_REALMS, MIND_REALM_THRESHOLDS } from '../constants';

const TIPS: Record<string, string> = {
  攻伐: '攻伐之力：碰撞伤害 = 攻伐 − 敌方坚固×0.5（至少 1 点）；攻伐亦增暴击之威。锋刃越利，日常维持耗神越多。',
  坚固: '防御之体：直接削弱所受伤害，反震亦轻。剑体越沉，行动越耗精元。',
  速度: '身法：越快则移动耗精元越多，宗门大比中蓄势越快、出手越频。',
  感知: '灵识：探查范围 = 感知×2 格；与对手比感知，感知高者闪避来剑更易。',
  杀性: '好战之心：越高越主动寻敌；杀性凶者易出暴击重创。',
  策略: '合击者喜集群行动、遥相呼应；孤狼者独来独往、不愿近人。',
  精元: '养分：移动、碰撞、分化皆耗精元，精元枯竭则剑体崩解；剑谱属性越高，每日维持耗神越多。精元满 80 即分化剑子（新分化后回落到 40）。',
  剑体: '剑意之体：剑体归零则剑意消亡。',
  存续: '自诞生起存活的时日（1 日 = 12 时辰，1 时辰 = 8 刻）。',
  足迹: '踏足过的剑域格数。',
  采气: '吞纳庚金之气的团数。',
  历经: '经历过的碰撞战斗场数。',
  击破: '击溃的敌方剑意数。',
  剑子: '由己身分化衍生的后代剑意数。',
  剑心: '此剑的灵识中枢：每一瞬扫视八方，权衡庚金、敌剑与壁垒，再择向而行。历经杀伐游历，灵识渐开、愈战愈明——剑心随「击破」晋境（杀伐之证，击破愈多、灵识愈明），扩容玄机并增益战力（精元更省、更擅施法；晋境悟剑心绝技）。',
  本命血脉: '出自你亲手种下的剑胚一脉，血统延续至今，是剑成鉴定的正主。',
  外来剑意: '随剑潮涌入的游离之剑，非本命一脉，可为辅翼亦可为敌。',
};

/** 点击剑意：展示其剑谱 / 状态 / 剑心 (属性悬浮有解释) */
export function openSwordDetail(game: Game, agent: SwordAgent, onClose?: () => void): void {
  const s = agent.state;
  const body = el('div', 'sword-detail');

  // 头部
  const head = el('div', 'sd-head');
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  drawSwordIcon(canvas, s.genome.element);
  const titleBox = el('div', 'sd-titlebox');
  titleBox.appendChild(el('div', 'sd-title', `${ELEMENT_LABEL[s.genome.element]}行 · 第 ${s.generation} 代剑意`));
  const originBadge = el('span', 'sd-origin tip' + (s.origin === 'seed' ? ' seed' : ''), s.origin === 'seed' ? '本命血脉' : '外来剑意');
  originBadge.setAttribute('data-tip', TIPS[s.origin === 'seed' ? '本命血脉' : '外来剑意'] ?? '');
  titleBox.appendChild(originBadge);
  head.append(canvas, titleBox);
  body.appendChild(head);

  // 剑谱 (有效值，含词条加成)
  body.appendChild(el('h3', 'section-title', '剑谱'));
  const affixes = s.genome.affixes;
  const AFFIX_NOTE: Record<string, string> = {
    攻伐: affixes.includes('kill5') ? '含「斩念成性」攻伐 +1.5' : '',
    坚固: affixes.includes('fight15') ? '含「百炼之体」坚固 +1.5' : '',
    感知: affixes.includes('roam400') ? '含「游历万方」感知 +2' : '',
  };
  const genes: { label: string; value: number; base: number; max: number }[] = [
    { label: '攻伐', value: s.genome.sharpness + (affixes.includes('kill5') ? 1.5 : 0), base: s.genome.sharpness, max: 10 },
    { label: '坚固', value: s.genome.toughness + (affixes.includes('fight15') ? 1.5 : 0), base: s.genome.toughness, max: 10 },
    { label: '速度', value: s.genome.speed, base: s.genome.speed, max: 10 },
    { label: '感知', value: s.genome.perception + (affixes.includes('roam400') ? 2 : 0), base: s.genome.perception, max: 10 },
    { label: '杀性', value: s.genome.aggression, base: s.genome.aggression, max: 1 },
    { label: '策略', value: s.genome.strategy, base: s.genome.strategy, max: 1 },
  ];
  for (const g of genes) {
    const bonus = g.value - g.base;
    const display =
      g.label === '策略'
        ? strategyLabel(g.value)
        : `${g.value.toFixed(1)}${bonus > 0.001 ? ` <em class="sd-bonus">+${bonus.toFixed(1)}</em>` : ''}`;
    body.appendChild(barRow(g.label, display, g.value, g.max, AFFIX_NOTE[g.label] ?? ''));
  }

  // 词条 (带内联说明)
  if (s.genome.affixes.length > 0) {
    body.appendChild(el('h3', 'section-title', '词条'));
    const affixBox = el('div', 'sd-affixes');
    for (const a of s.genome.affixes) {
      const item = el('div', 'sd-affix-item tip');
      item.setAttribute('data-tip', affixDesc(a));
      item.append(
        el('span', 'sd-affix-name', `「${affixName(a)}」`),
        el('div', 'sd-affix-desc', affixDesc(a)),
      );
      affixBox.appendChild(item);
    }
    body.appendChild(affixBox);
  }

  // 剑技 (五行天赋 + 词条，与野外/大比同源)
  body.appendChild(el('h3', 'section-title', '剑技'));
  const skillBox = el('div', 'sd-skills');
  const skills = skillsFor(s.genome.element, affixes, s.mindSkillIds);
  for (const sk of skills) {
    const src = sk.element
      ? `${ELEMENT_LABEL[sk.element]}行天赋`
      : sk.affix
        ? `「${affixName(sk.affix)}」`
        : '剑心绝技';
    const cd = Math.max(1, Math.round(sk.cooldown / TICKS_PER_SHICHEN));
    const item = el('div', 'sd-skill-item tip');
    item.setAttribute('data-tip', `${src} · 耗精元 ${sk.energyCost} · 冷却 ${cd} 时辰`);
    item.append(
      el('span', 'sd-skill-name', `「${sk.name}」`),
      el('div', 'sd-skill-desc', sk.desc),
      el('div', 'sd-skill-meta', `${src} · 耗 ${sk.energyCost} 精元 · 冷却 ${cd} 时辰`),
    );
    skillBox.appendChild(item);
  }
  body.appendChild(skillBox);

  // 状态
  body.appendChild(el('h3', 'section-title', '状态'));
  const b = agent.behavior;
  let descendants = 0;
  if (game.world) {
    for (const v of game.world.lineage.values()) {
      if (v.parentId === s.id) descendants++;
    }
  }
  const status: [string, string][] = [
    ['精元', `${s.energy.toFixed(0)} / 80`],
    ['剑体', `${s.hp.toFixed(0)} / 100`],
    ['存续', `${formatSurvival(s.age)}`],
    ['足迹', `${b.cellsVisited} 格`],
    ['采气', `${b.eatCount} 团`],
    ['历经', `${b.attackCount + b.fightsSurvived} 战`],
    ['击破', `${b.killCount} 敌`],
    ['剑子', `${descendants} 柄`],
  ];
  const grid = el('div', 'sd-status');
  for (const [k, v] of status) {
    const item = el('div', 'sd-status-item tip');
    item.setAttribute('data-tip', TIPS[k] ?? '');
    item.append(el('span', 'sd-status-label', k), el('span', 'sd-status-value', v));
    grid.appendChild(item);
  }
  body.appendChild(grid);

  // 剑心 (v1.12.0：境界 + 白话描述 + 晋境进度；删去「26 维→8 层→4 路」行话)
  body.appendChild(el('h3', 'section-title', '剑心'));
  const realm = s.mindRealm ?? 0;
  const realmInfo = MIND_REALMS[Math.min(MIND_REALMS.length - 1, realm)];
  const isMax = realm >= MIND_REALMS.length - 1;
  const th = MIND_REALM_THRESHOLDS[realm];
  // v2.0.0：晋升只看击破（击杀数）
  const progress = isMax
    ? '已臻化境，剑心通神'
    : `晋境：击破 ${Math.min(b.killCount, th.kills)}/${th.kills}${b.killCount >= th.kills ? ' ✓' : ''}（击破达标方可晋境）`;
  const mind = el('div', 'sd-mind tip');
  mind.setAttribute('data-tip', TIPS['剑心'] ?? '');
  mind.appendChild(el('p', 'sd-mind-name', `剑心 · ${realmInfo.name}`));
  mind.appendChild(el('p', '', `此剑的灵识中枢：每一瞬扫视八方，权衡庚金、敌剑与壁垒，再择向而行。历经杀伐游历，灵识渐开——如今已能洞察 ${realmInfo.hidden} 重玄机。`));
  mind.appendChild(el('p', 'sd-mind-sub', progress));
  body.appendChild(mind);

  const overlay = openModal('剑意 · 灵鉴', body, {
    width: 440,
    onClose,
  });
}

function barRow(label: string, display: string, value: number, max: number, affixNote = ''): HTMLElement {
  const row = el('div', 'sd-bar-row tip');
  const tip = (TIPS[label] ?? '') + (affixNote ? `（${affixNote}）` : '');
  row.setAttribute('data-tip', tip);
  const lab = el('span', 'sd-bar-label', label);
  const track = el('div', 'sd-bar-track');
  const fill = el('div', 'sd-bar-fill');
  fill.style.width = `${Math.min(100, (value / max) * 100)}%`;
  track.appendChild(fill);
  const val = el('span', 'sd-bar-value', '');
  val.innerHTML = display;
  row.append(lab, track, val);
  return row;
}

/** 存续时长：tick → 「X 日 Y 时辰」的修仙计时 */
function formatSurvival(ticks: number): string {
  const days = Math.floor(ticks / TICKS_PER_DAY);
  const shichen = Math.floor((ticks % TICKS_PER_DAY) / TICKS_PER_SHICHEN);
  if (days > 0) return `${days} 日 ${shichen} 时辰`;
  return `${shichen} 时辰`;
}

