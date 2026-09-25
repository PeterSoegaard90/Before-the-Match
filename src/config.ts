// Alle spilregler og tuning-tal samlet ét sted.

export const RULES = {
  roundSeconds: 5 * 60,
  fanzoneRevealSeconds: 60, // markøren vises i det sidste minut
  fanzoneRadius: 13,
  pointsPerBeer: 100,
  latePenaltyFraction: 0.5, // kommer man for sent, mister man halvdelen
  arrestPenaltyPerStar: 0.1, // 10 % af pointene pr. stjerne
  arrestImmunitySeconds: 5,
  maxStars: 3,
  barRespawnSeconds: 60,
  cartRespawnSeconds: 30,
  platformRespawnSeconds: 60,
  droppedBeerSeconds: 5,
  hooliganHitsToKO: 3,
  hooliganKOSeconds: 20,
  countdownSeconds: 3,
} as const;

export const TUNING = {
  gravity: 22,
  walkSpeed: 4.3,
  sprintSpeed: 7.4,
  jumpVelocity: 7.6,
  airControl: 0.35,
  mantleMin: 0.7, // kant skal være mindst så højt over fødderne …
  mantleMax: 2.55, // … og højst så højt (arme strakt op)
  punchRange: 1.6,
  punchCooldown: 0.42,
  enterRange: 3.0,
  carTheftSeconds: 1.2,
  pedestrianCount: 46,
  policeOnFoot: 6,
  policeOnBike: 3,
  hooliganGroups: 4,
  witnessRange: 42,
  policeChaseRange: 170,
  policeFootSpeed: 6.2,
  policeBikeSpeed: 9.6,
  hooliganWalk: 1.5,
  hooliganRun: 5.6,
  hooliganSight: 24,
  pedestrianWalk: 1.35,
} as const;

export interface VehicleSpec {
  maxSpeed: number;
  accel: number;
  brake: number;
  reverseMax: number;
  turnRate: number;
  grip: number;
  driftGrip: number;
  halfExtents: [number, number, number]; // x (bredde/2), y, z (længde/2)
  rideHeight: number; // collider-centrets højde over jorden
  mass: number;
  seatHeight: number;
  pickupRadius: number;
  label: string;
}

export const VEHICLES: Record<'car' | 'bike' | 'cargo', VehicleSpec> = {
  car: {
    maxSpeed: 25, accel: 10, brake: 20, reverseMax: 7, turnRate: 2.1, grip: 9, driftGrip: 1.4,
    halfExtents: [0.92, 0.55, 2.15], rideHeight: 0.78, mass: 1200, seatHeight: 0.55, pickupRadius: 3.2, label: 'bil',
  },
  bike: {
    maxSpeed: 11.5, accel: 6, brake: 14, reverseMax: 1.5, turnRate: 2.7, grip: 14, driftGrip: 6,
    halfExtents: [0.3, 0.55, 0.85], rideHeight: 0.62, mass: 18, seatHeight: 0.62, pickupRadius: 2.2, label: 'cykel',
  },
  cargo: {
    maxSpeed: 8.2, accel: 3.6, brake: 10, reverseMax: 1.5, turnRate: 1.9, grip: 12, driftGrip: 5,
    halfExtents: [0.48, 0.6, 1.25], rideHeight: 0.66, mass: 45, seatHeight: 0.62, pickupRadius: 2.5, label: 'ladcykel',
  },
};

export interface RoliganDef {
  id: string;
  name: string;
  tagline: string;
  skin: string;
  hair: string;
  female: boolean;
  belly: number;
  beard: boolean;
  braids: boolean;
}

// Kun kosmetiske forskelle – alle har samme evner, så highscoren er fair.
export const ROLIGANS: RoliganDef[] = [
  { id: 'bjarne', name: 'Bjarne', tagline: 'Har været med siden 1986. Hjelmen er original.', skin: '#f1c7a5', hair: '#8a5a33', female: false, belly: 1, beard: true, braids: false },
  { id: 'lone', name: 'Lone', tagline: 'Kan synge alle vers af "Re-Sepp-ten". Baglæns.', skin: '#f3cfb3', hair: '#e8c35a', female: true, belly: 0, beard: false, braids: true },
  { id: 'kasper', name: 'Kasper', tagline: 'Første landskamp. Har malet flaget på med tusch.', skin: '#e9b48f', hair: '#2e2420', female: false, belly: 0, beard: false, braids: false },
  { id: 'amira', name: 'Amira', tagline: 'Holdets hurtigste til at finde en ledig fadølshane.', skin: '#b5835e', hair: '#1d1512', female: true, belly: 0, beard: false, braids: false },
];

export const PLAYER_COLORS = {
  shirt: '#c8102e',
  white: '#ffffff',
  shorts: '#f4f4f4',
  helmet: '#9aa3ab',
  horns: '#efe6cf',
};
