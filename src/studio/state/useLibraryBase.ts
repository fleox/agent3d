// Base URL of the built-in library (library/) for previews: fonts, HDRIs, textures.

import { useEffect, useState } from "react";
import { useEditor } from "./context";

let cached: Promise<string> | null = null;

export function useLibraryBase(): string | null {
  const { backend } = useEditor();
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!cached) cached = backend.mountConfig().then((c) => (c.libraryBase ?? "./library/").replace(/\/?$/, "/"));
    void cached.then((b) => live && setBase(b)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [backend]);
  return base;
}

// URL of a library id ("hdri/beach.jpg") or ref ("library:hdri/beach.jpg").
export function libraryUrl(base: string, id: string): string {
  return base + id.replace(/^library:/, "").split("/").map(encodeURIComponent).join("/");
}
