// Writes dist/version.json — what agents and the skills compare to decide
// whether the CLI, the runtime of an export or the skills are out of date:
//   version          release of this repo / npm package (package.json)
//   minSkillsVersion oldest skills that still work with this dist
//                    (package.json → agent3d.minSkillsVersion, default: version)
//   sceneVersion     SceneDoc format version (src/core/types.ts SCENE_VERSION)
// Run by `npm run build` after the three vite builds.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const types = readFileSync(join(root, "src", "core", "types.ts"), "utf8");
const sceneVersion = Number(/SCENE_VERSION\s*=\s*(\d+)/.exec(types)?.[1] ?? 1);

const info = {
  name: pkg.name,
  version: pkg.version,
  minSkillsVersion: pkg.agent3d?.minSkillsVersion ?? pkg.version,
  sceneVersion,
  repository: "github:fleox/agent3d",
};
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "version.json"), JSON.stringify(info, null, 2) + "\n");
// The npm bin entry; executable so `./dist/agent/agent3d.mjs` works in a clone.
const bin = join(root, "dist", "agent", "agent3d.mjs");
if (existsSync(bin)) chmodSync(bin, 0o755);
console.log(`[version] dist/version.json → ${info.version}`);
