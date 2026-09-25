// Henter rå OpenStreetMap-data for spilområdet (Aarhus Midtby) via Overpass API.
// Kør: npm run data:fetch  → data/osm-raw.json + data/osm-backdrop.json
// Data © OpenStreetMap contributors, ODbL.
import { writeFile, mkdir } from 'node:fs/promises';
import { BBOX } from './area.ts';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `[out:json][timeout:180];
(
  way["building"](${b});
  relation["building"](${b});
  way["highway"](${b});
  way["area:highway"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["waterway"](${b});
  way["leisure"~"park|garden|playground|pitch"](${b});
  way["landuse"~"grass|recreation_ground|forest|meadow|village_green"](${b});
  way["place"="square"](${b});
  node["place"="square"](${b});
  node["amenity"~"^(bar|pub|biergarten|nightclub)$"](${b});
  way["amenity"~"^(bar|pub|biergarten|nightclub)$"](${b});
  node["natural"="tree"](${b});
  way["railway"](${b});
  way["amenity"="parking"](${b});
);
out geom;`;

// Kulisse: bygninger i en ring uden om spilområdet (skyline, ingen kollision)
const bb = `${BBOX.south - 0.0055},${BBOX.west - 0.0095},${BBOX.north + 0.0055},${BBOX.east + 0.0095}`;
const backdropQuery = `[out:json][timeout:180];(way["building"](${bb}););out geom;`;

async function fetchTo(q, file) {
  let lastErr;
  for (const url of MIRRORS) {
    try {
      console.log(`Henter ${file} fra ${url} …`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'BeforeTheMatch-game-datapipeline/0.1',
        },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      await mkdir('data', { recursive: true });
      await writeFile(file, JSON.stringify(json));
      console.log(`OK: ${json.elements.length} elementer → ${file}`);
      return;
    } catch (e) {
      console.warn(`  fejlede: ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr;
}

async function main() {
  await fetchTo(query, 'data/osm-raw.json');
  await fetchTo(backdropQuery, 'data/osm-backdrop.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
