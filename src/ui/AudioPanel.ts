import { el } from '../utils/dom';
import { openModal } from './modals';
import { audio } from '../audio/AudioManager';

/** 音律设置面板：背景乐/音效 开关 + 音量滑块（v2.3.1，主菜单/宗门大比共用） */
export function openAudioPanel(): void {
  const body = el('div', 'audio-panel');
  body.appendChild(el('p', 'audio-hint', '调节音量，亦可单独静音背景乐或音效。'));
  body.appendChild(buildAudioRow('背景乐', true, '🎵'));
  body.appendChild(buildAudioRow('音效', false, '🔊'));
  openModal('音 律', body, { width: 420 });
}

function buildAudioRow(label: string, isMusic: boolean, icon: string): HTMLElement {
  const row = el('div', 'audio-row');
  row.appendChild(el('div', 'audio-label', label));

  const toggle = el('button', 'btn btn-ghost audio-toggle', '') as HTMLButtonElement;
  const slider = el('input', 'audio-slider') as HTMLInputElement;
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  const pct = el('span', 'audio-pct', '');

  const readVolume = () => (isMusic ? audio.getMusicVolume() : audio.getSfxVolume());
  const isOn = () => (isMusic ? audio.getMusicEnabled() : audio.getSfxEnabled());

  const refresh = () => {
    const on = isOn();
    toggle.textContent = on ? `${icon} 开` : `${icon} 关`;
    toggle.classList.toggle('dimmed', !on);
    slider.value = String(Math.round(readVolume() * 100));
    pct.textContent = `${Math.round(readVolume() * 100)}%`;
  };

  toggle.addEventListener('click', () => {
    if (isMusic) audio.setMusicEnabled(!audio.getMusicEnabled());
    else audio.setSfxEnabled(!audio.getSfxEnabled());
    refresh();
  });
  slider.addEventListener('input', () => {
    const v = Number(slider.value) / 100;
    if (isMusic) audio.setMusicVolume(v);
    else audio.setSfxVolume(v);
    pct.textContent = `${Math.round(v * 100)}%`;
  });

  refresh();
  row.append(toggle, slider, pct);
  return row;
}
