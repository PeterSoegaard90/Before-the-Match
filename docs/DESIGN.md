# Before the Match – design

Det aftalte design fra interviewet (`/grill-me`), som spillet er bygget efter.

## Idé
Et 3D-spil i tredjeperson i browseren. Du er en dansk roligan med 5 minutter til kickoff i Aarhus Midtby. Saml flest mulige fadøl, og nå fanzonen inden kampen starter. GTA-light: man kan stjæle biler og blive jagtet af politiet, men der er ingen våben og ingen blod.

## En runde
- Start ved **Banegården** (som om man lige er kommet med toget).
- Nedtælling fra **5:00**. Hver fadøl giver **100 point**.
- I det sidste minut vises fanzonen – tilfældigt på **Store Torv**, **Rådhuspladsen** eller **Bispetorv**. Nå den i tide og behold pointene; kommer man for sent, mister man **halvdelen**.
- Scoreskærm, lokal highscore (top 10) og "Spil igen".

## Fadøl
- **Barer**: placeret ved rigtige barer fra OpenStreetMap, men med **opdigtede navne** (fx "Den Tørstige Viking"). Ny fadøl 60 sekunder efter, at den er taget.
- **Fadølsvogne**: kører faste ruter ad gågaderne (Strøget, Åboulevarden, Latinerkvarteret). Ny fadøl efter 30 sekunder.
- **Platform-fadøl**: på stilladser, containere og halvtage (let platforming).
- **Sallings tagterrasse**: fadøl på taget – man kan køre op via parkeringshusets spiralrampe og gangbroen.
- Fadøl er kun point og påvirker ikke figuren.

## Byen
- **Område**: Latinerkvarteret, Åboulevarden, Store Torv, Strøget til Banegården, Rådhuspladsen og ARoS (ca. 1,2 × 1,4 km).
- **Kortdata**: bygninger, veje, Åen, træer og barer fra OpenStreetMap. Bygninger uden højde får højden fra naboerne eller 4 etager, indtil BBR-data er klar.
- **Håndlavede landemærker**: Domkirken (tårn og spir), ARoS (med regnbuen), Rådhuset (tårn med ur), Aarhus Teater (gavle og kuppel) og Salling (tagterrasse).
- **Udseende**: stiliseret low-poly, solrig eftermiddag. Man kan ikke gå ind i bygningerne.

## Figur og bevægelse
- 3–4 færdige roligans (Bjarne, Lone, Kasper, Amira), kun kosmetiske forskelle.
- Rød-hvid trøje, vikinghjelm med horn, Dannebrog i ansigtet og flag som kappe.
- Gå, løbe, hoppe og trække sig op over en kant.
- Styring: WASD, mus (kamera), Shift (løb), Mellemrum (hop/håndbremse), E (stig ind/af), venstre klik (slå), M (kort), Esc (pause).

## Køretøjer
- Bil, cykel og ladcykel – alle parkeret, ingen trafik.
- Arcade-styring: let at køre, drift med håndbremsen, ingen skader.
- Biler skal brydes op (1,2 sekund), cykler kan tages med det samme.

## Andre i byen
- **Fodgængere** vælter komisk, når man kører dem ned, og rejser sig igen. Mange er i rød-hvidt – det er kampdag.
- **Hooligans** fra Sverige i grupper på 2–3. Rammer de dig, taber du én fadøl og har 5 sekunder til at samle den op. Tre slag slår en hooligan ud (stjerner i 20 sekunder). Selvforsvar – politiet blander sig ikke.
- **Politi** til fods og på cykel. Stjerne for at stjæle en bil eller køre en fodgænger ned, mens en betjent ser det (maks 3). Anholdelse koster 10 % af pointene pr. stjerne, derefter 5 sekunders immunitet. Hold dig ude af syne for at slippe væk.

## Skærm, menuer, lyd
- Nedtælling øverst i midten, fadøl og point øverst til højre, stjerner under, minikort nederst til venstre.
- Startskærm → vælg roligan → 3-2-1 → runde → score → spil igen. Al tekst på dansk, titlen på engelsk.
- Kun CC0-lyde (genereret af spillets egen kode).

## Teknik
- Vite + TypeScript + Three.js + Rapier (fysik).
- `scripts/fetch-osm.mjs` henter OSM-data; `scripts/build-city.ts` bygger `public/data/city.json`.
- Mål: 60 fps på en almindelig bærbar i Chrome, Edge og Firefox (adaptiv opløsning og skyggekvalitet).
- Deploy: GitHub Actions → GitHub Pages.

## Standardvalg (ikke drøftet, men valgt)
1. Man kan samle fadøl fra bil eller cykel ved at køre igennem dem; hooligans kan ikke tage fadøl, mens man kører.
2. Det giver ikke en stjerne at tage en cykel eller ladcykel – kun biler.
3. Pausemenuen har musefølsomhed, lydstyrke og omvendt kamera.
4. Kreditskærmen skriver "© OpenStreetMap contributors".
5. At køre en hooligan ned giver ingen stjerne (selvforsvar); at køre en betjent ned gør.

## Tilføjet under kvalitetsrunden
- **GPS-rute**: når fanzonen åbner, tegnes den korteste vej (A* på gangnettet) på minikortet og det store kort.
- **Tips i første runde**: korte hjælpetekster om lysstråler, køretøjer, platforme, hooligans og kortet.
- **Kamera uden musefangst**: kan også styres ved at trække med musen, hvis browseren ikke tillader pointer lock.
- **Kulisse-skyline**: bygninger i en ring på ca. 600 m uden om spilområdet (fra OSM), så horisonten ikke slutter brat.

## Ydelse (målt på Intel Core Ultra 7 255U med indbygget Intel-grafik, 1920×1080)
- Fuld kvalitet (MSAA, bløde skygger, 2048-skyggekort, opløsning 1,0): **ca. 138 fps** i gennemsnit, 95-percentil 10,7 ms.
- Spillogik ca. 2,4 ms pr. frame. Statiske kollidere samles i trimesh-fliser (fysiktrin ≈ 0,3 ms i stedet for 7,8 ms).
- Adaptiv kvalitet sænker trinvis skyggeblødhed, opløsning og skyggekort, hvis fps falder under 50.

## Mangler (afhænger af brugeren)
- **BBR-højder**: kræver en gratis bruger på Datafordeleren. Indtil da bruges OSM-højder + naboernes etageantal + 4 etager som standard.
