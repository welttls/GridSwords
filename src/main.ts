import './ui/style.css';
import { Game } from './Game';
import { initTooltips } from './ui/tooltip';
import { audio } from './audio/AudioManager';
import { eventBus } from './utils/eventBus';

window.addEventListener('DOMContentLoaded', () => {
  initTooltips(); // v1.12.0：body 级悬浮解释（防灵鉴滚动容器裁剪）
  const game = new Game();
  // 调试用：暴露实例
  (window as unknown as { __game: Game }).__game = game;
  (window as unknown as { __audio: typeof audio }).__audio = audio; // v2.2.0 音频调试
  (window as unknown as { __eventBus: typeof eventBus }).__eventBus = eventBus; // v2.2.0 音频调试
});
