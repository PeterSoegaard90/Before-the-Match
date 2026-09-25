// Dataformatet for public/data/city.json, som scripts/build-city.ts genererer
// ud fra OpenStreetMap. Alle koordinater er i meter: x = øst, z = syd.

export type V2 = [number, number];

export type LandmarkId = 'domkirken' | 'aros' | 'raadhus' | 'teater' | 'salling' | 'parkeringshus';

export type HeightSource = 'osm-height' | 'osm-levels' | 'neighbors' | 'default' | 'landmark';

export interface Building {
  id: number;
  outer: V2[]; // mod uret set ovenfra (CCW i x/z med z mod syd)
  holes: V2[][];
  h: number; // højde til tagfod (eaves)
  minH: number;
  roof: 'flat' | 'gabled';
  roofH: number;
  color: string;
  roofColor: string;
  kind: string;
  shop: boolean; // butiksfacade i stueetagen
  landmark?: LandmarkId;
  heightSource: HeightSource;
}

export type RoadKind = 'major' | 'street' | 'service' | 'pedestrian' | 'footway' | 'cycleway' | 'steps' | 'path';

export interface Road {
  pts: V2[];
  w: number;
  kind: RoadKind;
  bridge: boolean;
  crossing?: boolean; // fodgængerovergang (zebrastriber)
}

export type AreaKind = 'water' | 'pool' | 'grass' | 'park' | 'forest' | 'square' | 'parking' | 'pitch' | 'playground';

export interface Area {
  outer: V2[];
  holes: V2[][];
  kind: AreaKind;
}

export interface Rail {
  pts: V2[];
  light: boolean;
}

export interface Canopy {
  outer: V2[];
  h: number;
}

export interface BarSpot {
  pos: V2;
  name: string;
  y?: number; // højde over jorden (fx Sallings tagterrasse)
}

export type ParkKind = 'car' | 'bike' | 'cargo';

export interface ParkSpot {
  pos: V2;
  heading: number; // radianer, 0 = mod -z (nord)
  kind: ParkKind;
}

export type PlatformKind = 'container' | 'scaffold' | 'awning';

export interface PlatformSite {
  kind: PlatformKind;
  pos: V2;
  heading: number;
}

export interface NavGraph {
  nodes: V2[];
  /** [a, b, bredde] – bredde bruges til at gå på fortovet ved siden af kørebanen */
  edges: [number, number, number][];
}

/** Spiralrampen i Sallings Parkeringshus (op til taget i `top` meters højde). */
export interface ParkingHelix {
  center: V2;
  rInner: number;
  rOuter: number;
  top: number;
  turns: number;
  endAngle: number; // vinkel (atan2(z, x)) hvor rampen slutter på toppen
}

/** Gangbro over Ferdinand Sallings Stræde mellem parkeringshusets tag og Sallings tag. */
export interface Skybridge {
  a: V2;
  b: V2;
  y: number;
  w: number;
}

export type SquareId = 'storeTorv' | 'bispetorv' | 'raadhuspladsen' | 'banegaardspladsen';

export interface CityData {
  version: number;
  attribution: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: Building[];
  canopies: Canopy[];
  roads: Road[];
  areas: Area[];
  rails: Rail[];
  trees: V2[];
  bars: BarSpot[];
  parking: ParkSpot[];
  platforms: PlatformSite[];
  nav: NavGraph;
  squares: Record<SquareId, V2>;
  policeStation: V2;
  spawn: { pos: V2; heading: number };
  cartRoutes: V2[][];
  parkingHelix: ParkingHelix;
  skybridge: Skybridge;
  sallingRoof: { center: V2; y: number; outer: V2[] };
  /** Kulissebygninger uden for spilområdet (kun til skylinen). */
  backdrop: { outer: V2[]; h: number; c: number }[];
  stats: Record<string, number>;
}
