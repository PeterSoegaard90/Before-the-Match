// Tegner public/data/city.json som et 2D-kort (PNG) til visuel kontrol af data-pipelinen.
// Kør: node tests/debug-map.mjs [ud.png] [minX,minZ,maxX,maxZ]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const out = process.argv[2] ?? 'debug-map.png';
const view = process.argv[3]?.split(',').map(Number);
const city = JSON.parse(readFileSync('public/data/city.json', 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
await page.setContent('<canvas id="c" width="1400" height="1600"></canvas>');
await page.evaluate(({ city, view }) => {
  const cv = document.getElementById('c');
  const g = cv.getContext('2d');
  const b = city.bounds;
  const [vx0, vz0, vx1, vz1] = view ?? [b.minX, b.minZ, b.maxX, b.maxZ];
  const s = Math.min(1400 / (vx1 - vx0), 1600 / (vz1 - vz0));
  const X = (x) => (x - vx0) * s, Z = (z) => (z - vz0) * s;
  g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, 1400, 1600);
  const poly = (pts, fill, stroke) => {
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); }
  };
  const AC = { water: '#4a90c8', pool: '#8cc0e0', grass: '#8fbf6a', park: '#7fb35a', forest: '#4f8a3a', square: '#cfc3a8', parking: '#9a9a9a', pitch: '#6aa84f', playground: '#d9b36c' };
  for (const a of city.areas) poly(a.outer, AC[a.kind]);
  const RC = { major: '#444', street: '#555', service: '#777', pedestrian: '#e0cfa0', footway: '#bbb', cycleway: '#c77', steps: '#a88', path: '#ab9' };
  for (const r of city.roads) {
    g.strokeStyle = RC[r.kind]; g.lineWidth = Math.max(1, r.w * s); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.stroke();
  }
  for (const r of city.rails) { g.strokeStyle = r.light ? '#2a6' : '#333'; g.lineWidth = 1; g.setLineDash([3, 2]); g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.stroke(); g.setLineDash([]); }
  const HC = { 'osm-height': '#1f77b4', 'osm-levels': '#2ca02c', neighbors: '#ff7f0e', default: '#999', landmark: '#d62728' };
  for (const bl of city.buildings) poly(bl.outer, bl.landmark ? '#d62728' : bl.color, HC[bl.heightSource]);
  for (const c of city.canopies) poly(c.outer, 'rgba(80,80,160,0.5)');
  g.fillStyle = '#2d6a2d'; for (const t of city.trees) { g.beginPath(); g.arc(X(t[0]), Z(t[1]), 2, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(0,0,255,0.25)'; g.lineWidth = 1;
  for (const [a, bb] of city.nav.edges) { const p = city.nav.nodes[a], q = city.nav.nodes[bb]; g.beginPath(); g.moveTo(X(p[0]), Z(p[1])); g.lineTo(X(q[0]), Z(q[1])); g.stroke(); }
  g.strokeStyle = '#ff8c00'; g.lineWidth = 4;
  for (const r of city.cartRoutes) { g.beginPath(); r.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.stroke(); }
  const PC = { car: '#e02020', bike: '#2050e0', cargo: '#a020c0' };
  for (const p of city.parking) { g.fillStyle = PC[p.kind]; g.fillRect(X(p.pos[0]) - 2, Z(p.pos[1]) - 2, 4, 4); }
  for (const p of city.platforms) { g.fillStyle = '#00c000'; g.fillRect(X(p.pos[0]) - 5, Z(p.pos[1]) - 5, 10, 10); }
  g.font = '11px sans-serif';
  for (const bar of city.bars) { g.fillStyle = '#ffd000'; g.strokeStyle = '#000'; g.beginPath(); g.arc(X(bar.pos[0]), Z(bar.pos[1]), 5, 0, 7); g.fill(); g.stroke(); }
  g.font = 'bold 16px sans-serif';
  for (const [k, p] of Object.entries(city.squares)) { g.strokeStyle = '#0a0'; g.lineWidth = 3; g.beginPath(); g.arc(X(p[0]), Z(p[1]), 14, 0, 7); g.stroke(); g.fillStyle = '#000'; g.fillText(k, X(p[0]) + 16, Z(p[1])); }
  g.fillStyle = '#00f'; g.fillRect(X(city.policeStation[0]) - 7, Z(city.policeStation[1]) - 7, 14, 14); g.fillText('POLITI', X(city.policeStation[0]) + 10, Z(city.policeStation[1]));
  g.fillStyle = '#f0f'; g.beginPath(); g.arc(X(city.spawn.pos[0]), Z(city.spawn.pos[1]), 8, 0, 7); g.fill(); g.fillText('START', X(city.spawn.pos[0]) + 10, Z(city.spawn.pos[1]) + 16);
}, { city, view });
await page.screenshot({ path: out });
await browser.close();
console.log('skrev', out);
