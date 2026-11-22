import type { PluginManifest } from "@agent-cms/runtime";
import { basePathFromBaseUrl, getCurrentPublishContext } from "@agent-cms/runtime";
import readme from "../README.md?raw";
import { i18n } from "./i18n";
import { DEFAULT_CONFIG, PLUGIN_ID, renderSceneMarkers, type PluginConfig } from "./render";
import { sceneBlock } from "./scene-block";
import { SETTINGS_SCHEMA, SettingsPage } from "./settings";

// Plugin entry point. The admin imports dist/bundle.js and reads its
// default export. register(api) runs every time the admin (re)applies
// plugins, on a freshly reset registry: it only registers things.

const manifest: PluginManifest<PluginConfig> = {
  id: PLUGIN_ID,
  name: "Agent3D scene",
  version: "1.0.0",
  description: "Embed 3D scenes made with Agent3D (banners, heroes, characters, product showcases, mini games) in posts and pages.",
  author: "fleox",
  readme,
  i18n,
  settings: { navLabelKey: "settings.navLabel", defaultConfig: DEFAULT_CONFIG, component: SettingsPage, schema: SETTINGS_SCHEMA },
  register(api) {
    // Editor block + its publish-time rendering: the stored marker becomes
    // the runtime module script + <agent3d-scene>.
    api.registerBlock(sceneBlock);
    api.addFilter<string>("post.html.body", (html) => {
      if (!html.includes('data-cms-block="agent3d-scene/scene"')) return html;
      const ctx = getCurrentPublishContext();
      return renderSceneMarkers(html, basePathFromBaseUrl(ctx?.settings?.baseUrl));
    });
  },
};

export default manifest;
