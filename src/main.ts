import './ui/style.css';
import { Game } from './Game';
import { initTooltips } from './ui/tooltip';

window.addEventListener('DOMContentLoaded', () => {
  initTooltips(); // v1.12.0：body 级悬浮解释（防灵鉴滚动容器裁剪）
  const game = new Game();
  // 调试用：暴露实例
  (window as unknown as { __game: Game }).__game = game;
});
