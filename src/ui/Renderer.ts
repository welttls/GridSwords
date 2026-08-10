import { Container, Graphics } from 'pixi.js';
import type { World } from '../simulation/World';
import type { SwordAgent } from '../simulation/SwordAgent';
import { ELEMENT_COLOR } from '../simulation/Genetics';
import { eventBus, EVT, type ParticleEvent, type SkillVisual } from '../utils/eventBus';

const FOOD_COLOR = 0xffd76a;
const WALL_COLOR = 0xff5a2a;
const CHAOS_COLOR = 0x1c0f18;
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
    // 清理残留粒子
    for (const p of this.particles) this.particleLayer.removeChild(p.g);
    this.particles.length = 0;
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
    switch (e.kind) {
      case 'projectile': {
        const dx = e.dx ?? 1;
        const dy = e.dy ?? 0;
        this.effects.push({ kind: 'proj', x: e.x, y: e.y, dx, dy, color: c, life: 2, maxLife: 2, radius: 0 });
        this.spawnBurst(e.x, e.y, 0xffffff, 4, this.cell * 3, this.cell * 0.1, 0.25);
        break;
      }
      case 'aoe': {
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0xff6a4a, life: 0.6, maxLife: 0.6, radius: e.radius ?? 3 });
        this.spawnBurst(e.x, e.y, 0xff6a4a, 16, this.cell * 6, this.cell * 0.18, 0.6);
        break;
      }
      case 'line': {
        const dx = e.dx ?? 1;
        const dy = e.dy ?? 0;
        this.effects.push({ kind: 'beam', x: e.x, y: e.y, dx, dy, color: 0x9ac8ff, life: 0.3, maxLife: 0.3, radius: 20 });
        this.spawnBurst(e.x, e.y, 0x9ac8ff, 8, this.cell * 5, this.cell * 0.14, 0.4);
        break;
      }
      case 'teleport': {
        this.spawnBurst(e.x, e.y, 0x5aa9ff, 14, this.cell * 6, this.cell * 0.18, 0.55);
        this.spawnBurst(e.x, e.y, 0xffffff, 6, this.cell * 5, this.cell * 0.12, 0.35);
        break;
      }
      case 'heal': {
        this.spawnBurst(e.x, e.y, 0x7ddb8f, 14, this.cell * 4, this.cell * 0.16, 0.9);
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0x7ddb8f, life: 0.5, maxLife: 0.5, radius: 1.6 });
        break;
      }
      case 'buff': {
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, dx: 0, dy: 0, color: 0xffd76a, life: 0.7, maxLife: 0.7, radius: 2 });
        break;
      }
    }
  }

  /** 推进特效 (弹道移动 / 生命周期) */
  private updateEffects(dt: number): void {
    const cell = this.cell;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.effects.splice(i, 1);
        continue;
      }
      if (e.kind === 'proj') {
        e.x += e.dx * 26 * dt;
        e.y += e.dy * 26 * dt;
        if (e.x < 0 || e.x >= this.width || e.y < 0 || e.y >= this.height) {
          this.effects.splice(i, 1);
        }
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
    const len = cell * 0.75;

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
