// Master palette (palette-first): every flat colour in the scene comes from here. Soft, warm-leaning and
// mid-saturated so the town reads calm by day and cosy by night. Ramps are [shadow, mid, light].
import * as THREE from 'three'

export type Ramp = readonly [number, number, number]

export const PAL = {
  // Ground
  grass: [0x6c9a52, 0x84ae5f, 0xa1c46f],
  meadow: [0x7da559, 0x95b565, 0xaac273],
  lawn: [0x5f914c, 0x77a759, 0x93bf69],
  soil: [0x6b5040, 0x8a6a4e, 0xa8876a],
  rim: 0x5d4c42,
  paving: [0x9d9382, 0xb7ac98, 0xd0c5b1],
  walk: [0xa6a093, 0xc1bbad, 0xd9d3c6],
  asphalt: [0x42464f, 0x50555f, 0x61666f],
  marking: 0xeae4d6,
  water: [0x4f8fae, 0x6fb0c8, 0xa9d8e4],

  // Plants
  leaf: [0x3f7445, 0x56914e, 0x79b05c],
  pine: [0x2e6148, 0x3e7a55, 0x58966a],
  blossom: [0xd99aae, 0xebbdca, 0xf6dbe2],
  golden: [0x6f9446, 0x8fae55, 0xadc56b],
  hedge: [0x3c6c42, 0x4e844f, 0x66a05d],
  trunk: [0x5e4434, 0x7a5a42, 0x957257],
  flowers: [0xf08f7f, 0xf6d26e, 0xb9a2e6, 0xf7f0de, 0xf4a8c4, 0x92c3ea, 0xf3a65a],

  // Building materials
  wood: [0x6c4a34, 0x8f6646, 0xb68a62],
  cream: [0xd6c8ab, 0xeadfc6, 0xf6efe0],
  white: [0xcdcfd2, 0xe6e6e3, 0xf6f5f1],
  sand: [0xa88f6f, 0xc4ab8b, 0xdac6a8],
  brick: [0x8e4d3c, 0xa9634b, 0xc27d62],
  sage: [0xa7b899, 0xc3d0b5, 0xdbe4cf],
  bottle: [0x2f5a4b, 0x3d6e5b, 0x568a73],
  steel: [0x606a77, 0x7d8895, 0x9ca6b2],
  slate: [0x4a4f5e, 0x5b6172, 0x747b8d],
  frame: 0x343a48,
  solar: 0x394663,
  warmDark: 0x3d302b,
  gold: 0xd9a93a,

  // Light (sky endpoints are in SKY below)
  lamp: 0xffc56b,
  firefly: 0xe6f59a,

  // Background neighbourhood (urban outskirts): desaturated and calmer than the town, never an accent, so it reads as
  // scenery behind the projects.
  bgWall: [0xe0d9cb, 0xdcd0b9, 0xcdd3c3, 0xc9d0d4, 0xdbcac0, 0xd5c8ae, 0xd1cec4, 0xdfd4b6],
  bgHouseRoof: [0x9a7163, 0x6f7887, 0x7b8971, 0x8e7a68, 0x626873, 0x6f8786],
  bgLawn: [0x7fa25e, 0x88a964, 0x799b5a, 0x8aa86a],
  bgLane: 0x666a71, // residential lanes: lighter than the town's asphalt
  bgKerb: 0xb2ada2,
  bgPlinth: 0x9d978c,
  bgPath: 0xc9c1b2,
  bgCar: [0xdcd7cc, 0x8f9ba7, 0xb4806f, 0x7f8e7d, 0xcfbf8e, 0x6d737f, 0x9fb2b6, 0xc2aa9b],

  // Countryside around the town (pastoral outskirts): warm and calm, a little softer than the town and never an accent,
  // so it reads as scenery behind the projects. Door, glass, chimney and glow colours are shared by both themes.
  bgStone: [0x9a907f, 0xb8ae9b, 0xd3cab7], // terrace wall, gate pillars, bridges, tunnel portals
  bgDirt: [0x9a8163, 0xb39a76, 0xc7b18e], // lanes and farmyards
  bgSand: [0xb9a988, 0xcbbd9c], // river banks
  bgBallast: [0x7b746b, 0x928a7e],
  bgSleeper: 0x5b4a3d,
  bgRail: 0xaab1b8,
  bgGirder: [0x4b5651, 0x67716b],
  bgWheat: [0xbf9443, 0xd5ad56, 0xe5c574],
  bgBarley: [0xb9ad6c, 0xccc283, 0xdcd39c],
  bgRapeseed: [0xc4ad3a, 0xdcc64c, 0xebda6c],
  bgLavender: [0x7b7092, 0x938aa9, 0xada5bf],
  bgSage: [0x86956f, 0x97a57f],
  bgTulips: [0xc96d61, 0xd9a3ad, 0xdcc672, 0xe6dfd1],
  bgSunflower: [0x6a8a44, 0xe1b947],
  bgVeg: [0x6c984b, 0x8ab35a, 0x5d8869, 0xa1c069],
  bgSoil: [0x725540, 0x87674c, 0x9d7c5d],
  bgHay: [0xa3ab62, 0xb7bd74, 0xc8cc88],
  bgPasture: [0x7fa756, 0x8fb662],
  bgMeadow: [0x7ea458, 0x88ab5d],
  bgWildflower: [0xf0ebdf, 0xe8c654, 0x9f8cc6, 0xd9796a, 0xe39ab1], // daisy, buttercup, clover, poppy, campion
  bgWoodFloor: 0x4f7344,
  // Hill contour tiers, low to high: a touch lighter and warmer with height.
  bgHill: [0x6f9a50, 0x79a256, 0x84aa5c, 0x8fb263, 0x9bba6b, 0xa7c274, 0xb2c97d],
  bgFarmWall: [0xe4dac8, 0xdccdb1, 0xe0d4bf],
  bgBarn: [0x95453a, 0xa75343],
  bgTrim: 0xe6e0d3,
  bgRoof: [0x6f5a50, 0x5d636b, 0x7f6553],
  bgSilo: [0xadb3b7, 0xc8ccce],
  bgMill: [0xe8e3d6, 0x5b4a3e], // tower, cap
  bgSail: [0x6c4a34, 0xece5d6], // spars, cloth
  bgWool: [0xece8de, 0x3b3430], // fleece, faces and legs
  bgCow: [0xece8de, 0x3b3430, 0x8a5a3c],
  bgTrain: [0x3d6e5b, 0x8e4d3c, 0xeadfc6, 0x5b6172, 0x2a2d33], // locomotive, coaches, window band, roofs, chassis
  bgTractor: [0xbf5a42, 0x5b8a3d, 0x4a72a0],
  bgDoor: 0x6c5c50,
  bgGlass: 0x6f7d8b,
  bgChimney: 0x977367,
  bgGlow: 0xffc27c, // lit window at night: warm, dimmer than the town's windows
} as const

/**
 * Sky and light rig, [night, day] endpoints (sky.ts interpolates by light level): night is a calm blue-grey, not
 * violet, so warm lamps and windows carry the mood; day is a soft, slightly warm haze. Dusk and dawn add warm tints.
 */
export const SKY = {
  bg: [0x141c31, 0xbdd3e4],
  hemiSky: [0x6574a6, 0xe6eef6],
  hemiGround: [0x2c3146, 0x938a74],
  sun: [0xa6b6e2, 0xfff0da],
  dusk: 0xf3a468,
  dawn: 0xf7a592,
  warmSun: 0xffcf9a,
  peach: 0xf3c9a5,
  mauve: 0x8a5a86,
  warmFill: 0xffc89e,
} as const

/** Same hue, scaled saturation, lightness pulled toward the middle by `pull`. */
function temper(color: THREE.ColorRepresentation, sat: number, pull: number): THREE.Color {
  const c = new THREE.Color(color)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl, THREE.SRGBColorSpace)
  return c.setHSL(hsl.h, hsl.s * sat, THREE.MathUtils.lerp(hsl.l, 0.55, pull), THREE.SRGBColorSpace)
}

/**
 * The project colour is an accent. Trims and bands get it slightly tempered (so even neon picks sit in the palette);
 * large surfaces such as whole roofs get a calm version with half the saturation.
 */
export function accentTone(color: THREE.ColorRepresentation): THREE.Color {
  return temper(color, 0.82, 0.12)
}

export function mutedAccent(color: THREE.ColorRepresentation): THREE.Color {
  return temper(color, 0.5, 0.3)
}
