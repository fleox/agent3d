// The box whose travel through the viewport measures scroll progress.
// A pinned scene (the element or an ancestor is `position: sticky`) stays at
// the same place while the page scrolls, so its own rect never moves: the
// progress follows the sticky box's parent (the tall pin section) instead,
// minus the sticky box's height — so "top top" → "bottom top" runs exactly
// while the scene is pinned (from the section's top reaching the viewport top
// to the moment the sticky box starts leaving).
// The sticky ancestor is looked up once per element (layouts do not switch
// to / from sticky at run time).

const cache = new WeakMap<Element, Element | null>();

export function scrollRect(el: Element): { top: number; height: number } {
  let sticky = cache.get(el);
  if (sticky === undefined) {
    sticky = null;
    const win = el.ownerDocument.defaultView;
    for (let n: Element | null = el; n && n !== el.ownerDocument.body; n = n.parentElement) {
      if (n.parentElement && win?.getComputedStyle(n).position === "sticky") {
        sticky = n;
        break;
      }
    }
    if (el.isConnected) cache.set(el, sticky);
  }
  if (!sticky) {
    const r = el.getBoundingClientRect();
    return { top: r.top, height: r.height };
  }
  const section = sticky.parentElement!.getBoundingClientRect();
  return { top: section.top, height: Math.max(1, section.height - sticky.getBoundingClientRect().height) };
}
