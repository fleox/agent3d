// Runtime entry (dist/runtime/agent3d-runtime.js): exports mountScene, defines
// the <agent3d-scene> element and exposes globalThis.Agent3D.

import { version } from "../../package.json";
import type { MountScene } from "./api";
import { Agent3DSceneElement, defineElement } from "./element";
import { mountScene } from "./player";

export type { FrameStats, HeadlessHandle, InspectResult, MountOptions, Player, RuntimeIssue, ScriptApi } from "./api";
export { mountScene, Agent3DSceneElement, version };

defineElement();

const g = globalThis as unknown as { Agent3D?: { mountScene: MountScene; version: string } };
if (!g.Agent3D) g.Agent3D = { mountScene, version };
