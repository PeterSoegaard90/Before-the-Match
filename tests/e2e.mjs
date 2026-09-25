// Ende-til-ende-test i headless Chromium: menu → valg → nedtælling → runde → kørsel → fanzone → slutskærm.
// Brug: node tests/e2e.mjs [url] [skærmbillede-mappe]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/?test=1';
const outDir = process.argv[3] ?? 'test-results';
mkdirSync(outDir, { recursive: true });
const errors = [];
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'OK  ' : 'FEJL'} ${name}${info ? ' – ' + info : ''}`);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${outDir}/${n}.png` });
const st = () => page.evaluate(() => window.__btm.debugState());
const wait = (ms) => page.waitForTimeout(ms);
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
// Vent på spiltid (robust ved lav fps i software-rendering)
const gameNow = () => page.evaluate(() => window.__btm.now);
const waitGame = async (sec) => { const t0 = await gameNow(); await page.waitForFunction((t) => window.__btm.now >= t, t0 + sec, { timeout: 120000 }); };
const holdGame = async (key, sec) => { await page.keyboard.down(key); await waitGame(sec); await page.keyboard.up(key); };
// Drej køretøjet mod den længste frie retning
const aimFree = () => page.evaluate(() => {
  const g = window.__btm, v = g.player.vehicle;
  let best = 0, bestYaw = v.yaw;
  for (let k = 0; k < 24; k++) {
    const yaw = (k / 24) * Math.PI * 2;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const h = g.physics.ray(v.pos.x, v.pos.y + 0.8, v.pos.z, dx, 0, dz, 60);
    const d = h ? h.toi : 60;
    if (d > best) { best = d; bestYaw = yaw; }
  }
  v.yaw = bestYaw;
  return best;
});

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__btm && window.__btm.state === 'menu', null, { timeout: 180000 });
  await wait(1500);
  await shot('01-menu');
  check('menu vises', (await st()).state === 'menu');

  await page.click('[data-act="play"]');
  await wait(800);
  check('roligan-valg vises', (await st()).state === 'select');
  await page.keyboard.press('ArrowRight');
  await wait(600);
  await shot('02-select');
  const selName = await page.textContent('#selname');
  check('piletast skifter roligan', selName === 'Lone', selName);

  await page.click('[data-act="confirm"]');
  await wait(150);
  check('nedtælling', (await st()).state === 'countdown');
  await wait(600);
  await shot('03-countdown');
  await page.waitForFunction(() => window.__btm.state === 'playing', null, { timeout: 15000 });
  await wait(600);
  const s0 = await st();
  check('runden starter', s0.state === 'playing' && s0.timeLeft <= 300, `tid ${s0.timeLeft.toFixed(1)}`);
  await shot('04-playing');

  // Gå og løb
  await holdGame('KeyW', 1.5);
  await page.keyboard.down('ShiftLeft');
  await holdGame('KeyW', 1.2);
  await page.keyboard.up('ShiftLeft');
  const s1 = await st();
  const moved = Math.hypot(s1.pos[0] - s0.pos[0], s1.pos[2] - s0.pos[2]);
  check('spilleren bevæger sig', moved > 4, `${moved.toFixed(1)} m`);
  await shot('05-walked');

  // Hop
  const y0 = (await st()).pos[1];
  await page.keyboard.down('Space');
  await waitGame(0.2);
  const yJ = (await st()).pos[1];
  await page.keyboard.up('Space');
  check('hop', yJ > y0 + 0.3, `${(yJ - y0).toFixed(2)} m`);
  await wait(800);

  // Fadøl: teleportér hen til en bar
  const got = await page.evaluate(() => {
    const g = window.__btm;
    const b = g.beers.beers.find((x) => x.kind === 'bar' && x.available && x.pos.y === 0);
    g.player.teleport(b.pos.x + 3, 0, b.pos.z);
    return [b.pos.x, b.pos.z];
  });
  await wait(300);
  await page.evaluate(([x, z]) => window.__btm.player.teleport(x, 0, z), got);
  await wait(500);
  const s2 = await st();
  check('fadøl samles op', s2.beers >= 1 && s2.points >= 100, `${s2.beers} fadøl, ${s2.points} point`);
  await shot('06-beer');

  // Cykel: gå hen til nærmeste cykel og tag den
  const bike = await page.evaluate(() => {
    const g = window.__btm;
    const v = g.vehicles.list.find((x) => x.kind === 'bike' && g.world.inPlayArea(x.pos.x, x.pos.z, 80));
    g.player.teleport(v.pos.x + 1.2, 0, v.pos.z);
    return v.id;
  });
  await wait(400);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__btm.player.vehicle !== null, null, { timeout: 20000 }).catch(() => {});
  check('tag cyklen', (await st()).vehicle === 'bike', `id ${bike}`);
  const freeBike = await aimFree();
  const sb0 = await st();
  await holdGame('KeyW', 2.0);
  const sb1 = await st();
  check('cykling', Math.hypot(sb1.pos[0] - sb0.pos[0], sb1.pos[2] - sb0.pos[2]) > 6, `${Math.hypot(sb1.pos[0] - sb0.pos[0], sb1.pos[2] - sb0.pos[2]).toFixed(1)} m (fri vej ${freeBike.toFixed(0)} m)`);
  await shot('07-bike');
  await page.keyboard.press('KeyE');
  await waitGame(0.3);
  check('stig af cyklen', (await st()).vehicle === null);

  // Bil: stjæl en bil
  await page.evaluate(() => {
    const g = window.__btm;
    const v = g.vehicles.list.find((x) => x.kind === 'car' && x.pos.y < 1 && g.world.inPlayArea(x.pos.x, x.pos.z, 80));
    const e = v.exitPoints()[0];
    g.player.teleport(e.x, 0, e.z);
  });
  await wait(400);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__btm.player.vehicle !== null, null, { timeout: 30000 }).catch(() => {});
  check('stjæl bil', (await st()).vehicle === 'car');
  const freeCar = await aimFree();
  const sc0 = await st();
  await holdGame('KeyW', 2.5);
  await page.keyboard.down('KeyA');
  await holdGame('KeyW', 0.8);
  await page.keyboard.up('KeyA');
  const sc1 = await st();
  check('bilkørsel', Math.hypot(sc1.pos[0] - sc0.pos[0], sc1.pos[2] - sc0.pos[2]) > 12, `${Math.hypot(sc1.pos[0] - sc0.pos[0], sc1.pos[2] - sc0.pos[2]).toFixed(1)} m (fri vej ${freeCar.toFixed(0)} m)`);
  await shot('08-car');

  // Kort
  await page.keyboard.press('KeyM');
  await wait(500);
  check('stort kort', (await st()).state === 'map');
  await shot('09-map');
  await page.keyboard.press('KeyM');
  await wait(300);

  // Politi: giv stjerner og se HUD
  await page.evaluate(() => { const g = window.__btm; g.wanted.offense(); g.wanted.offense(); });
  await wait(600);
  check('stjerner i HUD', (await page.$$('#stars svg.on')).length === 2);

  // Spol frem til fanzonen
  await page.evaluate(() => { window.__btm.round.timeLeft = 61; });
  await waitGame(1.5);
  const s3 = await st();
  check('fanzone afsløret', s3.revealed, s3.fanzone);
  await shot('10-fanzone-reveal');
  await page.evaluate(() => {
    const g = window.__btm;
    if (g.player.vehicle) g.player.exitVehicle(g.player.vehicle.exitPoints()[0]);
    g.wanted.arrested();
    const c = g.fanzone.center;
    g.player.teleport(c.x + 4, 0, c.z + 4);
  });
  await page.waitForFunction(() => window.__btm.round.outcome !== null, null, { timeout: 30000 }).catch(() => {});
  await wait(800);
  await shot('11-fanzone');
  const s4 = await st();
  check('nået fanzonen', s4.outcome === 'ontime', s4.outcome);
  await page.waitForSelector('#endpanel h1', { timeout: 10000 });
  await wait(600);
  await shot('12-end');
  const hasName = await page.$('#hsname');
  if (hasName) {
    await page.fill('#hsname', 'Testroligan');
    await page.click('[data-act="save"]');
    await wait(400);
  }
  const hsRows = await page.$$('table.hs tbody tr');
  check('highscore gemt', hsRows.length >= 1, `${hsRows.length} rækker`);
  await shot('13-highscore');
  const perf = await st();
  console.log('ydelse', JSON.stringify({ calls: perf.calls, triangles: perf.triangles, pixelRatio: perf.pixelRatio }));
} catch (e) {
  errors.push('TEST: ' + e.message);
  await shot('99-fejl').catch(() => {});
}
await browser.close();
const bad = results.filter((r) => !r.ok);
if (errors.length) console.log('JS-fejl:\n' + errors.map((e) => '  ' + e).join('\n'));
console.log(`\n${results.length - bad.length}/${results.length} tjek bestået, ${errors.length} JS-fejl`);
process.exit(bad.length || errors.length ? 1 : 0);
