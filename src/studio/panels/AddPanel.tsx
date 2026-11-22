// Add panel: primitives, text, generators, particles, library models, lights.
// Click a tile to add it at the origin (inside the selected group when one
// is selected) and select it.

import clsx from "clsx";
import {
  Box, Building, Circle, CircleDot, Cloud, CloudRain, CloudSun, Cone, Cylinder, Diamond, Donut, Flame, Gem, Globe, Grid3x3, Heart, Hexagon, Infinity as InfinityIcon,
  Lamp, Library, Lightbulb, Mountain, PartyPopper, PersonStanding, Pill, Route, Search, Shapes, Snowflake, Sparkle, Sparkles, Spline, Square, SquareRoundCorner, Star, Sun, SunDim,
  Trees, TreePine, Triangle, Type, Wind, Wine, Droplets, Activity, Castle, type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { FONTS, GENERATORS, GEOMETRIES, PARTICLE_PRESETS } from "../../core/catalog";
import type { LightDef } from "../../core/types";
import { uniqueId } from "../../core/ids";
import { useI18n, type MessageKey } from "../i18n";
import { newObject, takenIds, type NewObjectSpec } from "../lib/patches";
import { findObject } from "../../ops/tree";
import { useEditor, useSnapshot, useUi } from "../state/context";
import { pretty } from "../lib/labels";

const GEO_ICONS: Record<string, LucideIcon> = {
  box: Box, roundedBox: SquareRoundCorner, sphere: Circle, cylinder: Cylinder, cone: Cone, capsule: Pill, torus: Donut, torusKnot: InfinityIcon,
  plane: Square, circle: Circle, ring: CircleDot, icosahedron: Gem, dodecahedron: Hexagon, octahedron: Diamond, tetrahedron: Triangle, lathe: Wine, extrude: Star, tube: Spline,
};
const GEN_ICONS: Record<string, LucideIcon> = {
  terrain: Mountain, trees: Trees, rocks: Shapes, grass: TreePine, flowers: Sparkle, water: Droplets, clouds: Cloud, city: Building, character: PersonStanding,
  planet: Globe, starfield: Sparkles, blob: Circle, waveGrid: Activity, maze: Grid3x3, road: Route,
};
const PARTICLE_ICONS: Record<string, LucideIcon> = { stars: Sparkles, snow: Snowflake, rain: CloudRain, fireflies: Sparkle, confetti: PartyPopper, sparks: Flame, dust: Wind, bubbles: Circle, embers: Flame, hearts: Heart };
const LIGHTS: { type: LightDef["type"]; icon: LucideIcon; def: Omit<LightDef, "id"> }[] = [
  { type: "directional", icon: Sun, def: { type: "directional", color: "#ffffff", intensity: 2, position: [4, 6, 5] } },
  { type: "point", icon: Lightbulb, def: { type: "point", color: "#ffd9a8", intensity: 8, position: [0, 2, 2], distance: 12 } },
  { type: "spot", icon: Lamp, def: { type: "spot", color: "#ffffff", intensity: 20, position: [0, 5, 3], target: [0, 0, 0], angle: 30, penumbra: 0.4 } },
  { type: "hemisphere", icon: CloudSun, def: { type: "hemisphere", skyColor: "#dfe9ff", groundColor: "#3a3f4a", intensity: 0.8 } },
  { type: "ambient", icon: SunDim, def: { type: "ambient", color: "#ffffff", intensity: 0.3 } },
  { type: "rect", icon: Square, def: { type: "rect", color: "#ffffff", intensity: 4, position: [0, 3, 3], target: [0, 0, 0], width: 3, height: 1.5 } },
];

const TABS: { id: string; icon: LucideIcon; label: MessageKey }[] = [
  { id: "primitives", icon: Box, label: "add.primitives" },
  { id: "text", icon: Type, label: "add.text" },
  { id: "generators", icon: Mountain, label: "add.generators" },
  { id: "particles", icon: Sparkles, label: "add.particles" },
  { id: "library", icon: Library, label: "add.library" },
  { id: "lights", icon: Lightbulb, label: "add.lights" },
];


export function AddPanel() {
  const { t } = useI18n();
  const { ui, edit, library } = useEditor();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const tab = useUi((s) => s.addTab);
  const [text, setText] = useState("Hello");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const add = (spec: NewObjectSpec) => {
    const sel = snap.selection ? findObject(scene.objects, snap.selection) : null;
    const parent = sel?.object.kind === "group" ? sel.object.id : undefined;
    const obj = newObject(scene, spec);
    edit([{ op: "addObject", object: obj, ...(parent ? { parent } : {}) }], { select: obj.id });
  };
  const addLight = (def: Omit<LightDef, "id">) => {
    const id = uniqueId(def.type, takenIds(scene));
    edit([{ op: "set", path: `lights[${(scene.lights ?? []).length}]`, value: { id, ...def } }], { select: null });
  };

  const models = useMemo(() => library.assets.filter((a) => a.kind === "model"), [library]);
  const tags = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of models) for (const tg of a.tags) count.set(tg, (count.get(tg) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => k);
  }, [models]);
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((a) => (!tag || a.tags.includes(tag)) && words.every((w) => a.id.toLowerCase().includes(w) || a.description.toLowerCase().includes(w) || a.tags.some((x) => x.includes(w))));
  }, [models, q, tag]);

  let body: ReactNode;
  switch (tab) {
    case "primitives":
      body = (
        <Grid>
          {GEOMETRIES.map((g) => (
            <Tile key={g.id} icon={GEO_ICONS[g.id] ?? Box} label={pretty(g.id)} hint={g.description} onClick={() => add({ kind: "mesh", geometry: g.id })} />
          ))}
        </Grid>
      );
      break;
    case "text":
      body = (
        <div className="space-y-2 p-2.5">
          <input value={text} onChange={(e) => setText(e.target.value)} className="field h-7" aria-label={t("add.textValue")} placeholder={t("add.textValue")} />
          <div className="grid grid-cols-2 gap-1.5">
            {FONTS.map((f) => (
              <button key={f.id} type="button" title={f.description} onClick={() => add({ kind: "text", text: text || "Text", font: f.id })} className="flex h-12 flex-col items-start justify-center rounded-md bg-ink-2 px-2 text-left hover:bg-ink-3">
                <span className={clsx("text-base leading-none", f.id.includes("serif") && "font-serif", f.id === "mono" && "font-mono", f.id.includes("bold") && "font-bold", f.id === "display" && "font-black tracking-tight")}>Aa</span>
                <span className="mt-1 text-2xs text-fg-faint">{f.id}</span>
              </button>
            ))}
          </div>
        </div>
      );
      break;
    case "generators":
      body = (
        <Grid>
          {GENERATORS.map((g) => (
            <Tile key={g.id} icon={GEN_ICONS[g.id] ?? Castle} label={pretty(g.id)} hint={g.description} onClick={() => add({ kind: "generator", generator: g.id })} />
          ))}
        </Grid>
      );
      break;
    case "particles":
      body = (
        <Grid>
          {PARTICLE_PRESETS.map((g) => (
            <Tile key={g.id} icon={PARTICLE_ICONS[g.id] ?? Sparkles} label={pretty(g.id)} hint={g.description} onClick={() => add({ kind: "particles", preset: g.id })} />
          ))}
        </Grid>
      );
      break;
    case "library":
      body = (
        <div className="flex min-h-0 flex-col">
          <div className="space-y-1.5 border-b border-line p-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("add.searchModels", { n: models.length })} className="field h-7 pl-6" aria-label={t("add.searchModels", { n: models.length })} />
            </div>
            <div className="flex flex-wrap gap-1">
              {tags.map((tg) => (
                <button key={tg} type="button" onClick={() => setTag(tag === tg ? null : tg)} className={clsx("rounded px-1.5 py-0.5 text-2xs", tag === tg ? "bg-accent/20 text-accent" : "bg-ink-2 text-fg-muted hover:text-fg")}>
                  {tg}
                </button>
              ))}
            </div>
          </div>
          <div className="py-1">
            {filtered.slice(0, 120).map((a) => (
              <button key={a.id} type="button" title={`${a.description}\n${a.license}${a.author ? ` · ${a.author}` : ""}`} onClick={() => add({ kind: "model", src: `library:${a.id}`, name: a.id.split("/").pop() })} className="flex w-full items-center gap-2 px-2.5 py-1 text-left hover:bg-ink-2">
                <Box size={12} className="shrink-0 text-fg-faint" />
                <span className="min-w-0 flex-1 truncate text-sm">{a.id.split("/").pop()}</span>
                <span className="shrink-0 text-2xs text-fg-faint">{a.id.split("/")[0]}</span>
              </button>
            ))}
            {!filtered.length && <div className="px-3 py-3 text-xs text-fg-faint">{models.length ? t("add.noMatch") : t("add.noLibrary")}</div>}
          </div>
        </div>
      );
      break;
    default:
      body = (
        <Grid>
          {LIGHTS.map((l) => (
            <Tile key={l.type} icon={l.icon} label={pretty(l.type)} hint={t("add.lightHint")} onClick={() => addLight(l.def)} />
          ))}
        </Grid>
      );
  }

  return (
    <div className="flex h-[44%] min-h-[220px] shrink-0 flex-col border-t border-line">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5" role="tablist">
        {TABS.map((tb) => {
          const I = tb.icon;
          const active = tab === tb.id;
          return (
            <button key={tb.id} type="button" role="tab" aria-selected={active} title={t(tb.label)} onClick={() => ui.set({ addTab: tb.id })} className={clsx("flex h-7 items-center gap-1 rounded-md px-1.5 text-xs", active ? "bg-ink-3 text-fg" : "text-fg-faint hover:text-fg")}>
              <I size={13} strokeWidth={1.75} />
              {active && <span className="font-medium">{t(tb.label)}</span>}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-1 p-1.5">{children}</div>;
}

function Tile({ icon: I, label, hint, onClick }: { icon: LucideIcon; label: string; hint?: string; onClick(): void }) {
  return (
    <button type="button" title={hint} onClick={onClick} className="flex h-[60px] flex-col items-center justify-center gap-1.5 rounded-md text-fg-muted transition-colors hover:bg-ink-3 hover:text-fg active:bg-ink-4">
      <I size={18} strokeWidth={1.5} />
      <span className="w-full truncate px-1 text-center text-2xs">{label}</span>
    </button>
  );
}

