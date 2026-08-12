import { Container, Graphics, Text } from 'pixi.js';
import type { World } from '../simulation/World';
import type { SwordAgent } from '../simulation/SwordAgent';
import { ELEMENT_COLOR } from '../simulation/Genetics';
import { MIND_SWORD_SCALE } from '../constants';
import { eventBus, EVT, type ParticleEvent, type SkillVisual } from '../utils/eventBus';

const FOOD_COLOR = 0xffd76a;
const WALL_COLOR = 0xff5a2a;
const CHAOS_COLOR = 0x1c0f18;
const LAVA_COLOR = 0xff4a12;      // v2.3.0：熔岩
const DEEPWATER_COLOR = 0x1a5a9a; // v2.3.0：深水
const MAX_PARTICLES = 500;

/** 单个粒子 */
interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  baseR: number;
}

/** 飘字 (技能名/回春等，上浮淡出) */
interface FloatText {
  t: Text;
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
}

/** 技能特效 (持续帧动画) */
interface Effect {
  kind: 'proj' | 'ring' | 'beam';
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: number;
  life: number;
  maxLife: number;
  /** 半径/射程 (格) */
  radius: number;
}

/**
 * PixiJS 世界渲染器：绘制剑域网格、庚金之气、火墙、混沌区与剑意。
 * 每帧重建一个 Graphics，可承载数百剑意；另含粒子层播放碰撞/分化/陨落等效果。
 */
export class WorldRenderer {
  readonly container: Container;
  private g: Graphics;
  private eg: Graphics;
  private bg: Graphics;
  private cell: number;
  private width: number;
  private height: number;
  private showBars: boolean;
  private selectedId: string | null = null;
  private particles: Particle[] = [];
  private particleLayer: Container;
  private effects: Effect[] = [];
  private effectLayer: Container;
  private floatTexts: FloatText[] = [];
  private lastTick = 0;
  /** 绑定的事件处理器 (供 off 精确解绑) */
  private hBattleHit = (e: ParticleEvent) => this.onBattleHit(e);
  private hSplit = (e: ParticleEvent) => this.onSplit(e);
  private hDeath = (e: ParticleEvent) => this.onDeath(e);
  private hEat = (e: ParticleEvent) => this.onEat(e);
  private hThunder = (e: ParticleEvent) => this.onThunder(e);
  private hSkill = (e: SkillVisual) => this.onSkill(e);

  constructor(container: Container, width: number, height: number, cell: number, showBars = false) {
    this.container = container;
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.showBars = showBars;
    this.bg = new Graphics();
    this.g = new Graphics();
    this.eg = new Graphics();
    this.particleLayer = new Container();
    this.effectLayer = new Container();
    this.effectLayer.addChild(this.eg);
    container.addChild(this.bg, this.g, this.particleLayer, this.effectLayer);
    this.bg.beginFill(0x0c1017);
    this.bg.drawRect(0, 0, width * cell, height * cell);
    this.bg.endFill();

    // 监听粒子/技能事件 (渲染端专用，headless 无副作用)
    eventBus.on(EVT.BATTLE_HIT, this.hBattleHit);
    eventBus.on(EVT.SPLIT, this.hSplit);
    eventBus.on(EVT.DEATH, this.hDeath);
    eventBus.on(EVT.EAT, this.hEat);
    eventBus.on(EVT.THUNDER, this.hThunder);
    eventBus.on(EVT.SKILL, this.hSkill);
  }

  destroy(): void {
    eventBus.off(EVT.BATTLE_HIT, this.hBattleHit);
    eventBus.off(EVT.SPLIT, this.hSplit);
    eventBus.off(EVT.DEATH, this.hDeath);
    eventBus.off(EVT.EAT, this.hEat);
    eventBus.off(EVT.THUNDER, this.hThunder);
    eventBus.off(EVT.SKILL, this.hSkill);
    // 清理残留粒子 (v2.2.1：Graphics 显式 destroy 释放 GPU 资源)
    for (const p of this.particles) {
      this.particleLayer.removeChild(p.g);
      p.g.destroy();
    }
    this.particles.length = 0;
    // 清理飘字 (Pixi Text 需显式 destroy 防泄漏)
    for (const f of this.floatTexts) {
      this.effectLayer.removeChild(f.t);
      f.t.destroy();
    }
    this.floatTexts.length = 0;
    // v2.2.1：销毁常驻 Graphics 并从舞台移除容器，防止旧场景内容残留在 stage
    this.bg.destroy();
    this.g.destroy();
    this.eg.destroy();
    this.container.removeFromParent?.();
  }

  /** 设置选中剑意 (绘制高亮框) */
  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  /** 每帧推进粒子 (dt 秒) */
  updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particleLayer.removeChild(p.g);
        p.g.destroy(); // v2.2.1：显式 destroy 释放 GPU 资源
        this.particles.splice(i, 1);
        continue;
      }
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      const t = p.life / p.maxLife;
      p.g.alpha = Math.min(1, t * 1.4);
      p.g.scale.set(Math.max(0.05, t));
    }
    this.updateEffects(dt);
  }

  private spawnBurst(x: number, y: number, color: number, count: number, speed: number, size: number, life: number): void {
    const cx = (x + 0.5) * this.cell;
    const cy = (y + 0.5) * this.cell;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const g = new Graphics();
      g.beginFill(color, 1);
      g.drawCircle(0, 0, size);
      g.endFill();
      g.x = cx;
      g.y = cy;
      const ang = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.9);
      this.particleLayer.addChild(g);
      this.particles.push({ g, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, maxLife: life, baseR: size });
    }
  }

  private elementColor(element?: string): number {
    const map: Record<string, number> = { metal: 0xd8dee9, wood: 0x7ddb8f, water: 0x5aa9ff, fire: 0xff6a4a, earth: 0xd0a86a };
    return element ? map[element] ?? 0xd8dee9 : 0xd8dee9;
  }

  private onBattleHit(e: ParticleEvent): void {
    const c = this.elementColor(e.element);
    const n = Math.min(14, 4 + Math.round((e.intensity ?? 3) / 2));
    this.spawnBurst(e.x, e.y, c, n, this.cell * 5, this.cell * 0.16, 0.5);
    this.spawnBurst(e.x, e.y, 0xfff6d8, 3, this.cell * 6, this.cell * 0.1, 0.3);
  }

  private onSplit(e: ParticleEvent): void {
    const c = this.elementColor(e.element);
    this.spawnBurst(e.x, e.y, c, 16, this.cell * 7, this.cell * 0.2, 0.8);
    this.spawnBurst(e.x, e.y, 0xffd76a, 6, this.cell * 4, this.cell * 0.12, 0.6);
  }

  private onDeath(e: ParticleEvent): void {
    const c = this.elementColor(e.element);
    this.spawnBurst(e.x, e.y, c, 12, this.cell * 4, this.cell * 0.18, 0.7);
    this.spawnBurst(e.x, e.y, 0x777c88, 10, this.cell * 3, this.cell * 0.12, 0.9);
  }

  private onEat(e: ParticleEvent): void {
    this.spawnBurst(e.x, e.y, 0xffd76a, 4, this.cell * 4, this.cell * 0.1, 0.4);
  }

  private onThunder(e: ParticleEvent): void {
    this.spawnBurst(e.x, e.y, 0x9ac8ff, 14, this.cell * 8, this.cell * 0.2, 0.35);
    this.spawnBurst(e.x, e.y, 0xffffff, 6, this.cell * 6, this.cell * 0.16, 0.2);
  }

  // ===== 技能特效 =====
  private onSkill(e: SkillVisual): void {
    const c = this.elementColor(e.element);
    const label = e.text;
    // v2.0.0：剑心绝技专属特效（更酷炫，优先于普通 kind 特效）
    if (e.id && this.mindFx(e)) return;
    switch (e.kind) {
      case 'projectile': {
        const dx = e.dx ?? 1;
        const dy = e.dy ?? 0;
        this.effects.push({ kind: 'proj', x: e.x, y: e.y, dx, dy, color: c, life: 2, maxLife: 2, radius: 0 });
        this.spawnBurst(e.x, e.y, 0xffffff, 4, this.cell * 3, this.cell * 0.1, 0.25);
        if (label) this.pushFloatText(e.x, e.y - 1, label, c);
        break;
      }
      case 'aoe': {
        // 双环（外色 + 内白亮核）+ 双色爆闪
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: c, life: 0.7, maxLife: 0.7, radius: (e.radius ?? 3) + 0.5 });
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0xffffff, life: 0.35, maxLife: 0.35, radius: 1.8 });
        this.spawnBurst(e.x, e.y, c, 20, this.cell * 6, this.cell * 0.18, 0.6);
        this.spawnBurst(e.x, e.y, 0xffffff, 6, this.cell * 5, this.cell * 0.12, 0.3);
        if (label) this.pushFloatText(e.x, e.y - 1, label, c);
        break;
      }
      case 'line': {
        const dx = e.dx ?? 1;
        const dy = e.dy ?? 0;
        // 外层色束 + 内层白核，命中端爆点
        this.effects.push({ kind: 'beam', x: e.x, y: e.y, dx, dy, color: c, life: 0.4, maxLife: 0.4, radius: 20 });
        this.effects.push({ kind: 'beam', x: e.x, y: e.y, dx, dy, color: 0xffffff, life: 0.18, maxLife: 0.18, radius: 16 });
        this.spawnBurst(e.x, e.y, c, 10, this.cell * 5, this.cell * 0.14, 0.4);
        this.spawnImpact(e.x + dx * 16, e.y + dy * 16, c);
        if (label) this.pushFloatText(e.x, e.y - 1, label, c);
        break;
      }
      case 'teleport': {
        // 起点白闪 + 蓝色涟漪 + 白色内环 + 飘字
        this.spawnBurst(e.x, e.y, 0x5aa9ff, 16, this.cell * 6, this.cell * 0.18, 0.55);
        this.spawnBurst(e.x, e.y, 0xffffff, 8, this.cell * 5, this.cell * 0.12, 0.35);
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0x5aa9ff, life: 0.5, maxLife: 0.5, radius: 2.2 });
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0xffffff, life: 0.25, maxLife: 0.25, radius: 1.2 });
        if (label) this.pushFloatText(e.x, e.y - 1, label, 0x5aa9ff);
        break;
      }
      case 'heal': {
        // 回春：绿色双环 + 白亮核 + 上升光点 + 飘字
        this.spawnBurst(e.x, e.y, 0x7ddb8f, 18, this.cell * 4, this.cell * 0.16, 0.9);
        this.spawnBurst(e.x, e.y, 0xffffff, 6, this.cell * 3, this.cell * 0.1, 0.5);
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0x7ddb8f, life: 0.6, maxLife: 0.6, radius: 2 });
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0xffffff, life: 0.3, maxLife: 0.3, radius: 1.2 });
        if (label) this.pushFloatText(e.x, e.y - 1, label, 0x7ddb8f);
        break;
      }
      case 'buff': {
        // buff：金色双环扩散 + 元素色粒子柱 + 飘字
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0xffd76a, life: 0.8, maxLife: 0.8, radius: 2.4 });
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: c, life: 0.5, maxLife: 0.5, radius: 1.4 });
        this.spawnBurst(e.x, e.y, c, 12, this.cell * 5, this.cell * 0.15, 0.6);
        this.spawnBurst(e.x, e.y, 0xffd76a, 6, this.cell * 4, this.cell * 0.1, 0.45);
        if (label) this.pushFloatText(e.x, e.y - 1, label, 0xffd76a);
        break;
      }
    }
  }

  /** v2.0.0：剑心绝技专属特效（比普通技能更酷炫） */
  private mindFx(e: SkillVisual): boolean {
    const c = this.elementColor(e.element);
    const x = e.x;
    const y = e.y;
    switch (e.id) {
      case 'skill_swordrain': { // 万剑归宗：金色剑雨 + 大扩散环
        this.spawnBurst(x, y, 0xffd76a, 26, this.cell * 7, this.cell * 0.18, 0.8);
        this.spawnBurst(x, y, c, 18, this.cell * 6, this.cell * 0.16, 0.6);
        this.spawnBurst(x, y, 0xffffff, 8, this.cell * 8, this.cell * 0.12, 0.35);
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: 0xffd76a, life: 0.9, maxLife: 0.9, radius: (e.radius ?? 4) + 1 });
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: c, life: 0.55, maxLife: 0.55, radius: 2.4 });
        break;
      }
      case 'skill_breakall': { // 一剑破万法：贯穿光束 + 沿途爆点
        const dx = e.dx ?? 1;
        const dy = e.dy ?? 0;
        this.effects.push({ kind: 'beam', x, y, dx, dy, color: 0xffd76a, life: 0.5, maxLife: 0.5, radius: 22 });
        this.effects.push({ kind: 'beam', x, y, dx, dy, color: 0xffffff, life: 0.22, maxLife: 0.22, radius: 18 });
        this.spawnBurst(x, y, c, 12, this.cell * 6, this.cell * 0.16, 0.5);
        this.spawnImpact(x + dx * 18, y + dy * 18, 0xffd76a);
        break;
      }
      case 'skill_heartlight': { // 剑心通明：蓝金双环 + 金身光晕
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: 0xffd76a, life: 1.0, maxLife: 1.0, radius: 3 });
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: 0x5aa9ff, life: 0.6, maxLife: 0.6, radius: 1.8 });
        this.spawnBurst(x, y, 0xffd76a, 16, this.cell * 6, this.cell * 0.15, 0.7);
        this.spawnBurst(x, y, 0x5aa9ff, 10, this.cell * 5, this.cell * 0.12, 0.5);
        break;
      }
      case 'skill_fixworld': { // 剑定乾坤：超大双环 + 全屏爆闪
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: 0xffd76a, life: 1.1, maxLife: 1.1, radius: (e.radius ?? 5) + 1.5 });
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: c, life: 0.7, maxLife: 0.7, radius: 3.2 });
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: 0xffffff, life: 0.4, maxLife: 0.4, radius: 2 });
        this.spawnBurst(x, y, 0xffd76a, 30, this.cell * 8, this.cell * 0.2, 0.9);
        this.spawnBurst(x, y, c, 20, this.cell * 7, this.cell * 0.16, 0.65);
        break;
      }
      case 'skill_flying': { // 天外飞仙：白金拖尾弹道 + 白色环爆
        const dx = e.dx ?? 1;
        const dy = e.dy ?? 0;
        this.effects.push({ kind: 'proj', x, y, dx, dy, color: 0xfff2c8, life: 2.4, maxLife: 2.4, radius: 0 });
        this.spawnBurst(x, y, 0xffffff, 10, this.cell * 6, this.cell * 0.14, 0.4);
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: 0xffffff, life: 0.5, maxLife: 0.5, radius: 2 });
        break;
      }
      case 'skill_thunderstroke': { // 雷音剑势：紫电贯穿 + 电弧爆点
        const dx = e.dx ?? 1;
        const dy = e.dy ?? 0;
        this.effects.push({ kind: 'beam', x, y, dx, dy, color: 0xb06cff, life: 0.5, maxLife: 0.5, radius: 24 });
        this.effects.push({ kind: 'beam', x, y, dx, dy, color: 0xffffff, life: 0.2, maxLife: 0.2, radius: 20 });
        this.spawnBurst(x, y, 0xb06cff, 18, this.cell * 7, this.cell * 0.16, 0.5);
        this.spawnImpact(x + dx * 20, y + dy * 20, 0xb06cff);
        break;
      }
      case 'skill_swordheaven': { // 万剑朝宗：全屏万剑齐发 + 金光冲天
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: 0xffd76a, life: 1.2, maxLife: 1.2, radius: (e.radius ?? 6) + 2 });
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: 0xffffff, life: 0.7, maxLife: 0.7, radius: 4 });
        this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color: c, life: 0.45, maxLife: 0.45, radius: 2.6 });
        this.spawnBurst(x, y, 0xffd76a, 40, this.cell * 9, this.cell * 0.22, 1.0);
        this.spawnBurst(x, y, c, 26, this.cell * 8, this.cell * 0.18, 0.7);
        this.spawnBurst(x, y, 0xffffff, 12, this.cell * 10, this.cell * 0.14, 0.4);
        break;
      }
      default:
        return false;
    }
    if (e.text) this.pushFloatText(x, y - 1, e.text, 0xffd76a);
    return true;
  }

  /** 命中爆点：亮核 + 元素色小环 */
  private spawnImpact(x: number, y: number, color: number): void {
    this.spawnBurst(x, y, color, 6, this.cell * 4, this.cell * 0.12, 0.3);
    this.effects.push({ kind: 'ring', x, y, dx: 0, dy: 0, color, life: 0.35, maxLife: 0.35, radius: 1.6 });
  }

  /** 飘字 (技能名/回春等)：上浮淡出，上限防 Text 对象堆积 */
  private pushFloatText(x: number, y: number, text: string, color: number): void {
    if (this.floatTexts.length >= 8 || !text) return;
    const t = new Text(text, {
      fontFamily: 'serif',
      fontSize: Math.max(11, this.cell * 1.2),
      fill: color,
      stroke: 0x0c1017,
      strokeThickness: 3,
      fontWeight: 'bold',
    });
    t.anchor.set(0.5);
    t.x = (x + 0.5) * this.cell;
    t.y = (y + 0.5) * this.cell;
    this.effectLayer.addChild(t);
    this.floatTexts.push({ t, x: t.x, y: t.y, vy: -this.cell * 1.3, life: 0.9, maxLife: 0.9 });
  }

  /** 推进特效 (弹道移动 / 生命周期) + 飘字 */
  private updateEffects(dt: number): void {
    const cell = this.cell;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.life <= 0) {
        // 弹道终点爆点 (命中目标/边界)
        if (e.kind === 'proj') this.spawnImpact(e.x, e.y, e.color);
        this.effects.splice(i, 1);
        continue;
      }
      if (e.kind === 'proj') {
        e.x += e.dx * 26 * dt;
        e.y += e.dy * 26 * dt;
        if (e.x < 0 || e.x >= this.width || e.y < 0 || e.y >= this.height) {
          this.spawnImpact(e.x, e.y, e.color);
          this.effects.splice(i, 1);
        }
      }
    }
    // 飘字推进
    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      const f = this.floatTexts[i];
      f.life -= dt;
      f.t.y += f.vy * dt;
      f.t.alpha = Math.min(1, (f.life / f.maxLife) * 1.6);
      if (f.life <= 0) {
        this.effectLayer.removeChild(f.t);
        f.t.destroy();
        this.floatTexts.splice(i, 1);
      }
    }
  }

  /** 每帧绘制特效到 eg */
  private drawEffects(): void {
    const eg = this.eg;
    eg.clear();
    const cell = this.cell;
    for (const e of this.effects) {
      const t = e.life / e.maxLife;
      const cx = (e.x + 0.5) * cell;
      const cy = (e.y + 0.5) * cell;
      if (e.kind === 'proj') {
        // 剑气弹道：亮核 + 拖尾
        eg.lineStyle(cell * 0.5, e.color, 0.9 * t);
        eg.moveTo(cx - e.dx * cell * 2, cy - e.dy * cell * 2);
        eg.lineTo(cx, cy);
        eg.lineStyle(0);
        eg.beginFill(0xffffff, Math.min(1, t * 1.6));
        eg.drawCircle(cx, cy, cell * 0.3);
        eg.endFill();
      } else if (e.kind === 'ring') {
        const r = e.radius * cell * (1 - t);
        eg.lineStyle(cell * 0.22, e.color, Math.min(1, t * 1.5));
        eg.drawCircle(cx, cy, Math.max(1, r));
        eg.lineStyle(0);
      } else if (e.kind === 'beam') {
        const len = e.radius * cell * t;
        eg.lineStyle(cell * 0.35, e.color, Math.min(1, t * 2.4));
        eg.moveTo(cx, cy);
        eg.lineTo(cx + e.dx * len, cy + e.dy * len);
        eg.lineStyle(0);
      }
    }
  }

  render(world: World, tick: number): void {
    const g = this.g;
    g.clear();
    const cell = this.cell;
    const w = world.config.width;
    const h = world.config.height;
    const b = world.bounds;

    // 混沌区 (已被天劫吞噬的区域)
    g.beginFill(CHAOS_COLOR, 0.92);
    if (b.minX > 0) g.drawRect(0, 0, b.minX * cell, h * cell);
    if (b.maxX < w - 1) g.drawRect((b.maxX + 1) * cell, 0, (w - b.maxX - 1) * cell, h * cell);
    if (b.minY > 0) g.drawRect(b.minX * cell, 0, (b.maxX - b.minX + 1) * cell, b.minY * cell);
    if (b.maxY < h - 1) g.drawRect(b.minX * cell, (b.maxY + 1) * cell, (b.maxX - b.minX + 1) * cell, (h - b.maxY - 1) * cell);
    g.endFill();

    // 火墙与残余混沌 (边界内的障碍) —— 增量遍历墙集合
    for (const k of world.wallCells) {
      const x = k % w;
      const y = (k / w) | 0;
      const inside = x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
      if (inside) {
        const pulse = 0.5 + 0.35 * Math.sin(tick * 0.12 + x * 1.7 + y * 1.3);
        g.beginFill(WALL_COLOR, pulse);
        g.drawRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
        g.endFill();
      }
    }

    // 剑域地形 (v2.3.0)：熔岩=赤红流浆 / 深水=幽蓝波光 —— 增量遍历地形集合
    for (const k of world.terrainCells) {
      const x = k % w;
      const y = (k / w) | 0;
      const inside = x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
      if (!inside) continue;
      const t = world.terrainAt(x, y);
      if (t === 'lava') {
        const pulse = 0.75 + 0.25 * Math.sin(tick * 0.16 + x * 2.3 + y * 1.9);
        g.beginFill(LAVA_COLOR, pulse);
        g.drawRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
        g.endFill();
        g.beginFill(0xffd76a, 0.5 + 0.3 * Math.sin(tick * 0.22 + x * 3.1 + y * 2.7));
        g.drawCircle((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.18);
        g.endFill();
      } else if (t === 'deepwater') {
        const pulse = 0.5 + 0.2 * Math.sin(tick * 0.1 + x * 1.3 + y * 1.7);
        g.beginFill(DEEPWATER_COLOR, pulse);
        g.drawRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
        g.endFill();
        // 波光纹理
        g.lineStyle(cell * 0.08, 0x6fb3e8, 0.35 + 0.25 * Math.sin(tick * 0.12 + x + y));
        g.moveTo(x * cell + 2, (y + 0.4) * cell);
        g.lineTo((x + 0.55) * cell, (y + 0.4) * cell);
        g.moveTo(x * cell + 3, (y + 0.75) * cell);
        g.lineTo((x + 0.6) * cell, (y + 0.75) * cell);
        g.lineStyle(0);
      }
    }

    // 庚金之气 (金色光点) —— 增量遍历食物集合
    for (const k of world.foodCells) {
      const x = k % w;
      const y = (k / w) | 0;
      const value = world.foodAt(x, y);
      if (value > 0) {
        const cx = (x + 0.5) * cell;
        const cy = (y + 0.5) * cell;
        const big = value > 15; // 陨星铁母更大更亮
        const pulse = 0.55 + 0.35 * Math.sin(tick * 0.2 + x + y);
        g.beginFill(FOOD_COLOR, pulse);
        g.drawCircle(cx, cy, big ? cell * 0.42 : cell * 0.3);
        g.endFill();
        g.beginFill(0xfff6d8, 0.8);
        g.drawCircle(cx, cy, big ? cell * 0.14 : cell * 0.09);
        g.endFill();
      }
    }

    // v2.3.0：奇遇种子——金色脉动灵光（可被熔岩封锁，瞬移可渡）
    if (world.encounterSeed) {
      const sx = world.encounterSeed.x;
      const sy = world.encounterSeed.y;
      if (sx >= b.minX && sx <= b.maxX && sy >= b.minY && sy <= b.maxY) {
        const cx = (sx + 0.5) * cell;
        const cy = (sy + 0.5) * cell;
        const pulse = 0.55 + 0.45 * Math.sin(tick * 0.18);
        g.lineStyle(cell * 0.1, 0xffd76a, 0.35 + 0.3 * Math.sin(tick * 0.18));
        g.drawCircle(cx, cy, cell * 0.52);
        g.lineStyle(0);
        g.beginFill(0xfff0c0, pulse);
        g.drawCircle(cx, cy, cell * 0.4);
        g.endFill();
        g.beginFill(0xffd76a, 0.95);
        g.drawCircle(cx, cy, cell * 0.2);
        g.endFill();
      }
    }

    // 剑意
    for (const s of world.swords.values()) {
      this.drawSword(g, s, tick);
    }

    // 选中高亮框
    if (this.selectedId) {
      const sel = world.swords.get(this.selectedId);
      if (sel) {
        const { x, y } = sel.state.position;
        const pulse = 0.7 + 0.3 * Math.sin(tick * 0.15);
        g.lineStyle(2.2, 0xffd76a, pulse);
        g.drawRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
        g.lineStyle(0);
      }
    }

    // 边界光晕
    g.lineStyle(1.5, 0x9a8cff, 0.5);
    g.drawRect(b.minX * cell, b.minY * cell, (b.maxX - b.minX + 1) * cell, (b.maxY - b.minY + 1) * cell);
    g.lineStyle(0);

    // 技能特效 (弹道/环形/光束)
    this.drawEffects();
  }

  private drawSword(g: Graphics, s: SwordAgent, tick: number): void {
    const cell = this.cell;
    const cx = (s.state.position.x + 0.5) * cell;
    const cy = (s.state.position.y + 0.5) * cell;
    const color = ELEMENT_COLOR[s.state.genome.element];
    const fx = s.state.facing.x;
    const fy = s.state.facing.y;
    // v2.0.0：剑身随剑心境界变大（凡心→忘我 ×1~×1.4），境界肉眼可辨
    const realm = Math.min(MIND_SWORD_SCALE.length - 1, Math.max(0, s.state.mindRealm ?? 0));
    const len = cell * 0.75 * MIND_SWORD_SCALE[realm];

    // 剑刃
    g.lineStyle(1.7, color, 0.95);
    g.moveTo(cx - fx * len * 0.5, cy - fy * len * 0.5);
    g.lineTo(cx + fx * len * 0.5, cy + fy * len * 0.5);
    // 剑格
    g.lineStyle(1.1, 0xe0b870, 0.9);
    const px = -fy;
    const py = fx;
    g.moveTo(cx + px * 2.4, cy + py * 2.4);
    g.lineTo(cx - px * 2.4, cy - py * 2.4);
    g.lineStyle(0);

    // v2.0.0：剑心境界光晕——境界愈高，金光愈盛
    if ((s.state.mindRealm ?? 0) > 0) {
      const glow = 0.12 + (s.state.mindRealm ?? 0) * 0.06;
      const wob = Math.sin(tick * 0.25 + s.state.position.x + s.state.position.y);
      g.beginFill(0xffd76a, glow + 0.04 * wob);
      g.drawCircle(cx, cy, cell * 0.8);
      g.endFill();
      g.lineStyle(1.2, 0xffd76a, 0.5 + 0.15 * wob);
      g.drawCircle(cx, cy, cell * 0.8);
      g.lineStyle(0);
    }

    // 本命血脉标记 (金色剑穗)：玩家剑胚一脉
    if (s.state.origin === 'seed') {
      g.beginFill(0xffd76a, 0.9);
      g.drawCircle(cx - fx * len * 0.6, cy - fy * len * 0.6, 1.7);
      g.endFill();
    }

    // 稀有词条标记：淬毒(绿) / 寄灵(紫)
    if (s.state.genome.affixes.includes('poison')) {
      g.beginFill(0x6fd08a, 0.9);
      g.drawCircle(cx + fx * len * 0.6, cy + fy * len * 0.6, 1.7);
      g.endFill();
    }
    if (s.state.genome.affixes.includes('parasite')) {
      g.beginFill(0xc48aff, 0.9);
      g.drawCircle(cx + fx * len * 0.6, cy + fy * len * 0.6, 1.7);
      g.endFill();
    }

    // 技能 buff 光环：加持期间剑身脉动 (攻=火红 / 防=水蓝，持续整个 buff 时长)
    const bAtk = s.state.buffAtkTicks ?? 0;
    const bDef = s.state.buffDefTicks ?? 0;
    if (bAtk > 0 || bDef > 0) {
      const aura = bAtk > 0 ? 0xff6a4a : 0x5aa9ff;
      const wob = Math.sin(tick * 0.3 + s.state.position.x + s.state.position.y);
      g.beginFill(aura, 0.1 + 0.07 * wob);
      g.drawCircle(cx, cy, cell * 0.92);
      g.endFill();
      g.lineStyle(1.6, aura, 0.6 + 0.2 * wob);
      g.drawCircle(cx, cy, cell * 0.92);
      g.lineStyle(0.8, 0xffd76a, 0.11 + 0.11 * wob);
      g.drawCircle(cx, cy, cell * 1.18);
      g.lineStyle(0);
    }

    // 淬毒：中毒期间绿色闪边
    if ((s.state.poisonTicks ?? 0) > 0) {
      const flicker = 0.55 + 0.45 * Math.sin(tick * 0.5 + s.state.position.x);
      g.lineStyle(1.4, 0x6fd08a, 0.5 * flicker);
      g.drawRect(s.state.position.x * cell + 1, s.state.position.y * cell + 1, cell - 2, cell - 2);
      g.lineStyle(0);
    }

    // v2.3.0：灼烧——烈焰燎身橙红闪边
    if ((s.state.burningTicks ?? 0) > 0) {
      const flicker = 0.55 + 0.45 * Math.sin(tick * 0.55 + s.state.position.x + s.state.position.y);
      g.lineStyle(1.4, 0xff6a2a, 0.55 * flicker);
      g.drawRect(s.state.position.x * cell + 1, s.state.position.y * cell + 1, cell - 2, cell - 2);
      g.lineStyle(0);
      g.beginFill(0xff8a3a, 0.25 * flicker);
      g.drawCircle(cx, cy, cell * 0.3);
      g.endFill();
    }
    // v2.3.0：定身——青藤缠绕绿圈
    if ((s.state.rootedTicks ?? 0) > 0) {
      const pulse = 0.5 + 0.3 * Math.sin(tick * 0.3 + s.state.position.x);
      g.lineStyle(1.6, 0x4ad68a, pulse);
      g.drawCircle(cx, cy, cell * 0.62);
      g.lineStyle(0);
    }
    // v2.3.0：减速/深水——水蓝迟滞光环
    if ((s.state.slowedTicks ?? 0) > 0 || s.world.isDeepWater(s.state.position.x, s.state.position.y)) {
      const pulse = 0.4 + 0.25 * Math.sin(tick * 0.22 + s.state.position.x + s.state.position.y);
      g.lineStyle(1.2, 0x5aa9ff, pulse);
      g.drawCircle(cx, cy, cell * 0.5);
      g.lineStyle(0);
    }

    // 濒死红芒
    if (s.state.hp < 30) {
      const flicker = 0.5 + 0.5 * Math.sin(tick * 0.6 + s.state.position.x);
      g.beginFill(0xff3333, flicker * 0.7);
      g.drawCircle(cx, cy, 2);
      g.endFill();
    }

    // 血条 (大比时显示)
    if (this.showBars) {
      const bw = cell - 3;
      const bx = cx - bw / 2;
      const by = cy - cell * 0.55;
      const ratio = Math.max(0, s.state.hp / 100);
      g.beginFill(0x22262e);
      g.drawRect(bx, by, bw, 2.4);
      g.endFill();
      g.beginFill(ratio > 0.5 ? 0x6fd08a : ratio > 0.25 ? 0xffc24a : 0xff4a4a);
      g.drawRect(bx, by, bw * ratio, 2.4);
      g.endFill();
    }
  }
}
