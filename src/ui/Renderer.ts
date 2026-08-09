import { Container, Graphics } from 'pixi.js';
import type { World } from '../simulation/World';
import type { SwordAgent } from '../simulation/SwordAgent';
import { ELEMENT_COLOR } from '../simulation/Genetics';

const FOOD_COLOR = 0xffd76a;
const WALL_COLOR = 0xff5a2a;
const CHAOS_COLOR = 0x1c0f18;

/**
 * PixiJS 世界渲染器：绘制剑域网格、庚金之气、火墙、混沌区与剑意。
 * 每帧重建一个 Graphics，可承载数百剑意。
 */
export class WorldRenderer {
  readonly container: Container;
  private g: Graphics;
  private bg: Graphics;
  private cell: number;
  private width: number;
  private height: number;
  private showBars: boolean;
  private selectedId: string | null = null;

  constructor(container: Container, width: number, height: number, cell: number, showBars = false) {
    this.container = container;
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.showBars = showBars;
    this.bg = new Graphics();
    this.g = new Graphics();
    container.addChild(this.bg, this.g);
    this.bg.beginFill(0x0c1017);
    this.bg.drawRect(0, 0, width * cell, height * cell);
    this.bg.endFill();
  }

  /** 设置选中剑意 (绘制高亮框) */
  setSelected(id: string | null): void {
    this.selectedId = id;
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

    // 火墙与残余混沌 (边界内的障碍)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (world.isWall(x, y)) {
          const inside = x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
          if (inside) {
            const pulse = 0.5 + 0.35 * Math.sin(tick * 0.12 + x * 1.7 + y * 1.3);
            g.beginFill(WALL_COLOR, pulse);
            g.drawRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
            g.endFill();
          }
        }
      }
    }

    // 庚金之气 (金色光点)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
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
