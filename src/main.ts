import './ui/styles.css';
import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
try {
  (window as any).__game = new Game(canvas, ui);
} catch (err) {
  // WebGL unavailable (or blocked): say so instead of showing a black page.
  console.error(err);
  ui.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;pointer-events:auto">
    <div><h1 style="font-family:var(--display)">Amped Ascent needs WebGL</h1>
    <p style="color:var(--muted)">This browser could not start the 3D renderer. Try a current Chrome, Safari, Firefox or Edge with hardware acceleration enabled.</p></div></div>`;
}
