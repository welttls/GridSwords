/**
 * 全局音频管理器（单例）。
 * - BGM：3 首场景曲（menu/forge/battle），按需加载、代码 crossfade 循环、随游戏暂停
 * - SFX：Web Audio 程序合成（src/audio/sfxSynth），音量分级 + 节流
 * - 事件：订阅 eventBus（SKILL→cast / THUNDER→thunder / EMERGENCE→emerge / MIND→mind）
 * - 静音：music / sfx 独立开关
 * headless 安全：AudioContext 惰性创建，仅浏览器环境执行。
 */
import { eventBus, EVT } from '../utils/eventBus';
import { playSfxSynth, type SfxId } from './sfxSynth';

export type BgmTrack = 'menu' | 'forge' | 'battle' | null;

/** BGM 文件映射（public/audio/bgm/ 下的实际文件名，含方括号需 encodeURI） */
const BGM_FILES: Record<'menu' | 'forge' | 'battle', string> = {
  menu: '/audio/bgm/[menu_theme]tunetank-china-chinese-asian-music-350075.mp3',
  forge: '/audio/bgm/[forge_theme]ikoliks_aj-china-chinese-asian-music-346568.mp3',
  battle: '/audio/bgm/[battle_theme]mohamed_hassan-epic-harmony-335002.mp3',
};

const BGM_VOLUME = 0.4;
/** crossfade 循环：结尾前淡出→重播→淡入（Suno/下载曲带 intro/outro，直接 loop 会断） */
const BGM_FADE_MS = 1800;
/** 音频设置持久化键（v2.3.1：音量滑块/开关跨会话保存） */
const AUDIO_SAVE_KEY = 'swordforge-audio-v1';

/** 音效相对音量（相对 BGM） */
const SFX_VOLUME: Record<SfxId, number> = {
  click: 0.15,
  cast: 0.35,
  crit: 0.4,
  emerge: 0.45,
  mind: 0.45,
  win: 0.45,
  lose: 0.45,
  thunder: 0.5,
};

/** 同一音效最小触发间隔（ms）——高频事件节流防爆音 */
const SFX_THROTTLE: Partial<Record<SfxId, number>> = {
  click: 60,
  cast: 120,
  mind: 500,
  emerge: 800,
  thunder: 400,
};

/** 一次性音效增益节点最长寿命 (ms)——所有合成音效最长约 1.9s（emerge 琶音），尾部放宽到 2.5s 后断开防泄漏 */
const SFX_TAIL_MS = 2500;

class AudioManager {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicEnabled = true;
  private sfxEnabled = true;
  /** v2.3.1：音量滑块 0~1 */
  private musicVolume = 1;
  private sfxVolume = 1;
  private unlocked = false;
  private lastSfx: Partial<Record<SfxId, number>> = {};

  // —— BGM 状态 ——
  private bgmEl: HTMLAudioElement | null = null;
  private currentTrack: BgmTrack = null;
  private bgmPlayingTrack: 'menu' | 'forge' | 'battle' | null = null; // 实际正在播放的曲目（区分 setBgm 的目标）
  private pendingTrack: BgmTrack = null; // 解锁（首次交互）前记录的待播曲
  private bgmFading = false;
  private bgmPaused = false; // 跟随游戏暂停的标志（避免每帧重复 pause/play）
  private fadeTimer: number | null = null;
  private preloaded = new Set<'menu' | 'forge' | 'battle'>(); // 已预载曲目

  // —— 事件 handler（字段级，便于解绑）——
  private hSkill = (): void => this.playSfx('cast');
  private hThunder = (): void => this.playSfx('thunder');
  private hEmergence = (): void => this.playSfx('emerge');
  private hMind = (): void => this.playSfx('mind');
  private hBgmTime = (): void => {
    const el = this.bgmEl;
    if (!el || !el.duration || el.duration === Infinity || this.bgmFading) return;
    // 结尾前 BGM_FADE 秒 → 淡出 → 重播淡入（无缝循环）
    if (el.duration - el.currentTime < BGM_FADE_MS / 1000) {
      this.bgmFading = true;
      this.rampVolume(el, 0, BGM_FADE_MS, () => {
        el.currentTime = 0;
        el.play().catch(() => {});
        this.rampVolume(el, this.musicEnabled ? BGM_VOLUME : 0, BGM_FADE_MS, () => {
          this.bgmFading = false;
        });
      });
    }
  };

  constructor() {
    this.loadSettings();
    // 订阅游戏事件（与 Renderer 同构；headless 无监听即 no-op）
    eventBus.on(EVT.SKILL, this.hSkill);
    eventBus.on(EVT.THUNDER, this.hThunder);
    eventBus.on(EVT.EMERGENCE, this.hEmergence);
    eventBus.on(EVT.MIND, this.hMind);
    // 全局 UI 点击（仅按钮/可点元素）
    document.addEventListener('click', this.hClick);
    // 首次用户交互解锁（浏览器 autoplay 策略）
    const unlock = (): void => this.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }

  private hClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('button, .btn, [data-sfx]')) this.playSfx('click');
  };

  /** 首次用户交互：恢复 AudioContext + 播放待播 BGM */
  unlock(): void {
    this.unlocked = true;
    if (!this.ctx) this.ensureCtx();
    this.ctx?.resume?.();
    if (this.pendingTrack && this.musicEnabled) {
      const t = this.pendingTrack;
      this.pendingTrack = null;
      this.startBgm(t);
    }
  }

  // —— v2.3.1：音量设置持久化 ——
  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(AUDIO_SAVE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { musicEnabled?: unknown; sfxEnabled?: unknown; musicVolume?: unknown; sfxVolume?: unknown };
      if (typeof s.musicEnabled === 'boolean') this.musicEnabled = s.musicEnabled;
      if (typeof s.sfxEnabled === 'boolean') this.sfxEnabled = s.sfxEnabled;
      if (typeof s.musicVolume === 'number') this.musicVolume = this.clamp01(s.musicVolume);
      if (typeof s.sfxVolume === 'number') this.sfxVolume = this.clamp01(s.sfxVolume);
    } catch {
      // 损坏数据：忽略
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(
        AUDIO_SAVE_KEY,
        JSON.stringify({
          musicEnabled: this.musicEnabled,
          sfxEnabled: this.sfxEnabled,
          musicVolume: this.musicVolume,
          sfxVolume: this.sfxVolume,
        }),
      );
    } catch {
      // 隐私模式等：忽略
    }
  }

  private clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  /** 有效 BGM 音量（开关 × 滑块 × 基础音量） */
  private effectiveMusicVolume(): number {
    return this.musicEnabled ? BGM_VOLUME * this.musicVolume : 0;
  }

  /** 预加载某曲目（不播放，提前缓存——切曲时秒开，避免进场景后等待） */
  preload(track: 'menu' | 'forge' | 'battle'): void {
    if (this.bgmEl && this.bgmPlayingTrack === track) return;
    if (this.preloaded.has(track)) return;
    this.preloaded.add(track);
    const a = new Audio(encodeURI(BGM_FILES[track]));
    a.preload = 'auto';
    a.load();
  }

  /** 切换场景 BGM（null = 停止；未解锁时记入待播，解锁后自动播放） */
  setBgm(track: BgmTrack): void {
    this.currentTrack = track;
    if (!this.musicEnabled || !track) {
      this.stopBgm();
      return;
    }
    if (!this.unlocked) {
      this.pendingTrack = track;
      this.stopBgm();
      return;
    }
    this.startBgm(track);
  }

  private startBgm(track: 'menu' | 'forge' | 'battle'): void {
    // 当前正播放同一曲目 → 忽略（避免重复建 Audio）
    if (this.bgmEl && this.bgmPlayingTrack === track && !this.bgmEl.paused) return;
    this.stopBgm();
    this.bgmPaused = false;
    this.bgmPlayingTrack = track;
    const url = encodeURI(BGM_FILES[track]);
    const el = new Audio(url);
    el.preload = 'auto';
    el.volume = 0;
    el.loop = false; // 手动 crossfade 循环
    el.addEventListener('timeupdate', this.hBgmTime);
    el.addEventListener('error', () => {
      // 素材缺失/加载失败：静默降级（不打断游戏）
    });
    this.bgmEl = el;
    el.play()
      .then(() => this.rampVolume(el, this.effectiveMusicVolume(), BGM_FADE_MS))
      .catch(() => {
        // autoplay 被拒：保留待播，等下次 unlock
        this.pendingTrack = track;
      });
  }

  private stopBgm(): void {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.bgmEl) {
      this.bgmEl.removeEventListener('timeupdate', this.hBgmTime);
      this.bgmEl.pause();
      this.bgmEl.src = '';
      this.bgmEl = null;
    }
    this.bgmFading = false;
    this.bgmPaused = false;
    this.bgmPlayingTrack = null;
  }

  /** 音量渐变（50ms 步进） */
  private rampVolume(el: HTMLAudioElement, to: number, ms: number, onDone?: () => void): void {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    const from = el.volume;
    const steps = Math.max(1, Math.round(ms / 50));
    let i = 0;
    this.fadeTimer = window.setInterval(() => {
      i++;
      el.volume = from + (to - from) * (i / steps);
      if (i >= steps) {
        clearInterval(this.fadeTimer!);
        this.fadeTimer = null;
        el.volume = to;
        onDone?.();
      }
    }, 50);
  }

  /** 播放音效（音量分级 + 节流） */
  playSfx(id: SfxId): void {
    if (!this.sfxEnabled) return;
    const now = Date.now();
    const th = SFX_THROTTLE[id] ?? 0;
    if (now - (this.lastSfx[id] ?? 0) < th) return;
    this.lastSfx[id] = now;
    this.ensureCtx();
    if (!this.ctx || !this.sfxGain) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const vol = SFX_VOLUME[id] ?? 0.4;
    const g = this.ctx.createGain();
    g.gain.value = vol * this.sfxVolume; // v2.3.1：叠加音量滑块
    g.connect(this.sfxGain);
    playSfxSynth(this.ctx, g, id);
    // v2.2.1：合成结束后显式断开增益节点——原实现从不 disconnect，外层 g 永久挂在音频图上（每小时可泄漏数千 GainNode）
    window.setTimeout(() => {
      try {
        g.disconnect();
      } catch {
        // 已断开 / 上下文已关闭：忽略
      }
    }, SFX_TAIL_MS);
  }

  private ensureCtx(): void {
    if (this.ctx) return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxEnabled ? this.sfxVolume : 0;
    this.sfxGain.connect(this.ctx.destination);
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    this.saveSettings();
    if (on) {
      if (this.currentTrack) this.startBgm(this.currentTrack);
    } else {
      this.stopBgm();
    }
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on;
    this.saveSettings();
    if (this.sfxGain) this.sfxGain.gain.value = on ? this.sfxVolume : 0;
  }

  /** v2.3.1：背景乐音量滑块 0~1 */
  setMusicVolume(v: number): void {
    this.musicVolume = this.clamp01(v);
    this.saveSettings();
    if (this.bgmEl && this.bgmPlayingTrack && !this.bgmFading) {
      this.rampVolume(this.bgmEl, this.effectiveMusicVolume(), 120);
    }
  }

  /** v2.3.1：音效音量滑块 0~1 */
  setSfxVolume(v: number): void {
    this.sfxVolume = this.clamp01(v);
    this.saveSettings();
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxEnabled ? this.sfxVolume : 0;
  }

  getMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  getSfxEnabled(): boolean {
    return this.sfxEnabled;
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  /** 解绑事件（页面卸载/测试清理用） */
  destroy(): void {
    eventBus.off(EVT.SKILL, this.hSkill);
    eventBus.off(EVT.THUNDER, this.hThunder);
    eventBus.off(EVT.EMERGENCE, this.hEmergence);
    eventBus.off(EVT.MIND, this.hMind);
    document.removeEventListener('click', this.hClick);
    this.stopBgm();
    this.ctx?.close?.();
    this.ctx = null;
    this.sfxGain = null;
  }
}

/** 全局单例 */
export const audio = new AudioManager();
