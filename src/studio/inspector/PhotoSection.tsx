// 3D photo (kind "photo"): image + depth map pickers, mode-dependent fields,
// motion, effects (./PhotoEffectsSection.tsx), tint / opacity, and "Generate
// depth map" (the image_depth tool, available when the host has a depth
// estimator: `agent3d studio`).

import { Loader2, Wand2 } from "lucide-react";
import { useState } from "react";
import type { PhotoObjectDef } from "../../core/types";
import { ImageAssetField, useProjectImages } from "../components/ImageAssetField";
import { toast } from "../components/ui/Toast";
import { Button, Section } from "../components/ui/controls";
import { ToolCallError } from "../backend/types";
import { useI18n } from "../i18n";
import { objPath } from "../lib/patches";
import { canEstimateDepth, DEPTH_TOOL, depthResultPath, depthToolInput, photoSpecs } from "../lib/photo";
import { useEditor } from "../state/context";
import { ParamForm, ParamRow, useBinder } from "./fields";
import { PhotoEffectsSection } from "./PhotoEffectsSection";
import { PHOTO_MATERIAL_SPECS, PHOTO_MODE_SPEC, PHOTO_MOTION_SPECS } from "./specs";

export function PhotoSection({ object: o }: { object: PhotoObjectDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const { backend, tools } = useEditor();
  const images = useProjectImages();
  const [busy, setBusy] = useState(false);
  const base = objPath(o.id, "");
  const values = o as unknown as Record<string, unknown>;
  const canDepth = canEstimateDepth(backend.capabilities) && tools.some((x) => x.name === DEPTH_TOOL);

  const generateDepth = async () => {
    setBusy(true);
    try {
      const r = await backend.call(DEPTH_TOOL, depthToolInput(o));
      const path = depthResultPath(r);
      if (!path) throw new ToolCallError("io", t("photo.depthNoPath"));
      bind(objPath(o.id, "depth"), path);
      images.reload();
      toast({ tone: "success", title: t("photo.depthDone"), detail: path });
    } catch (e) {
      const err = e as ToolCallError;
      toast({ tone: "error", title: t("photo.depthFailed"), detail: [err.message, err.hint].filter(Boolean).join(" ") }, 8000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title={t("kinds.photo")} id="photo">
        <ImageAssetField label={t("photo.image")} hint={t("photo.imageHint")} value={o.src} onChange={(v) => v && bind(objPath(o.id, "src"), v)} projectAssets={images.assets} onOpen={images.reload} ariaLabel={t("photo.image")} />
        <ImageAssetField label={t("photo.depth")} hint={t("photo.depthHint")} value={o.depth} onChange={(v) => bind(objPath(o.id, "depth"), v)} projectAssets={images.assets} onOpen={images.reload} library={false} ariaLabel={t("photo.depth")} />
        <div className="flex items-center gap-2 px-3 py-1">
          <span title={canDepth ? t("photo.generateDepthHint") : t("photo.depthNeedsCli")} className="inline-flex">
            <Button size="xs" disabled={!canDepth || busy} onClick={() => void generateDepth()}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} {busy ? t("photo.generatingDepth") : t("photo.generateDepth")}
            </Button>
          </span>
        </div>
        {!o.depth && <div className="px-3 pb-1 text-2xs leading-snug text-fg-faint">{canDepth ? t("photo.flatHint") : t("photo.depthNeedsCli")}</div>}
        <ParamRow spec={PHOTO_MODE_SPEC} value={o.mode} onChange={(v) => bind(objPath(o.id, "mode"), v)} />
        <ParamForm specs={photoSpecs(o)} base={base} values={values} />
      </Section>
      <Section title={t("photo.motion")} id="photo-motion">
        <ParamForm specs={PHOTO_MOTION_SPECS} base={objPath(o.id, "motion")} values={o.motion as Record<string, unknown> | undefined} />
      </Section>
      <PhotoEffectsSection object={o} />
      <Section title={t("inspector.material")} id="photo-material" defaultOpen={!!o.material}>
        <ParamForm specs={PHOTO_MATERIAL_SPECS} base={objPath(o.id, "material")} values={o.material as Record<string, unknown> | undefined} />
      </Section>
    </>
  );
}
