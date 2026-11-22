// Runtime entry (dist/runtime/agent3d-runtime.js): exports mountScene, defines
// the <agent3d-scene> element and exposes globalThis.Agent3D.

import { version } from "../../package.json";
import type { MountScene } from "./api";
import { bindSceneData } from "./data";
import { Agent3DSceneElement, defineElement } from "./element";
import { liveContextCount, mountScene } from "./player";

export type { FrameStats, HeadlessHandle, InspectResult, MountOptions, Player, RuntimeIssue, ScriptApi } from "./api";
export { mountScene, Agent3DSceneElement, bindSceneData, liveContextCount, version };

defineElement();

// One global per page, shared by every scene (several <script> tags of the same runtime are harmless).
const g = globalThis as unknown as { Agent3D?: { mountScene: MountScene; version: string; bindSceneData: typeof bindSceneData; liveContexts: () => number } };
if (!g.Agent3D) g.Agent3D = { mountScene, version, bindSceneData, liveContexts: liveContextCount };
