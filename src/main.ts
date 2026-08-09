import './ui/style.css';
import { Game } from './Game';

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  // 调试用：暴露实例
  (window as unknown as { __game: Game }).__game = game;
});
