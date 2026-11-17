'use client';
// agent-build — React / Next.js component.
//   import { AgentBuild } from 'agent-build/react'
//   <AgentBuild agents={8} hud><App /></AgentBuild>
import { createElement, Fragment, useEffect, useRef, useState } from 'react';
import { attach } from './index.mjs';

export function AgentBuild({
  children, as = 'div', className, style,
  agents, speed, duration, maxLayers, names, colors, hud, trigger, follow, finale,
  onDone, ...rest
}) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const doneRef = useRef(onDone); doneRef.current = onDone;

  useEffect(() => {
    const el = ref.current; if (!el) return;
    let builder = null, dead = false;
    const show = () => { if (!dead) setReady(true); };
    const safety = setTimeout(show, 4000); // never keep content hidden if something goes wrong
    const onEvt = e => doneRef.current && doneRef.current(e.detail);
    el.addEventListener('agentbuild:done', onEvt);

    attach(el, { agents, speed, duration, maxLayers, names, colors, hud, trigger, follow, finale })
      .then(b => {
        if (!b) return show();
        if (dead) { b.ready.then(() => b.destroy()); return; } // React StrictMode double-mount
        builder = b;
        return b.ready.then(() => { clearTimeout(safety); show(); });
      })
      .catch(show);

    return () => {
      dead = true; clearTimeout(safety);
      el.removeEventListener('agentbuild:done', onEvt);
      if (builder) builder.destroy();
    };
    // options are read once on mount; remount (change `key`) to apply new ones
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hidden until the agents have taken over, so there is no flash of the finished page
  const s = ready ? style : { ...style, opacity: 0 };
  return createElement(Fragment, null,
    createElement('noscript', { dangerouslySetInnerHTML: { __html: '<style>[data-agent-build]{opacity:1!important}</style>' } }),
    createElement(as, { ref, 'data-agent-build': '', className, style: s, ...rest }, children),
  );
}

export default AgentBuild;
