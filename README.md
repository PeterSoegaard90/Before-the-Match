# Before the Match

**Aarhus Midtby. Fem minutter til kickoff.** Du er en roligan med vikinghjelm og Dannebrog på kinderne. Find så mange fadøl som muligt – til fods, på cykel, på ladcykel eller i en "lånt" bil – og nå fanzonen, før dommeren fløjter.

🎮 **Spil det her:** https://petersoegaard90.github.io/Before-the-Match/

Et GTA-inspireret 3D-browserspil bygget på rigtige kortdata fra OpenStreetMap: Domkirken, ARoS med regnbuen, Rådhustårnet, Aarhus Teater, Åen og Sallings tagterrasse.

## Styring

| Tast | Handling |
|---|---|
| W A S D | Gå / kør |
| Mus | Kamera (klik i spillet for at låse musen) |
| Shift | Løb |
| Mellemrum | Hop og klatr op over kanter · håndbremse i bil |
| E | Stig ind / af (biler skal brydes op) |
| Venstre klik | Slå (kun svenske hooligans kan slås ned) |
| M | Kort |
| Esc | Pause |

## Regler
- Hver fadøl giver **100 point**. Fadøl står ved barerne (gule lysstråler), på fadølsvognene og oppe på stilladser, containere og halvtage.
- Hooligans slår fadøllen ud af hånden – du har **5 sekunder** til at samle den op igen.
- Stjæler du en bil eller kører en fodgænger ned, mens en betjent ser det, får du en **stjerne** (maks 3). En anholdelse koster **10 % af pointene pr. stjerne**.
- I det **sidste minut** åbner fanzonen på Store Torv, Rådhuspladsen eller Bispetorv. Når du den i tide, beholder du pointene – ellers mister du **halvdelen**.

## Udvikling

Kræver Node.js 22.6+ (data-scriptet bruger Nodes indbyggede TypeScript-understøttelse).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit-tests (regler, point, stjerner)
npm run test:e2e     # ende-til-ende i headless Chromium (kræver kørende dev-server)
npm run build        # produktionsbuild i dist/
```

### Kortdata
```bash
npm run data:fetch   # henter OSM-data for området → data/osm-raw.json
npm run data:build   # bygger public/data/city.json (bygninger, veje, barer, platforme, navigation …)
```

Designet er beskrevet i [docs/DESIGN.md](docs/DESIGN.md).

## Credits
- Kortdata © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.
- [three.js](https://threejs.org) og [Rapier](https://rapier.rs).
- Skrifttyper: Luckiest Guy og Nunito (SIL Open Font License).
- Alle lyde genereres af spillets egen kode og frigives som CC0.

Et fanprojekt – ikke tilknyttet DBU, Aarhus Kommune eller byens forretninger. Barerne i spillet har opdigtede navne. Nyd din fadøl med måde.
