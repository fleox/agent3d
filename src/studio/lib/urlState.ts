// Deep-link / screenshot params: ?select=<id>&panel=timeline|interactions|json|check
// &assistant=1&dialog=export|render&device=tablet&start=1&project=<local id>
export function urlParam(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name) ?? new URLSearchParams(location.hash.replace(/^#/, "")).get(name);
  } catch {
    return null;
  }
}
