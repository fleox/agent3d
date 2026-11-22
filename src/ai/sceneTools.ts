// Project / scene / object / timeline / catalog / check tools.

import { CATALOG, type CatalogEntry, type CatalogSection } from "../core/catalog";
import { getAt, PathError } from "../core/jsonPath";
import { closest } from "../core/suggest";
import type { InteractionDef, ObjectDef, SceneDoc, SegmentDef, TargetKind, TimelineDef, TrackDef } from "../core/types";
import { DEFAULT_ASPECT, TARGET_KINDS, validateScene } from "../core/validate";
import { checkProject } from "../ops/check";
import { OpsError } from "../ops/context";
import { addObject, listObjects, removeObject, updateObject } from "../ops/objects";
import { createProject, loadProject } from "../ops/project";
import { applyScene, getScene, patchScene, PATCH_OPS, summarizeScene, type PatchOp } from "../ops/scene";
import { editTimeline, setInteractions, setTimeline } from "../ops/timeline";
import { listTemplates, findTemplate } from "../ops/templates";
import { listAssets } from "../ops/assets";
import { bool, compactIssues, issueCounts, mutationResult, optStr, str } from "./shared";
import type { AiTool, JsonSchema } from "./types";

const dryRunProp: JsonSchema = { type: "boolean", description: "Preview the plan and issues without writing (default false)." };
const objectSchema: JsonSchema = {
  type: "object",
  description:
    'An ObjectDef: { "id": "logo", "kind": "mesh|text|model|group|generator|particles|instances|svg", "position": [x,y,z], "rotation": [x,y,z] (DEGREES), "scale": n | [x,y,z], "behaviours": [{ "type": "rotate", "speed": 30 }], "children": [...] } + kind fields: mesh { geometry: { type, …params }, material }, text { text, font, size, depth }, model { src: "assets/…glb" | "library:<id>", fit }, generator { generator, params, seed }, particles { preset, count, area, size, color }, instances { geometry, material, layout }, svg { src, depth }. Units ≈ metres, Y up. Look ids/params up with catalog_get first.',
  additionalProperties: true,
};

const SECTION_NAMES = Object.keys(CATALOG) as CatalogSection[];

function catalogCompact(section?: string, id?: string): unknown {
  if (!section) {
    return {
      sections: Object.fromEntries(
        SECTION_NAMES.map((s) => [s, (CATALOG[s] as readonly { id: string; description: string }[]).map((e) => `${e.id} — ${e.description}`)]),
      ),
      hint: 'Call catalog_get { section, id } for the full parameter list of one entry (types, defaults, ranges). Sections: ' + SECTION_NAMES.join(", ") + ".",
    };
  }
  const sec = SECTION_NAMES.find((s) => s.toLowerCase() === section.toLowerCase()) ?? SECTION_NAMES.find((s) => s.toLowerCase().startsWith(section.toLowerCase()));
  if (!sec) {
    const s = closest(section, SECTION_NAMES);
    throw new OpsError("notFound", `Unknown catalog section "${section}".`, `${s ? `Did you mean "${s}"? ` : ""}Sections: ${SECTION_NAMES.join(", ")}.`);
  }
  const list = CATALOG[sec] as readonly (CatalogEntry | { id: string; description: string; props: Record<string, unknown> })[];
  if (!id) {
    return {
      section: sec,
      entries: list.map((e) =>
        "props" in e ? { id: e.id, description: e.description, sets: e.props } : { id: e.id, description: e.description, params: (e as CatalogEntry).params.map((p) => p.name) },
      ),
      hint: sec === "materialPresets" ? 'Use as material { "preset": "<id>", …overrides }.' : `catalog_get { section: "${sec}", id } for parameter details.`,
    };
  }
  const entry = list.find((e) => e.id === id) ?? list.find((e) => e.id.toLowerCase() === id.toLowerCase());
  if (!entry) {
    const s = closest(id, list.map((e) => e.id));
    throw new OpsError("notFound", `No "${id}" in ${sec}.`, `${s ? `Did you mean "${s}"? ` : ""}Valid ids: ${list.map((e) => e.id).join(", ")}.`);
  }
  return { section: sec, ...entry };
}

export const SCENE_TOOLS: AiTool[] = [
  {
    name: "project_info",
    description:
      "Overview of the current Agent3D project: manifest, target (kind/aspect), compact scene outline (objects tree, lights, camera, timeline), asset count and validation status. Call this first to orient yourself.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    async handler(ctx) {
      const { manifest, scene } = await loadProject(ctx.fs);
      const issues = validateScene(scene);
      const assets = await listAssets(ctx.fs);
      return {
        manifest,
        summary: summarizeScene(scene),
        assets: { count: assets.assets.length, totalKb: assets.totalKb },
        validation: issueCounts(issues),
        hint: "Edit with scene_patch / object_add / object_update (small changes) or scene_apply (full document). Look up ids and params with catalog_get.",
      };
    },
  },
  {
    name: "scene_get",
    description:
      'Return the scene document (scene.json), or one part of it with `path`: "camera", "lights[0]", "objects#logo", "objects#logo.material", "timeline.tracks". Use scene_summary for a compact outline of big scenes.',
    inputSchema: { type: "object", properties: { path: { type: "string", description: 'Optional JSON path, e.g. "objects#logo.material" or "environment.background".' } } },
    mutating: false,
    async handler(ctx, input) {
      const scene = await getScene(ctx.fs);
      const path = optStr(input, "path");
      if (!path) return scene;
      try {
        return { path, value: getAt(scene, path) };
      } catch (e) {
        if (e instanceof PathError) throw new OpsError("notFound", e.message, e.hint ?? "Use scene_summary to see the structure.");
        throw e;
      }
    },
  },
  {
    name: "scene_summary",
    description: "Compact outline of the scene: objects tree (id, kind, geometry/generator/preset, position, behaviours), lights, camera, background, timeline tracks, post effects, scripts, HUD ids.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    async handler(ctx) {
      return summarizeScene(await getScene(ctx.fs));
    },
  },
  {
    name: "scene_apply",
    description:
      "Replace the whole scene with a full SceneDoc (version 1, id, title, target, camera, environment, lights, objects, optional timeline/postfx/physics/scripts/ui/audio). Validated first: a scene with errors is refused and nothing is written. Returns a diff plan (objects added/removed/changed by id, sections changed); applying the same document twice is a no-op. Prefer scene_patch for small edits. Angles are degrees, units ≈ metres, colours CSS strings.",
    inputSchema: { type: "object", properties: { scene: { type: "object", description: "The complete SceneDoc.", additionalProperties: true }, dryRun: dryRunProp }, required: ["scene"] },
    mutating: true,
    async handler(ctx, input) {
      const dryRun = bool(input, "dryRun");
      return mutationResult(await applyScene(ctx.fs, input.scene as SceneDoc, { dryRun }), dryRun);
    },
  },
  {
    name: "scene_patch",
    description:
      'Apply several edits atomically (all or nothing; the result is validated and refused on errors). Ops: {op:"set", path, value} · {op:"merge", path, value} (deep merge, null deletes a key) · {op:"remove", path} · {op:"addObject", object, parent?, index?} · {op:"updateObject", id, set} (deep merge) · {op:"removeObject", id} (also drops its tracks) · {op:"moveObject", id, parent? (null = root), index?} · {op:"addBehaviour", id, behaviour} · {op:"addTrack", track} (replaces a track with the same target) · {op:"removeTrack", target}. Paths: "camera.position", "lights[1].intensity", "objects#logo.material.color" (object by id anywhere in the tree), "objects#logo.position[1]". Example: [{"op":"set","path":"objects#logo.material.color","value":"#ff3366"},{"op":"addBehaviour","id":"logo","behaviour":{"type":"float","amplitude":0.2}}].',
    inputSchema: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          minItems: 1,
          description: "Patch operations, applied in order.",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: PATCH_OPS },
              path: { type: "string" },
              value: { description: "Value for set / merge." },
              object: objectSchema,
              parent: { type: ["string", "null"] },
              index: { type: "integer" },
              id: { type: "string" },
              set: { type: "object", additionalProperties: true },
              behaviour: { type: "object", additionalProperties: true },
              track: { type: "object", additionalProperties: true },
              target: { type: "string" },
            },
            required: ["op"],
          },
        },
        dryRun: dryRunProp,
      },
      required: ["ops"],
    },
    mutating: true,
    async handler(ctx, input) {
      const dryRun = bool(input, "dryRun");
      return mutationResult(await patchScene(ctx.fs, input.ops as PatchOp[], { dryRun }), dryRun);
    },
  },
  {
    name: "scene_validate",
    description:
      "Validate a scene document (or the current scene.json when `scene` is omitted) against the format and the catalog. Returns issues with readable paths (objects#logo.material.roughness), messages and hints that say exactly what to change. Errors block saving; warnings are ignored fields or likely mistakes.",
    inputSchema: { type: "object", properties: { scene: { type: "object", description: "A SceneDoc to validate (default: the project's scene).", additionalProperties: true } } },
    mutating: false,
    async handler(ctx, input) {
      const scene = input.scene ?? (await getScene(ctx.fs));
      const issues = validateScene(scene);
      const counts = issueCounts(issues);
      return { ok: counts.errors === 0, counts, ...compactIssues(issues, 60) };
    },
  },
  {
    name: "object_add",
    description:
      'Add an object to the scene (at the root or under `parent`). Ids must be unique across the whole tree and the lights. Example: { "object": { "id": "planet", "kind": "generator", "generator": "planet", "params": { "radius": 1.5, "rings": true }, "position": [3, 0, 0], "behaviours": [{ "type": "rotate", "speed": 10 }] } }. Check generator / geometry params with catalog_get first.',
    inputSchema: { type: "object", properties: { object: objectSchema, parent: { type: "string", description: "Parent object id (default: scene root)." }, index: { type: "integer", description: "Position among siblings (default: last)." }, dryRun: dryRunProp }, required: ["object"] },
    mutating: true,
    async handler(ctx, input) {
      const dryRun = bool(input, "dryRun");
      return mutationResult(await addObject(ctx.fs, input.object as ObjectDef, { parent: optStr(input, "parent"), index: typeof input.index === "number" ? input.index : undefined, dryRun }), dryRun);
    },
  },
  {
    name: "object_update",
    description:
      'Change fields of an object by id. `set` is deep-merged: { "material": { "color": "#ff0000" } } keeps the other material fields; null deletes a field; arrays (position, behaviours, colors) are replaced. Rotation in degrees. Example: { "id": "logo", "set": { "position": [0, 1.2, 0], "scale": 1.5 } }.',
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Object id." }, set: { type: "object", description: "Fields to merge into the object.", additionalProperties: true }, dryRun: dryRunProp }, required: ["id", "set"] },
    mutating: true,
    async handler(ctx, input) {
      const dryRun = bool(input, "dryRun");
      return mutationResult(await updateObject(ctx.fs, str(input, "id"), input.set as Record<string, unknown>, { dryRun }), dryRun);
    },
  },
  {
    name: "object_remove",
    description: "Remove an object (and its children) by id. Timeline tracks animating it are removed too. Check camera.follow if it followed this object.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Object id." }, dryRun: dryRunProp }, required: ["id"] },
    mutating: true,
    async handler(ctx, input) {
      const dryRun = bool(input, "dryRun");
      return mutationResult(await removeObject(ctx.fs, str(input, "id"), { dryRun }), dryRun);
    },
  },
  {
    name: "object_list",
    description: "Flat list of every object: id, kind, detail (geometry / generator / preset / text), parent id, depth, position, behaviours.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    async handler(ctx) {
      const objects = await listObjects(ctx.fs);
      return { count: objects.length, objects };
    },
  },
  {
    name: "timeline_set",
    description:
      'Edit the keyframe timeline. Replace it with `timeline` ({ "duration": 6, "loop": true | "pingpong", "trigger": "visible|load|hover|click|scroll|manual", "speed", "autoplay": true | false | "<segment>", "markers": { "name": seconds }, "segments": { "name": { "from", "to" } | [from, to] }, "scroll": { "start": "top bottom", "end": "bottom top", "smoothing": 0.8 }, "tracks": [...] }, null removes it), or edit incrementally: `addTracks` (replaces tracks with the same target), `removeTargets`, `settings` (duration, loop, trigger, speed, autoplay, scroll), `markers` / `segments` (merged by name, null removes). A track: { "target": "<selector>.<property>", "keys": [[time_s, value], [time_s, value, "ease"]…], "ease": "outCubic", "stagger": 0.06, "staggerFrom": "start|end|center|edges|random" }. Selector: an id, "a,b,c", "tag:<tag>", "children:<id>" (text letters too), "camera", "environment", "postfx". Properties: position | rotation | scale (vec3, rotation in DEGREES) or .x/.y/.z, visible, material.<opacity|color|emissive|emissiveIntensity|metalness|roughness|…>, material.uniforms.<name>, morph.<name>, animation.<clip>.weight|speed|time (models), light intensity/color/angle/penumbra, camera.position|target|fov|zoom|focus, environment.fog.color|near|far|density, environment.lightingIntensity|exposure|background, postfx.<type>.<param>. Values may be relative: "+=1", "-=0.5", "*=1.2". Easings: in/out/inOut × Quad Cubic Quart Quint Sine Expo Circ Back Elastic Bounce, linear, step, "cubicBezier(x1,y1,x2,y2)", "spring(stiffness,damping)", "steps(n)". Keys are sorted for you.',
    inputSchema: {
      type: "object",
      properties: {
        timeline: { type: ["object", "null"], description: "Full replacement (null removes the timeline).", additionalProperties: true },
        addTracks: { type: "array", items: { type: "object", additionalProperties: true }, description: "Tracks to add or replace (by target)." },
        removeTargets: { type: "array", items: { type: "string" }, description: "Targets of tracks to remove." },
        settings: { type: "object", description: "Timeline settings to merge: duration, loop, trigger, speed, autoplay, scroll.", additionalProperties: true },
        markers: { type: "object", description: 'Markers to add / move ({ "reveal": 1.2 }); null removes one.', additionalProperties: true },
        segments: { type: "object", description: 'Segments to add / change ({ "hover-in": { "from": 0, "to": 0.6 } }); null removes one.', additionalProperties: true },
        dryRun: dryRunProp,
      },
    },
    mutating: true,
    async handler(ctx, input) {
      const dryRun = bool(input, "dryRun");
      if ("timeline" in input && input.timeline !== undefined) return mutationResult(await setTimeline(ctx.fs, input.timeline as TimelineDef | null, { dryRun }), dryRun);
      if (!input.addTracks && !input.removeTargets && !input.settings && !input.markers && !input.segments) throw new OpsError("invalid", "timeline_set needs `timeline`, `addTracks`, `removeTargets`, `settings`, `markers` or `segments`.");
      return mutationResult(
        await editTimeline(
          ctx.fs,
          {
            addTracks: input.addTracks as TrackDef[] | undefined,
            removeTargets: input.removeTargets as string[] | undefined,
            settings: input.settings as Partial<TimelineDef> | undefined,
            markers: input.markers as Record<string, number | null> | undefined,
            segments: input.segments as Record<string, SegmentDef | null> | undefined,
          },
          { dryRun },
        ),
        dryRun,
      );
    },
  },
  {
    name: "interactions_set",
    description:
      'Edit scene.interactions — no-code triggers. Replace the list with `interactions` (null or [] removes them) or append with `add`. An interaction: { "on": "click" | "hover" | "hoverEnd" | "visible" | "scroll" | "key" | "event", "target"?: "<objectId>" (click/hover/hoverEnd; omitted = whole canvas), "key"?: "Space" (on key), "event"?: "<marker or emitted name>" (on event), "at"?: 0.5 (on scroll: progress crossed downward), "once"?: true, "do": [actions] }. Actions: { "play": "<segment>" | "timeline", "reverse"?: true }, { "toggle": "<segment>" } (forward, then backward), { "seek": seconds | "<marker>" }, { "set": { "path": "<id>.<property>", "value": … }, "duration"?: 0.4, "ease"?: "outCubic" } (tweened from the current value), { "emit": "<event>", "payload"? }, { "openUrl": "https://…" | "/path", "newTab"? } (click / key only — the only way a scene navigates), { "playClip": "Wave", "target": "<modelId>", "loop"?, "speed"?, "crossfade"? }. Hover / click targets get a pointer cursor. Check hover / click states with render_preview `input` (pointer / click events).',
    inputSchema: {
      type: "object",
      properties: {
        interactions: { type: ["array", "null"], items: { type: "object", additionalProperties: true }, description: "Full replacement (null or [] removes them)." },
        add: { type: "array", items: { type: "object", additionalProperties: true }, description: "Interactions to append." },
        dryRun: dryRunProp,
      },
    },
    mutating: true,
    async handler(ctx, input) {
      const dryRun = bool(input, "dryRun");
      if (input.interactions === undefined && !input.add) throw new OpsError("invalid", "interactions_set needs `interactions` or `add`.");
      return mutationResult(await setInteractions(ctx.fs, { interactions: input.interactions as InteractionDef[] | null | undefined, add: input.add as InteractionDef[] | undefined }, { dryRun }), dryRun);
    },
  },
  {
    name: "catalog_get",
    description:
      "Look up what scenes can reference: geometries, materialPresets, shaders, behaviours, generators, particlePresets, postfx, fonts, sounds. No input → every section with ids and one-line descriptions. { section } → entries with param names. { section, id } → the full entry (param types, defaults, min/max, enum options, triangle cost). Always check here before using an id or a param — validation rejects unknown ids.",
    inputSchema: { type: "object", properties: { section: { type: "string", enum: SECTION_NAMES, description: "Catalog section." }, id: { type: "string", description: "Entry id within the section." } } },
    mutating: false,
    handler(_ctx, input) {
      return catalogCompact(optStr(input, "section"), optStr(input, "id"));
    },
  },
  {
    name: "templates_list",
    description: "List starter templates (id, title, description, kind, aspect, tags) to start a project from with project_create { template }. Filter by kind (banner, hero, card, square, fullscreen, inline, game) or words.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: TARGET_KINDS }, query: { type: "string", description: "Words to match in title / description / tags." } } },
    mutating: false,
    handler(ctx, input) {
      const index = ctx.host?.templates?.index ?? [];
      const list = listTemplates(index, { kind: optStr(input, "kind") as TargetKind | undefined, query: optStr(input, "query") });
      return { count: list.length, templates: list, ...(index.length ? {} : { hint: "No templates available in this host; project_create without a template makes a good-looking starter scene for the target kind." }) };
    },
  },
  {
    name: "project_create",
    description:
      'Create a new project in the current folder: agent3d.json, scene.json, assets/manifest.json (+ scripts for games). Without a template you get an attractive starter for the target kind (banner: gradient background, studio lighting, floating 3D title; hero: blob + title; card: product on a pedestal; square: holographic gem; fullscreen: island landscape; game: coin collector with a script). Then edit it with scene_patch and verify with render_preview. Default aspects: banner 4:1, hero 16:9, card 4:5, square 1:1.',
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project slug, e.g. \"spring-sale-banner\"." },
        title: { type: "string", description: "Human title (also the starter's 3D text)." },
        template: { type: "string", description: "Template id from templates_list." },
        kind: { type: "string", enum: TARGET_KINDS, description: "Target kind (default banner)." },
        aspect: { type: "string", description: '"W:H", e.g. "4:1", "16:9", "1:1".' },
        force: { type: "boolean", description: "Overwrite an existing project in this folder." },
      },
      required: ["name"],
    },
    mutating: true,
    async handler(ctx, input) {
      const template = optStr(input, "template");
      let templateFiles: Record<string, Uint8Array | string> | undefined;
      if (template) {
        if (!ctx.host?.templates) throw new OpsError("invalid", "Templates are not available in this host.", "Create the project without a template (a starter scene is generated for the target kind).");
        findTemplate(ctx.host.templates.index, template);
        templateFiles = await ctx.host.templates.files(template);
      }
      const kind = optStr(input, "kind") as TargetKind | undefined;
      const aspect = optStr(input, "aspect");
      const target = kind || aspect ? { ...(kind ? { kind } : {}), ...(aspect ? { aspect } : kind ? { aspect: DEFAULT_ASPECT[kind] } : {}) } : undefined;
      const r = await createProject(ctx.fs, { name: str(input, "name"), title: optStr(input, "title"), template, templateFiles, target, force: bool(input, "force") });
      return { manifest: r.manifest, files: r.files, summary: summarizeScene(r.scene), ...compactIssues(r.issues), hint: "Next: render_preview to see it, then scene_patch to make it yours." };
    },
  },
  {
    name: "check",
    description:
      "Pre-publish check: validation, missing asset / script files, script sandbox lint (no fetch, DOM, eval, storage… — scripts only get `api`), triangle + bundle-size budget for the target kind, licences that need attribution, accessibility (ariaLabel, reduced motion). With render data from render_preview it also reports framing (objects out of view, clipped, camera inside an object, scene too small) and runtime performance (draw calls, triangles). Every issue has a hint saying what to change.",
    inputSchema: { type: "object", properties: { useLastRender: { type: "boolean", description: "Include stats/inspect from the last render_preview of this session (default true)." } } },
    mutating: false,
    async handler(ctx, input) {
      const last = bool(input, "useLastRender", true) ? lastRender.get(ctx.fs) : undefined;
      const report = await checkProject(ctx.fs, { library: ctx.host?.library?.index, runtimeStats: last?.stats, inspect: last?.inspect });
      return { ok: report.ok, counts: report.counts, budget: report.budget, licences: report.licences, ...compactIssues(report.issues, 50) };
    },
  },
];

// Last render result per project (check reuses its stats / inspect).
export const lastRender = new WeakMap<object, { stats?: import("../runtime/api").FrameStats; inspect?: import("../runtime/api").InspectResult }>();
