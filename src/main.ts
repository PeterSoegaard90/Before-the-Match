// Before the Match – indgang.
import '@fontsource/luckiest-guy/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './ui/ui.css';
import { Game } from './game/game.ts';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  if (!webglAvailable()) {
    ui.innerHTML = `<div class="screen solid"><div class="panel"><h2>Din browser understøtter ikke WebGL 2</h2><p>Before the Match kræver en nyere udgave af Chrome, Edge eller Firefox med hardwareacceleration slået til.</p></div></div>`;
    return;
  }
  const game = new Game(canvas, ui);
  try {
    await game.init();
  } catch (e) {
    console.error(e);
    game.ui.showError(`Spillet kunne ikke starte: ${(e as Error).message ?? e}. Prøv at genindlæse siden.`);
  }
}

void boot();
