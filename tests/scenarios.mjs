// Scenarietests af de sværere mekanikker (kræver kørende dev-server).
// Brug: node tests/scenarios.mjs [url] [skærmbillede-mappe] [kun-disse,scenarier]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/?test=1';
const outDir = process.argv[3] ?? 'test-results';
const only = process.argv[4]?.split(',');
mkdirSync(outDir, { recursive: true });
const results = [];
const errors = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'OK  ' : 'FEJL'} ${name}${info ? ' – ' + info : ''}`);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${outDir}/${n}.png` });
const gameNow = () => page.evaluate(() => window.__btm.now);
const waitGame = async (sec) => { const t0 = await gameNow(); await page.waitForFunction((t) => window.__btm.now >= t, t0 + sec, { timeout: 240000 }); };

await page.goto(url);
await page.waitForFunction(() => window.__btm && window.__btm.state === 'menu', null, { timeout: 180000 });

async function newRound() {
  await page.evaluate(() => { const g = window.__btm; g.toMenu(); g.toSelect(); g.startCountdown(); });
  await page.waitForFunction(() => window.__btm.state === 'playing', null, { timeout: 60000 });
}

// Autopilot i siden: følger waypoints, holder W, trykker Mellemrum jævnligt
async function climb(waypoints, timeoutSec) {
  return page.evaluate(async ({ waypoints, timeoutSec }) => {
    const g = window.__btm;
    const inp = g.input;
    let wp = 0;
    const t0 = g.now;
    let lastJump = 0;
    let stuck = 0;
    return await new Promise((resolve) => {
      const iv = setInterval(() => {
        const p = g.player.pos;
        let w = waypoints[wp];
        let dx = w[0] - p.x, dz = w[2] - p.z;
        let d = Math.hypot(dx, dz);
        if (p.y > w[1] - 0.35 && d < 0.9 && wp < waypoints.length - 1) {
          wp++;
          w = waypoints[wp];
          dx = w[0] - p.x; dz = w[2] - p.z;
          d = Math.hypot(dx, dz);
        }
        g.cam.yaw = Math.atan2(-dx, -dz);
        inp.simulate('KeyW', d > 0.25);
        const hs = Math.hypot(g.player.vel.x, g.player.vel.z);
        stuck = d > 0.3 && hs < 0.4 ? stuck + 0.04 : 0;
        if (g.now - lastJump > 0.45 && g.player.mode === 'foot' && g.player.grounded && (w[1] - p.y) > 0.4 && (d < 1.7 || stuck > 0.3)) {
          inp.simulate('Space', true);
          setTimeout(() => inp.simulate('Space', false), 60);
          lastJump = g.now;
        }
        const done = wp === waypoints.length - 1 && p.y > w[1] - 0.35 && d < 0.8;
        if (done || g.now - t0 > timeoutSec) {
          clearInterval(iv);
          inp.simulate('KeyW', false);
          resolve({ ok: done, y: p.y, wp, t: g.now - t0 });
        }
      }, 40);
    });
  }, { waypoints, timeoutSec });
}

const run = (name) => !only || only.includes(name);

try {
  await newRound();

  // ---------------------------------------------------------------- platforme
  if (run('platforms')) {
    const sites = await page.evaluate(() => window.__btm.world.city.platforms.map((s, i) => ({ ...s, i })));
    let okCount = 0;
    for (const s of sites) {
      const h = s.heading;
      const rx = Math.cos(h), rz = -Math.sin(h), fx = -Math.sin(h), fz = -Math.cos(h);
      const at = (x, d, y) => [s.pos[0] + rx * x + fx * d, y, s.pos[1] + rz * x + fz * d];
      let start, wps;
      if (s.kind === 'container') { start = at(5.6, 0, 0); wps = [at(3.9, 0, 1.1), at(-1, 0, 2.6)]; }
      else if (s.kind === 'scaffold') { start = at(2, 3.2, 0); wps = [at(2, 0.9, 2.0), at(-0.7, 0.9, 4.2), at(0.7, 0.9, 6.4), at(2.4, 0.9, 6.4)]; }
      else { start = at(4.9, 1.2, 0); wps = [at(3.4, 1.2, 1.54), at(-0.5, 1.1, 3.03)]; }
      const beers0 = await page.evaluate(() => window.__btm.round.beers);
      await page.evaluate((st) => window.__btm.player.teleport(st[0], 0.05, st[2]), start);
      await waitGame(0.3);
      const r = await climb(wps, 25);
      await waitGame(0.4);
      const beers1 = await page.evaluate(() => window.__btm.round.beers);
      const ok = r.ok && beers1 > beers0;
      if (ok) okCount++;
      check(`platform ${s.i} (${s.kind})`, ok, `y=${r.y.toFixed(2)} waypoint ${r.wp}/${wps.length - 1} fadøl ${beers0}→${beers1} ${r.t.toFixed(1)}s`);
      if (!ok || s.i === 0 || s.kind === 'scaffold') await shot(`p-${s.i}-${s.kind}`);
    }
    check('alle platforme kan bestiges', okCount === sites.length, `${okCount}/${sites.length}`);
  }

  // ---------------------------------------------------------------- spiralrampe til Sallings tag
  if (run('helix')) {
    const res = await page.evaluate(async () => {
      const g = window.__btm;
      const H = g.world.city.parkingHelix;
      const inp = g.input;
      const car = g.vehicles.list.find((v) => v.kind === 'car' && v.pos.y < 1);
      const tStart = H.endAngle - H.turns * Math.PI * 2;
      const rMid = (H.rInner + H.rOuter) / 2;
      // Start lidt før rampen, på jorden, i tangentens retning
      const a0 = tStart - 0.35;
      const x = H.center[0] + Math.cos(a0) * rMid, z = H.center[1] + Math.sin(a0) * rMid;
      const tx = -Math.sin(a0), tz = Math.cos(a0);
      car.body.setTranslation({ x, y: car.spec.rideHeight + 0.05, z }, true);
      car.body.setRotation({ x: 0, y: Math.sin(Math.atan2(-tx, -tz) / 2), z: 0, w: Math.cos(Math.atan2(-tx, -tz) / 2) }, true);
      car.syncVisual(0);
      g.player.enterVehicle(car);
      car.yaw = Math.atan2(-tx, -tz);
      const t0 = g.now;
      let maxY = 0;
      return await new Promise((resolve) => {
        const iv = setInterval(() => {
          const v = g.player.vehicle;
          const dx = v.pos.x - H.center[0], dz = v.pos.z - H.center[1];
          const ang = Math.atan2(dz, dx);
          const r = Math.hypot(dx, dz);
          // ønsket retning: tangent (stigende vinkel) + korrektion mod midterlinjen
          let hx = -Math.sin(ang), hz = Math.cos(ang);
          const corr = (rMid - r) * 0.35;
          hx += Math.cos(ang) * corr; hz += Math.sin(ang) * corr;
          const want = Math.atan2(-hx, -hz);
          let d = want - v.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          inp.simulate('KeyA', d > 0.04);
          inp.simulate('KeyD', d < -0.04);
          inp.simulate('KeyW', v.speed < 7);
          maxY = Math.max(maxY, v.pos.y);
          if (v.pos.y > H.top - 0.6 || g.now - t0 > 60) {
            clearInterval(iv);
            for (const k of ['KeyA', 'KeyD', 'KeyW']) inp.simulate(k, false);
            resolve({ top: v.pos.y, maxY, t: g.now - t0 });
          }
        }, 30);
      });
    });
    check('spiralrampe: bil kører op til taget', res.top > 23, `y=${res.top.toFixed(1)} maks=${res.maxY.toFixed(1)} på ${res.t.toFixed(1)}s`);
    await shot('helix-top');
    // Gå fra landingspladsen over gangbroen til Sallings tagterrasse
    const walk = await page.evaluate(async () => {
      const g = window.__btm;
      const v = g.player.vehicle;
      g.player.exitVehicle(v.exitPoints()[0].setY(v.pos.y + 0.1));
      const sb = g.world.city.skybridge;
      const roof = g.world.city.sallingRoof.center;
      const beers0 = g.round.beers;
      const pts = [[sb.b[0], sb.b[1]], [sb.a[0], sb.a[1]], [roof[0], roof[1]]];
      // stig af på dækket ved gangbroen for at teste stien derfra
      g.player.teleport(sb.b[0] + (sb.b[0] - sb.a[0]) * 1.2, 24.1, sb.b[1] + (sb.b[1] - sb.a[1]) * 1.2);
      let i = 0;
      const t0 = g.now;
      return await new Promise((resolve) => {
        const iv = setInterval(() => {
          const p = g.player.pos;
          const w = pts[i];
          const dx = w[0] - p.x, dz = w[1] - p.z;
          if (Math.hypot(dx, dz) < 1.2 && i < pts.length - 1) i++;
          g.cam.yaw = Math.atan2(-dx, -dz);
          g.input.simulate('KeyW', true);
          if (g.round.beers > beers0 || g.now - t0 > 25 || p.y < 20) {
            clearInterval(iv);
            g.input.simulate('KeyW', false);
            resolve({ got: g.round.beers > beers0, y: p.y, i });
          }
        }, 40);
      });
    });
    check('gangbro → tagterrassens fadøl', walk.got, `y=${walk.y.toFixed(1)} waypoint ${walk.i}`);
    await shot('salling-roof');
  }

  // ---------------------------------------------------------------- hooligans
  if (run('hooligans')) {
    await newRound();
    const r = await page.evaluate(async () => {
      const g = window.__btm;
      for (let i = 0; i < 3; i++) g.round.addBeer();
      // Vælg en hooligan-leder og et frit punkt 3 m væk med fri sigt
      let h = null, spot = null;
      for (const cand of g.npcs.hools.filter((x) => !x.leader)) {
        for (let k = 0; k < 16 && !spot; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = cand.pos.x + Math.cos(a) * 3, z = cand.pos.z + Math.sin(a) * 3;
          if (!g.world.insideBuilding(x, z, 0.5) && !g.world.water.isWater(x, z) && g.physics.lineOfSight(cand.pos.x, 1.6, cand.pos.z, x, 1.4, z)) spot = [x, z];
        }
        if (spot) { h = cand; break; }
      }
      g.player.teleport(spot[0], 0.05, spot[1]);
      const t0 = g.now;
      return await new Promise((resolve) => {
        const iv = setInterval(() => {
          if (g.round.stats.beersDropped > 0 || g.now - t0 > 20) { clearInterval(iv); resolve({ dropped: g.round.stats.beersDropped, beers: g.round.beers, t: g.now - t0 }); }
        }, 50);
      });
    });
    check('hooligan slår en fadøl ud af hånden', r.dropped === 1 && r.beers === 2, `efter ${r.t.toFixed(1)}s, fadøl ${r.beers}`);
    await shot('hool-hit');
    const rec = await page.evaluate(async () => {
      const g = window.__btm;
      // Flyt væk fra hooliganen, så vi måler ét enkelt drop→genfind uden nye slag
      g.player.teleport(g.world.city.spawn.pos[0], 0.05, g.world.city.spawn.pos[1]);
      await new Promise((res) => setTimeout(res, 150));
      const before = g.round.stats.beersRecovered;
      const beersBefore = g.round.beers;
      g.beers.drop({ x: g.player.pos.x, y: 0.5, z: g.player.pos.z }, 1, 0, g.now, (x, z) => !g.world.insideBuilding(x, z, 0.4) && !g.world.water.isWater(x, z));
      g.round.stats.beersDropped++;
      let b = null;
      for (let i = 0; i < 40; i++) {
        b = g.beers.beers.find((x) => x.kind === 'dropped' && x.available && !x.flight);
        if (b) break;
        await new Promise((res) => setTimeout(res, 50));
      }
      if (!b) return { ok: false, why: 'ingen landet tabt fadøl' };
      g.player.teleport(b.pos.x, b.pos.y + 0.05, b.pos.z);
      await new Promise((res) => setTimeout(res, 500));
      return { ok: g.round.stats.beersRecovered === before + 1 && g.round.beers === beersBefore + 1, before, after: g.round.stats.beersRecovered, beers: g.round.beers, beersBefore };
    });
    check('tabt fadøl kan samles op igen', rec.ok, JSON.stringify(rec));
    // Slå hooliganen ud: tre slag
    const ko = await page.evaluate(async () => {
      const g = window.__btm;
      const h = g.npcs.hools.find((x) => x.state === 'chase' || x.state === 'attack') ?? g.npcs.hools[0];
      let hits = 0;
      const t0 = g.now;
      return await new Promise((resolve) => {
        const iv = setInterval(() => {
          const p = g.player.pos;
          const dx = h.pos.x - p.x, dz = h.pos.z - p.z;
          g.player.yaw = Math.atan2(-dx, -dz);
          g.cam.yaw = g.player.yaw;
          if (Math.hypot(dx, dz) > 1.1) g.player.teleport(h.pos.x - dx / Math.hypot(dx, dz) * 1.0, h.pos.y + 0.05, h.pos.z - dz / Math.hypot(dx, dz) * 1.0, Math.atan2(-dx, -dz));
          if (g.player.punchCooldown <= 0) { g.input.simulateMouse(0); hits++; }
          if (h.state === 'ko' || g.now - t0 > 15) { clearInterval(iv); resolve({ state: h.state, ko: g.round.stats.hooligansKO, hits }); }
        }, 60);
      });
    });
    check('tre slag slår en hooligan ud', ko.state === 'ko' && ko.ko >= 1, JSON.stringify(ko));
    await shot('hool-ko');
  }

  // ---------------------------------------------------------------- politi og anholdelse
  if (run('police')) {
    await newRound();
    const r = await page.evaluate(async () => {
      const g = window.__btm;
      for (let i = 0; i < 10; i++) g.round.addBeer();
      const cop = g.npcs.cops.find((c) => !c.onBike);
      g.player.teleport(cop.pos.x + 6, 0.05, cop.pos.z);
      g.wanted.offense();
      g.wanted.offense();
      g.lastSeenPos.copy(g.player.pos);
      const t0 = g.now;
      return await new Promise((resolve) => {
        const iv = setInterval(() => {
          if (g.round.stats.arrests > 0 || g.now - t0 > 25) { clearInterval(iv); resolve({ arrests: g.round.stats.arrests, points: g.round.points, stars: g.wanted.stars, t: g.now - t0 }); }
        }, 50);
      });
    });
    check('politiet anholder (2 stjerner = −20 %)', r.arrests === 1 && r.points === 800 && r.stars === 0, JSON.stringify(r));
    await shot('arrest');
    // Undslippe: stjerne, langt væk fra alle betjente
    const esc = await page.evaluate(async () => {
      const g = window.__btm;
      g.wanted.immunity = 0;
      g.wanted.offense();
      const far = g.world.city.spawn.pos;
      g.player.teleport(far[0], 0.05, far[1]);
      const t0 = g.now;
      return await new Promise((resolve) => {
        const iv = setInterval(() => {
          if (g.wanted.stars === 0 || g.now - t0 > 30) { clearInterval(iv); resolve({ stars: g.wanted.stars, t: g.now - t0 }); }
        }, 100);
      });
    });
    check('man slipper væk ude af syne', esc.stars === 0, `efter ${esc.t.toFixed(1)}s`);
  }

  // ---------------------------------------------------------------- vand
  if (run('water')) {
    await newRound();
    const w = await page.evaluate(async () => {
      const g = window.__btm;
      const a = g.world.city.areas.find((x) => x.kind === 'water' && g.world.inPlayArea(x.outer[0][0], x.outer[0][1], 60));
      // find et punkt midt i vandet
      let pt = null;
      for (let k = 0; k < 400 && !pt; k++) {
        const i = Math.floor(Math.random() * a.outer.length), j = Math.floor(Math.random() * a.outer.length);
        const x = (a.outer[i][0] + a.outer[j][0]) / 2, z = (a.outer[i][1] + a.outer[j][1]) / 2;
        if (g.world.water.isWater(x, z)) pt = [x, z];
      }
      g.player.teleport(pt[0], 0.05, pt[1]);
      await new Promise((res) => setTimeout(res, 400));
      const splashed = g.player.mode === 'water';
      const t0 = g.now;
      await new Promise((resolve) => { const iv = setInterval(() => { if (g.player.mode === 'foot' || g.now - t0 > 10) { clearInterval(iv); resolve(); } }, 50); });
      return { splashed, mode: g.player.mode, y: g.player.pos.y, dry: !g.world.water.isWater(g.player.pos.x, g.player.pos.z), splashes: g.round.stats.splashes };
    });
    check('plask i Åen og op på land igen', w.splashed && w.mode === 'foot' && w.dry && w.y > -0.5, JSON.stringify(w));
  }

  // ---------------------------------------------------------------- påkørsel
  if (run('knockdown')) {
    await newRound();
    const k = await page.evaluate(async () => {
      const g = window.__btm;
      const car = g.vehicles.list.find((v) => v.kind === 'car' && v.pos.y < 1 && g.world.inPlayArea(v.pos.x, v.pos.z, 80));
      g.player.enterVehicle(car);
      // find den længste frie retning
      let best = 0, yaw = 0;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const h = g.physics.ray(car.pos.x, car.pos.y + 0.8, car.pos.z, -Math.sin(a), 0, -Math.cos(a), 50);
        const d = h ? h.toi : 50;
        if (d > best) { best = d; yaw = a; }
      }
      car.yaw = yaw;
      const ped = g.npcs.peds[0];
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      ped.pos.set(car.pos.x + fx * 14, 0, car.pos.z + fz * 14);
      ped.setState('angry');
      ped.stateTime = -100; // står stille
      const t0 = g.now;
      g.input.simulate('KeyW', true);
      return await new Promise((resolve) => {
        const iv = setInterval(() => {
          if (ped.state === 'down' || g.now - t0 > 8) { clearInterval(iv); g.input.simulate('KeyW', false); resolve({ state: ped.state, knocked: g.round.stats.pedestriansKnocked, free: best }); }
        }, 30);
      });
    });
    check('fodgænger vælter ved påkørsel', k.state === 'down' && k.knocked === 1, JSON.stringify(k));
    await waitGame(0.6);
    await shot('knockdown');
  }

  // ---------------------------------------------------------------- for sent
  if (run('late')) {
    await newRound();
    const l = await page.evaluate(async () => {
      const g = window.__btm;
      for (let i = 0; i < 7; i++) g.round.addBeer();
      g.round.timeLeft = 2;
      await new Promise((resolve) => { const iv = setInterval(() => { if (g.round.finished) { clearInterval(iv); resolve(); } }, 50); });
      return { outcome: g.round.outcome, points: g.round.points };
    });
    check('for sent til kickoff halverer pointene', l.outcome === 'late' && l.points === 350, JSON.stringify(l));
    await page.waitForSelector('#endpanel h1', { timeout: 20000 });
    await shot('late-end');
  }

  // ---------------------------------------------------------------- menuer
  if (run('menus')) {
    await page.evaluate(() => window.__btm.toMenu());
    await page.waitForTimeout(400);
    for (const act of ['controls', 'settings', 'credits', 'highscores']) {
      await page.click(`[data-screen="menu"] [data-act="${act}"]`);
      await page.waitForTimeout(300);
      await shot(`menu-${act}`);
      const vis = await page.evaluate((a) => !document.querySelector(`[data-screen="${a}"]`).classList.contains('hidden'), act);
      check(`menu: ${act}`, vis);
      await page.click(`[data-screen="${act}"] [data-act="back"]`);
      await page.waitForTimeout(200);
    }
    // indstillinger gemmes
    await page.click(`[data-screen="menu"] [data-act="settings"]`);
    await page.fill('#sens', '2');
    await page.dispatchEvent('#sens', 'input');
    await page.click('#inv');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('btm.settings.v1')));
    check('indstillinger gemmes', saved.sensitivity === 2 && saved.invertY === true, JSON.stringify(saved));
    await page.click(`[data-screen="settings"] [data-act="back"]`);
    // pause
    await newRound();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('pause med Esc', (await page.evaluate(() => window.__btm.state)) === 'paused');
    await shot('pause');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('fortsæt med Esc', (await page.evaluate(() => window.__btm.state)) === 'playing');
  }
} catch (e) {
  errors.push('TEST: ' + e.message);
  await shot('scen-fejl').catch(() => {});
}
await browser.close();
const bad = results.filter((r) => !r.ok);
if (errors.length) console.log('JS-fejl:\n' + errors.map((e) => '  ' + e).join('\n'));
console.log(`\n${results.length - bad.length}/${results.length} tjek bestået, ${errors.length} JS-fejl`);
process.exit(bad.length || errors.length ? 1 : 0);
