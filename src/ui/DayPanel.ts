import type { Game } from '../Game';
import { el } from '../utils/dom';
import { openModal, toast } from './modals';

/** 每日剑潮类型 */
export type DailyDropKind = 'mild' | 'tide' | 'fierce' | 'auto' | 'none';

export const DROP_OPTIONS: { kind: DailyDropKind; name: string; desc: string }[] = [
  { kind: 'mild', name: '温养之潮', desc: '剑意温和而感知过人，来得少而稳。' },
  { kind: 'tide', name: '剑潮汹涌', desc: '大量剑意自天外涌入，良莠不齐，厮杀在所难免。' },
  { kind: 'fierce', name: '天外凶潮', desc: '凶剑裹挟杀意降临，数目少却个个凶悍。' },
  { kind: 'none', name: '静待天时', desc: '今日不投剑意，听凭剑域自生自灭。' },
];

/**
 * v2.6.0 / v2.8.0：当前剑域气象文案（读 World.modifiers + 天雷今日剩余）。
 * v2.8.0 起常驻展示于剑域画布上方操作条（不再藏在炉材弹窗里），由 Game/HUD 调用。
 */
export function buildMaterialAura(game: Game): string[] {
  const w = game.world;
  const lines: string[] = [];
  if (!w) return lines;
  const m = w.modifiers;
  if (m.foodRegenMult !== 1) lines.push(`庚金生成 ×${m.foodRegenMult.toFixed(1)}（+${Math.round((m.foodRegenMult - 1) * 100)}%）`);
  if (m.speedBonus > 0) lines.push(`全体剑意身法 +${m.speedBonus}`);
  if (m.temperature !== 'normal') lines.push(`节气：${m.temperature === 'breeze' ? '清风·灵力消耗降低' : '严寒'}`);
  if (m.mutationBias) {
    const stat = m.mutationBias.stat === 'speed' ? '速度' : '坚固';
    lines.push(m.mutationBias.sideEffect === 'speedDown'
      ? `分化突变：${stat} ×${m.mutationBias.rateMult}·速度突变下降`
      : `分化突变：${stat} ×${m.mutationBias.rateMult}`);
  }
  if (m.aggressionBonus > 0) lines.push(`剑意杀性 +${m.aggressionBonus}`);
  // v2.6.0：天雷每日 5 次（今日剩余）
  if (game.save.unlockedMaterialIds.includes('thunder_potion')) {
    const left = game.save.materialCounts['thunder_potion'] ?? 0;
    lines.push(`天雷：今日可引 ${left}/5 次（每日子时恢复）`);
  }
  return lines;
}

/** 弹窗超时秒数：未操作则自动沿用上次选择 / 首日静待天时 (v1.10.0) */
const DROP_TIMEOUT_SECONDS = 6;

/** 剑潮选项中文名 (auto 为「默许天意」) */
function dropName(kind: DailyDropKind): string {
  return kind === 'auto' ? '默许天意' : DROP_OPTIONS.find((o) => o.kind === kind)?.name ?? kind;
}

/**
 * 共享：剑潮选项列表 + 免弹窗勾选 + 默许天意按钮 (v1.11.0)
 * openDailyDropPanel（每日子时弹窗）与 openTidePanel（HUD 剑潮偏好）复用。
 * onChoose 由调用方决定后续动作（投放 / 仅记录偏好）。
 */
function buildTideChooser(
  game: Game,
  onChoose: (kind: DailyDropKind) => void,
): { body: HTMLElement; lockBox: HTMLInputElement } {
  const body = el('div', 'drop-panel');
  const lastKind = game.save.dailyDropKind ?? null;
  const list = el('div', 'material-list');
  for (const o of DROP_OPTIONS) {
    const card = el('div', 'material-card' + (o.kind === lastKind ? ' selected' : ''));
    card.append(el('div', 'material-name', o.name), el('div', 'material-desc', o.desc));
    card.addEventListener('click', () => onChoose(o.kind));
    list.appendChild(card);
  }
  body.appendChild(list);
  // 免弹窗勾选 (v1.10.0)：本局一直用此选择
  const lockRow = el('label', 'drop-lock');
  const lockBox = el('input', 'drop-lock-box') as HTMLInputElement;
  lockBox.type = 'checkbox';
  lockBox.checked = !!game.save.dailyDropLocked;
  lockRow.append(lockBox, el('span', '', '本局一直用此选择，不再弹窗'));
  body.appendChild(lockRow);
  const auto = el('button', 'btn btn-ghost tip' + (lastKind === 'auto' ? ' selected' : ''), '默许天意');
  auto.dataset.tip = '默许天意：不择而择，听凭剑潮自行起落（温养/汹涌/凶潮随机三分）。';
  auto.addEventListener('click', () => onChoose('auto'));
  body.appendChild(auto);
  return { body, lockBox };
}

/**
 * 每日子时剑潮投放：玩家选择本日剑潮，或默许天意。
 * v1.10.0：默认高亮上次选择 + 6 秒倒计时 (超时沿用上次/首日静待天时) + 可勾选「本局一直用此选择不再弹窗」。
 */
export function openDailyDropPanel(
  game: Game,
  day: number,
  onClose?: () => void,
): void {
  let chosen = false;
  let timer: number | null = null;
  const lastKind = game.save.dailyDropKind ?? null;
  const timeoutLabel = lastKind ? '沿用上次选择' : '静待天时';

  const finish = (kind: DailyDropKind) => {
    if (chosen) return;
    chosen = true;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    game.save.dailyDropLocked = lockBox.checked; // 免弹窗勾选即时记录 (chooseDailyDrop 内 saveGame 落盘)
    overlay.remove();
    game.chooseDailyDrop(kind);
    onClose?.();
  };
  const { body, lockBox } = buildTideChooser(game, finish);

  // 顶部：intro + 倒计时提示 (每日弹窗特有)
  body.insertBefore(el('p', 'drop-intro', `第 ${day} 日子时，游离剑意自天外涌来。择其一道，或默许天意。`), body.firstChild);
  const countdown = el('div', 'drop-countdown', `${DROP_TIMEOUT_SECONDS} 秒未择，自动${timeoutLabel}…`);
  body.insertBefore(countdown, body.firstChild);

  // 倒计时：超时自动选择 (有上次→上次；首日无上次→静待天时)
  let remain = DROP_TIMEOUT_SECONDS;
  const tick = () => {
    remain--;
    if (remain <= 0) {
      finish(lastKind ?? 'none');
      return;
    }
    countdown.textContent = `${remain} 秒未择，自动${timeoutLabel}…`;
  };
  timer = window.setInterval(tick, 1000);

  const overlay = openModal('子时 · 剑潮至', body, {
    width: 520,
    onClose: () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      if (!chosen) {
        // 关闭弹窗 (×/遮罩) → 同超时：沿用上次或静待天时 (v1.10.0，原为 auto)
        game.chooseDailyDrop(lastKind ?? 'none');
      }
      onClose?.();
    },
  });
}

/**
 * 剑潮偏好面板 (v1.11.0)：随时修改本局剑潮选择/免弹窗，不立即投放 (等每日子时)。
 */
export function openTidePanel(game: Game, onClose?: () => void): void {
  const { body, lockBox } = buildTideChooser(game, (kind) => {
    overlay.remove();
    game.save.dailyDropKind = kind;
    game.save.dailyDropLocked = lockBox.checked;
    game.saveGame();
    toast(`本局剑潮已改为「${dropName(kind)}」。`);
    onClose?.();
  });
  const overlay = openModal('剑潮偏好 · 下次子时生效', body, { width: 520, onClose });
}
