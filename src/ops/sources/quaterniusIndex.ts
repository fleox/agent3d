// Curated Quaternius (https://quaternius.com) packs — all CC0. Packs are
// distributed through Google Drive folders (no direct zip URL, no API): the
// agent shows `pageUrl` / `downloadPage` to the user, who downloads the pack
// once; `agent3d assets add <pack>.zip` (importAssetZip) extracts the glTF files.
// Pages and Drive links verified (HTTP 200) on 2026-11-22.

import type { CuratedPack } from "./kenneyIndex";

const q = (id: string, title: string, description: string, tags: string[], drive?: string): CuratedPack => ({
  id,
  title,
  description,
  tags,
  pageUrl: `https://quaternius.com/packs/${id}.html`,
  ...(drive ? { downloadPage: `https://drive.google.com/drive/folders/${drive}?usp=sharing` } : {}),
});

export const QUATERNIUS_PACKS: CuratedPack[] = [
  q("ultimatenature", "Ultimate Nature Pack", "Trees, bushes, rocks, flowers, grass — stylised low poly.", ["nature", "tree", "rock", "flower", "forest", "lowpoly"], "1-Kl0L_Jg8awbh0S5T-z3zxh4mVlnxTpa"),
  q("stylizednaturemegakit", "Stylized Nature MegaKit", "Large stylised nature kit (trees, rocks, plants, terrain pieces).", ["nature", "tree", "rock", "plant", "stylized"]),
  q("simplenature", "Simple Nature Pack", "Simple low-poly trees, rocks and plants.", ["nature", "tree", "rock", "simple", "lowpoly"], "18hb-5HGCLL9BS8jmxkE4h31wmHGeqfts"),
  q("ultimateanimatedanimals", "Ultimate Animated Animal Pack", "Animated animals (fox, deer, wolf, horse, …) with idle/walk/run clips.", ["animal", "animated", "fox", "deer", "wolf", "horse"], "1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk"),
  q("farmanimal", "Farm Animal Pack", "Animated farm animals: cow, pig, sheep, chicken…", ["animal", "farm", "animated", "cow", "pig", "sheep", "chicken"], "1is1ax2V0mIEDS7BbbzBV_x2Pabya1dVJ"),
  q("cutefish", "Animated Cute Fish Pack", "Cute animated fish.", ["fish", "sea", "ocean", "animated", "cute"], "1QK5NCgIxUZ1cYGzVwaNfcfEiQhvczqUB"),
  q("animatedfish", "Animated Fish Pack", "Animated fish (realistic-stylised).", ["fish", "sea", "ocean", "animated"], "1SvlOveJJjmhSn-FgCRyojc1T5QHjjGkF"),
  q("ultimatemonsters", "Ultimate Monsters", "Animated monsters for games.", ["monster", "creature", "animated", "game", "enemy"], "18m4KpzpEzhC9wl7jzr6dUc0N8Jozr79C"),
  q("cutemonsters", "Cute Animated Monsters Pack", "Cute animated monsters.", ["monster", "cute", "animated", "creature"], "1zLLO_7ZoWgUsS4uooYnVSErQYRu1VdS0"),
  q("ultimatespaceships", "Ultimate Spaceships Pack", "Stylised spaceships.", ["space", "spaceship", "scifi", "ship"], "1NpfT3wqe2k3Jwue2xryi7tzxP4bWzETu"),
  q("spaceships", "Spaceships Pack", "Low-poly spaceships.", ["space", "spaceship", "scifi"], "1ZxWZ-KuSOA-9s53PA1B1-O0txRJvne2i"),
  q("ultimatespacekit", "Ultimate Space Kit", "Astronauts, planets, rovers, bases and props.", ["space", "astronaut", "planet", "rover", "scifi"], "17F8HlI2zPTlo32aieW5YPPwOk78xo-2m"),
  q("cars", "Cars Pack", "Low-poly cars.", ["car", "vehicle", "road"], "1fKlbDry77iY8KlEoxzUxIAZQL_XhzWlA"),
  q("publictransport", "Public Transport Pack", "Buses, trams, taxis.", ["bus", "tram", "vehicle", "city", "transport"], "1GUIE138uPVNraiQEf33dIx9wENhttZ15"),
  q("downtowncitymegakit", "Downtown City MegaKit", "Modular downtown city buildings and props.", ["city", "building", "downtown", "modular"]),
  q("simplebuildings", "Simple Buildings Pack", "Simple low-poly buildings.", ["building", "house", "city", "town"], "1r-FcNFxC6ziN0oI3GqZJdEkdzglFQHQH"),
  q("buildings", "Buildings Pack", "Low-poly buildings.", ["building", "house", "city"], "1uWCsV9QfnAu8u_QbwkYwOfuU3McME7CA"),
  q("ultimatefood", "Ultimate Food Pack", "Food items: fruit, burgers, pizza, drinks…", ["food", "fruit", "burger", "pizza", "drink"], "1zMfN7q9VU80M7mLAbBBJyY2OdoXslbl1"),
  q("junkfood", "Junk Food Pack", "Burgers, fries, hot dogs, sodas.", ["food", "junk", "burger", "fries"], "127xt6nsl4Z-YRy-FZru38Sf6ElBWc8IU"),
  q("ultimatefurniture", "Ultimate Furniture Pack", "Furniture: chairs, tables, beds, shelves.", ["furniture", "interior", "chair", "table", "room"], "1n85oUi0RN5ZUXEIMKA-AnBsPErVXWcma"),
  q("ultimatehomeinterior", "Ultimate House Interior Pack", "Home interior props and furniture.", ["interior", "house", "furniture", "room"], "1SNK9PwPi8xqqxmpU5xEZeiQjB26C1oX6"),
  q("ultimateplatformer", "Platformer Game Kit", "Platformer level pieces, collectibles and characters.", ["platformer", "game", "level", "coin"], "1NDZn_aGnn0vfFV3M22Y8GPcDjO8BVcLs"),
  q("modularplatformer", "Modular Platformer Pack", "Modular platform blocks.", ["platformer", "game", "modular", "block"], "1ku_XmbHOZ5ypgKCAjpzX6hlXaOJT7Uoq"),
  q("cubeworldkit", "Cube World Kit", "Voxel-like cube world blocks, trees and characters.", ["cube", "voxel", "world", "block", "game"], "1Yyag0ibcOX6lOBY9a3m6iPnz8HwjwLFJ"),
  q("animatedrobot", "Animated Robot Pack", "Animated robots.", ["robot", "animated", "scifi", "character"], "18MU0RtRu9G6SU6uSZ_zMQFmVkRlB4zH5"),
  q("rpgcharacters", "RPG Character Pack", "Animated RPG characters (warrior, mage, rogue…).", ["character", "rpg", "fantasy", "animated", "hero"], "1MIRQXLfTd21HMI5rwOb6Xy0rv0xv1m8b"),
  q("universalbasecharacters", "Universal Base Characters", "Rigged base humanoid characters.", ["character", "human", "rigged", "base"]),
  q("medievalvillagemegakit", "Medieval Village MegaKit", "Modular medieval village buildings and props.", ["medieval", "village", "building", "fantasy", "modular"]),
  q("ultimatecrops", "Ultimate Crops Pack", "Farm crops at growth stages.", ["farm", "crop", "plant", "vegetable"], "1uhbi-NWp7pwqOGtraBZurbphyxAvoABZ"),
  q("piratekit", "Pirate Kit", "Pirate ships, characters and props.", ["pirate", "ship", "treasure", "island"], "1KjMzhVsDcyvYMWeVjZcRfuu8auBLpNi2"),
];
