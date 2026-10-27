/** Looks up a required element by id, failing loudly if the markup and code disagree. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Looks up a required SVG element by id. */
export function svgById(id: string): SVGElement {
  const node = document.getElementById(id);
  if (!(node instanceof SVGElement)) throw new Error(`Missing SVG element #${id}`);
  return node;
}

/** Sets text only when it changed, so per-frame HUD updates stay cheap. */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Reads a CSS custom property, for canvas drawing that should match the theme. */
export function cssToken(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
