// Curated Kenney (https://kenney.nl) 3D packs — all CC0. Kenney has no public
// API and serves pack zips through short-lived signed links, so there is no
// stable direct download URL: the agent shows `pageUrl` to the user, who
// downloads the zip once; `agent3d assets add <pack>.zip` (importAssetZip)
// then extracts the .glb / .gltf + textures into the project.
// Page URLs verified (HTTP 200) on 2026-11-22.

export interface CuratedPack {
  id: string;
  title: string;
  description: string;
  tags: string[];
  pageUrl: string;
  downloadPage?: string;
}

const k = (id: string, title: string, description: string, tags: string[]): CuratedPack => ({ id, title, description, tags, pageUrl: `https://kenney.nl/assets/${id}` });

export const KENNEY_PACKS: CuratedPack[] = [
  k("nature-kit", "Nature Kit", "Low-poly trees, rocks, plants, cliffs, paths, tents and campfires.", ["nature", "tree", "rock", "plant", "forest", "camp", "lowpoly"]),
  k("city-kit-suburban", "City Kit (Suburban)", "Suburban houses, fences, trees and driveways.", ["city", "house", "suburb", "building", "town"]),
  k("city-kit-commercial", "City Kit (Commercial)", "Skyscrapers, shops and commercial buildings.", ["city", "building", "skyscraper", "shop", "town"]),
  k("city-kit-roads", "City Kit (Roads)", "Road tiles, crossings, bridges and street props.", ["city", "road", "street", "traffic", "bridge"]),
  k("car-kit", "Car Kit", "Stylised cars, trucks, police car, taxi, ambulance.", ["car", "vehicle", "truck", "taxi", "racing"]),
  k("racing-kit", "Racing Kit", "Race track pieces, cars and props.", ["racing", "car", "track", "vehicle"]),
  k("train-kit", "Train Kit", "Trains, wagons and tracks.", ["train", "rail", "vehicle"]),
  k("space-kit", "Space Kit", "Rockets, astronauts, planets, space station modules and terrain.", ["space", "rocket", "astronaut", "planet", "scifi"]),
  k("modular-space-kit", "Modular Space Kit", "Modular sci-fi interior corridors and rooms.", ["space", "scifi", "interior", "modular", "corridor"]),
  k("platformer-kit", "Platformer Kit", "Platforms, coins, flags, blocks and characters for 3D platformers.", ["platformer", "game", "coin", "block", "level"]),
  k("prototype-kit", "Prototype Kit", "Blockout shapes, ramps, stairs for level prototyping.", ["prototype", "game", "level", "blockout"]),
  k("mini-arena", "Mini Arena", "Small arena game pieces and characters.", ["arena", "game", "character"]),
  k("mini-characters", "Mini Characters", "Small rigged/animated characters.", ["character", "people", "animated"]),
  k("mini-dungeon", "Mini Dungeon", "Dungeon tiles, walls, chests and characters.", ["dungeon", "fantasy", "game", "chest"]),
  k("blaster-kit", "Blaster Kit", "Toy blasters, targets and ammo.", ["blaster", "gun", "weapon", "shooter", "game"]),
  k("food-kit", "Food Kit", "Fruit, vegetables, meals, drinks and kitchen props.", ["food", "fruit", "drink", "kitchen", "restaurant"]),
  k("furniture-kit", "Furniture Kit", "Chairs, tables, sofas, beds, lamps and interior props.", ["furniture", "interior", "chair", "table", "room", "house"]),
  k("castle-kit", "Castle Kit", "Castle walls, towers, gates and siege props.", ["castle", "medieval", "tower", "fantasy"]),
  k("fantasy-town-kit", "Fantasy Town Kit", "Medieval fantasy houses, market stalls and props.", ["fantasy", "medieval", "town", "house", "village"]),
  k("pirate-kit", "Pirate Kit", "Ships, palm trees, treasure, cannons and docks.", ["pirate", "ship", "island", "treasure", "boat"]),
  k("holiday-kit", "Holiday Kit", "Christmas trees, presents, snowmen and decorations.", ["holiday", "christmas", "winter", "snow", "gift"]),
  k("graveyard-kit", "Graveyard Kit", "Graves, crypts, fences, pumpkins — Halloween scenes.", ["halloween", "graveyard", "spooky", "pumpkin"]),
  k("tower-defense-kit", "Tower Defense Kit", "Towers, enemies paths and tiles for tower defense games.", ["tower", "defense", "game", "tile"]),
  k("minigolf-kit", "Minigolf Kit", "Minigolf course pieces.", ["golf", "minigolf", "game", "sport"]),
  k("coaster-kit", "Coaster Kit", "Roller coaster tracks and carts.", ["coaster", "theme park", "track", "fun"]),
  k("retro-urban-kit", "Retro Urban Kit", "Retro city blocks, walls and street props.", ["city", "urban", "retro", "street"]),
  k("survival-kit", "Survival Kit", "Tools, tents, barrels, crates and campfire.", ["survival", "camp", "tool", "crate", "barrel"]),
  k("hexagon-kit", "Hexagon Kit", "Hex tiles with terrain, buildings and nature.", ["hexagon", "tile", "strategy", "terrain", "board"]),
];
