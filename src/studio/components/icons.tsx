import { Box, Folder, Lightbulb, Mountain, Package, PenTool, Sparkles, Sun, Type, LayoutGrid, Lamp, SunDim, CloudSun, Square, type LucideIcon } from "lucide-react";

export const KIND_ICONS: Record<string, LucideIcon> = {
  mesh: Box,
  text: Type,
  model: Package,
  group: Folder,
  generator: Mountain,
  particles: Sparkles,
  instances: LayoutGrid,
  svg: PenTool,
};

export const LIGHT_ICONS: Record<string, LucideIcon> = {
  ambient: SunDim,
  directional: Sun,
  point: Lightbulb,
  spot: Lamp,
  hemisphere: CloudSun,
  rect: Square,
};

export function KindIcon({ kind, size = 13, className }: { kind: string; size?: number; className?: string }) {
  const I = KIND_ICONS[kind] ?? Box;
  return <I size={size} className={className} strokeWidth={1.75} />;
}
