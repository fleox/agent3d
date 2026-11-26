// 3D photo effects (PhotoObjectDef.effects): one toggle per effect of
// src/core/photoEffects.ts (adding an effect there + its specs / i18n label
// adds it here), and its params when it is on. Effects that need a depth map
// say so on a flat photo.

import type { PhotoEffectId } from "../../core/photoEffects";
import { PHOTO_EFFECTS, PHOTO_EFFECT_IDS } from "../../core/photoEffects";
import type { PhotoObjectDef } from "../../core/types";
import { Section, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { objPath } from "../lib/patches";
import { ParamForm, useBinder } from "./fields";
import { PHOTO_EFFECT_SPECS } from "./specs";

export function PhotoEffectsSection({ object: o }: { object: PhotoObjectDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const effects = (o.effects ?? {}) as Partial<Record<PhotoEffectId, Record<string, unknown>>>;
  const active = PHOTO_EFFECT_IDS.filter((id) => effects[id]);
  const toggle = (id: PhotoEffectId, on: boolean) => {
    // the last effect off removes `effects` altogether
    if (!on && active.length === 1 && active[0] === id) bind(objPath(o.id, "effects"), undefined);
    else bind(objPath(o.id, `effects.${id}`), on ? {} : undefined);
  };
  return (
    <Section title={t("photo.effects")} id="photo-effects" defaultOpen={active.length > 0}>
      {PHOTO_EFFECT_IDS.map((id) => {
        const on = !!effects[id];
        const label = t(`photo.effect.${id}`);
        return (
          <div key={id} className="border-t border-line/40 first:border-t-0">
            <div className="flex items-center justify-between gap-2 px-3 py-1">
              <span className="text-xs text-fg" title={t(`photo.effect.${id}Hint`)}>
                {label}
              </span>
              <Toggle checked={on} onChange={(v) => toggle(id, v)} ariaLabel={label} />
            </div>
            {on && !o.depth && PHOTO_EFFECTS[id].needsDepth && <div className="px-3 pb-1 text-2xs leading-snug text-fg-faint">{t("photo.effectNeedsDepth")}</div>}
            {on && <ParamForm specs={PHOTO_EFFECT_SPECS[id]} base={objPath(o.id, `effects.${id}`)} values={effects[id]} />}
          </div>
        );
      })}
    </Section>
  );
}
