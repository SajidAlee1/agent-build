// agent-build — ESM entry for bundlers (Vite, Next.js, webpack, …).
// Safe to import during server-side rendering: nothing touches `window` until you call a function in the browser.

let loading = null;
function load() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  return (loading ||= import('./agent-build.js').then(() => window.AgentBuild));
}

/**
 * Let the agents build `root` (default: the whole <body>).
 * @param {Element} [root]
 * @param {import('./index').AgentBuildOptions} [options]
 * @returns {Promise<import('./index').AgentBuildInstance | null>} null when called on the server
 */
export async function attach(root, options) {
  const AB = await load();
  if (!AB) return null;
  return AB.attach(root || document.body, options || {});
}

/** Registers the <agent-build> custom element (for plain HTML / Vue / Svelte templates). */
export function defineElement() { return load(); }

export default attach;
