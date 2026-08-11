/**
 * Web Audio 程序合成音效（无外部素材，体积 0）。
 * 古风修仙氛围：金属重击 / 风切 / 五声音阶升华 / 金玉 / 天雷 / 胜负号角 / UI 点击。
 * 仅由 AudioManager 在浏览器中调用；headless / node 环境下不执行，无副作用。
 */
export type SfxId = 'crit' | 'cast' | 'emerge' | 'mind' | 'thunder' | 'win' | 'lose' | 'click';

/** 共享白噪声 buffer（2s，各音效复用） */
let noiseBuf: AudioBuffer | null = null;

function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** 单音（带淡入淡出包络）——用于五声旋律 / 钟声 / 号角 */
function tone(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  t0: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'sine',
): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + Math.min(0.02, dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** 扫频振荡——金属冲击 / 点击 */
function sweep(
  ctx: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  f0: number,
  f1: number,
  t0: number,
  dur: number,
  peak: number,
): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** 噪声片段（滤波 + 包络）——风切 / 雷声 / 撞击底层 */
function noiseHit(
  ctx: AudioContext,
  dest: AudioNode,
  t0: number,
  dur: number,
  peak: number,
  filterType: BiquadFilterType,
  freq: number,
  freqEnd?: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t0);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + Math.min(0.03, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/** 五声音阶（宫商角徵羽）频率 */
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0]; // C D E G A

/**
 * 在指定时刻合成一个音效。
 * @param ctx 已创建的 AudioContext
 * @param dest 输出节点（AudioManager 的 sfxGain）
 * @param id 音效 id
 */
export function playSfxSynth(ctx: AudioContext, dest: AudioNode, id: SfxId): void {
  const t = ctx.currentTime;
  switch (id) {
    case 'click': {
      // 短促 UI 点击（三角波高频下扫）
      sweep(ctx, dest, 'triangle', 1700, 850, t, 0.06, 0.12);
      break;
    }
    case 'cast': {
      // 风切 swoosh：噪声带通从高扫到低
      noiseHit(ctx, dest, t, 0.28, 0.32, 'bandpass', 2400, 450);
      break;
    }
    case 'crit': {
      // 金属重击：噪声低通爆点 + 双金属振荡下沉
      noiseHit(ctx, dest, t, 0.28, 0.5, 'lowpass', 4200, 600);
      sweep(ctx, dest, 'square', 520, 85, t, 0.34, 0.3);
      sweep(ctx, dest, 'triangle', 1500, 280, t, 0.24, 0.24);
      break;
    }
    case 'emerge': {
      // 涌现：五声音阶上行琶音 + 钟声泛音
      const notes = [PENTA[2] * 2, PENTA[3] * 2, PENTA[4] * 2, PENTA[0] * 4, PENTA[2] * 4]; // E5 G5 A5 C6 E6
      notes.forEach((f, i) => tone(ctx, dest, f, t + i * 0.17, 0.55, 0.26, 'sine'));
      tone(ctx, dest, PENTA[4] * 4, t + notes.length * 0.17, 0.9, 0.2, 'sine'); // A6 收尾钟声
      break;
    }
    case 'mind': {
      // 顿悟金玉：双钟声 + 三角泛音
      tone(ctx, dest, 1318.5, t, 0.7, 0.32, 'sine'); // E6
      tone(ctx, dest, 1568.0, t + 0.05, 0.55, 0.24, 'sine'); // G6
      tone(ctx, dest, 2637.0, t, 0.45, 0.1, 'triangle'); // E7 泛音
      break;
    }
    case 'thunder': {
      // 天雷：初始爆响 + 低频隆隆 + 尾部余震
      noiseHit(ctx, dest, t, 0.16, 0.75, 'lowpass', 320, 70);
      noiseHit(ctx, dest, t + 0.12, 1.3, 0.42, 'lowpass', 150);
      noiseHit(ctx, dest, t + 0.5, 0.7, 0.2, 'lowpass', 90);
      break;
    }
    case 'win': {
      // 胜利号角：明亮上行 A4 C5 E5 → A5 长音
      [440, 523.25, 659.25].forEach((f, i) => tone(ctx, dest, f, t + i * 0.22, 0.4, 0.28, 'triangle'));
      tone(ctx, dest, 880, t + 0.66, 0.75, 0.32, 'triangle'); // A5
      break;
    }
    case 'lose': {
      // 败北：低沉下行 E4 → C4
      tone(ctx, dest, 329.63, t, 0.45, 0.3, 'sine');
      tone(ctx, dest, 261.63, t + 0.32, 0.7, 0.26, 'sine');
      break;
    }
  }
}
