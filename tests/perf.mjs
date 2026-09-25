// Måler rigtige fps på maskinens grafikkort (headless Chromium med GPU, ikke SwiftShader).
// Brug: node tests/perf.mjs [url] [sekunder]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/?test=1';
const secs = +(process.argv[3] ?? 20);
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__btm && window.__btm.state === 'menu', null, { timeout: 180000 });
const gpu = await page.evaluate(() => {
  const gl = window.__btm.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log('GPU:', gpu);

// Start en runde og kør rundt: gå, cykel, bil (autopilot) mens fps måles
await page.evaluate(() => { const g = window.__btm; g.toSelect(); g.startCountdown(); });
await page.waitForFunction(() => window.__btm.state === 'playing', null, { timeout: 60000 });
const res = await page.evaluate(async (secs) => {
  const g = window.__btm;
  const car = g.vehicles.list.find((v) => v.kind === 'car' && v.pos.y < 1 && g.world.inPlayArea(v.pos.x, v.pos.z, 120));
  g.player.enterVehicle(car);
  const frames = [];
  let last = performance.now();
  const t0 = last;
  return await new Promise((resolve) => {
    function tick() {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      // autopilot: kør mod den længste frie retning, skift jævnligt
      const v = g.player.vehicle;
      if (v && frames.length % 20 === 0) {
        let best = 0, yaw = v.yaw;
        for (let i = 0; i < 16; i++) {
          const a = v.yaw + ((i - 8) / 16) * Math.PI;
          const h = g.physics.ray(v.pos.x, v.pos.y + 0.8, v.pos.z, -Math.sin(a), 0, -Math.cos(a), 40);
          const d = h ? h.toi : 40;
          if (d > best) { best = d; yaw = a; }
        }
        let d = Math.atan2(Math.sin(yaw - v.yaw), Math.cos(yaw - v.yaw));
        g.input.simulate('KeyA', d > 0.1);
        g.input.simulate('KeyD', d < -0.1);
        g.input.simulate('KeyW', v.speed < 16);
        g.input.simulate('KeyS', best < 6 && v.speed > 4);
      }
      if (now - t0 < secs * 1000) requestAnimationFrame(tick);
      else {
        for (const k of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) g.input.simulate(k, false);
        frames.shift();
        frames.sort((a, b) => a - b);
        const avg = frames.reduce((s, x) => s + x, 0) / frames.length;
        resolve({
          frames: frames.length, avgFps: 1000 / avg, p95ms: frames[Math.floor(frames.length * 0.95)], p99ms: frames[Math.floor(frames.length * 0.99)],
          cpuMs: g.cpuMs, pixelRatio: g.debugState().pixelRatio, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
          shadow: g.world.sky.sun.shadow.mapSize.x,
          prof: Object.fromEntries(Object.entries(g.prof).map(([k, v]) => [k, +v.toFixed(2)])),
        });
      }
    }
    requestAnimationFrame(tick);
  });
}, secs);
console.log(JSON.stringify(res, null, 1));
await browser.close();
