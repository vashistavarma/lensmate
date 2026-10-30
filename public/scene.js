// Visual spatial context. A 7B vision model is unreliable at "left of / above / closer", so the browser MEASURES the layout
// from the detected boxes and (a) answers common spatial questions directly, (b) hands the measured layout to the model as context.
// Pure functions (unit-tested in eval/test_scene.js); the browser glue is at the bottom.
const LensScene = (() => {
  const W = 1204, H = 672;                       // detection-frame size (true camera orientation)

  // objects: [{label, box:[x1,y1,x2,y2]}] in true-camera pixels -> objects in the VIEW the user sees (mirrored if the mirror is on)
  function toView(objects, mirror) {
    return objects.map(o => {
      let [x1, y1, x2, y2] = o.box;
      if (mirror) [x1, x2] = [W - x2, W - x1];
      return { label: String(o.label), x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1, area: (x2 - x1) * (y2 - y1) };
    });
  }

  const zone = o => `${o.cy < H / 3 ? 'upper' : o.cy > 2 * H / 3 ? 'lower' : 'middle'} ${o.cx < W / 3 ? 'left' : o.cx > 2 * W / 3 ? 'right' : 'centre'}`.replace('middle centre', 'centre');
  const size = o => (o.area / (W * H) > 0.08 ? 'large' : o.area / (W * H) > 0.02 ? 'medium' : 'small');
  // how close to the camera something looks: lower in the picture and bigger = closer (a proxy: there is no depth sensor)
  const nearness = o => 0.6 * (o.y2 / H) + 0.4 * Math.sqrt(o.area / (W * H));

  // is a to the left/right/above/below b? (by centres, with a margin so side-by-side objects count and diagonal ones do not)
  const dxp = (a, b) => b.cx - a.cx, dyp = (a, b) => b.cy - a.cy;
  const leftOf  = (a, b) => dxp(a, b) > 0.3 * (a.w + b.w) / 2 && Math.abs(dyp(a, b)) < 0.9 * Math.max(a.h, b.h) + 0.1 * H;
  const rightOf = (a, b) => leftOf(b, a);
  const above   = (a, b) => dyp(a, b) > 0.3 * (a.h + b.h) / 2 && Math.abs(dxp(a, b)) < 0.9 * Math.max(a.w, b.w) + 0.1 * W;
  const below   = (a, b) => above(b, a);
  const dist    = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const overlapX = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) / Math.min(a.w, b.w);
  const onTopOf = (a, b) => above(a, b) && overlapX(a, b) > 0.4 && Math.abs(a.y2 - b.y1) < 0.35 * Math.max(a.h, b.h);

  function relation(a, b) { // the single best phrase for "a is ___ b"
    if (onTopOf(a, b)) return 'on top of';
    if (leftOf(a, b)) return 'to the left of';
    if (rightOf(a, b)) return 'to the right of';
    if (above(a, b)) return 'above';
    if (below(a, b)) return 'below';
    return dist(a, b) < 0.6 * (a.w + b.w) / 2 + 0.15 * W ? 'next to' : 'near';
  }

  // find the object a question is about (fuzzy: "the arduino" matches "Arduino UNO")
  function find(objs, name) {
    const n = name.toLowerCase().replace(/^(the|my|a|an)\s+/, '').trim();
    if (!n) return null;
    return objs.find(o => o.label.toLowerCase() === n) || objs.find(o => o.label.toLowerCase().includes(n) || n.includes(o.label.toLowerCase())) || null;
  }

  // the measured layout as text for the model (empty when nothing is labelled)
  function describe(objs, companion) {
    if (!objs.length) return '';
    const list = objs.slice(0, 10).map(o => {
      const others = objs.filter(p => p !== o).sort((p, q) => dist(o, p) - dist(o, q));
      const nb = others[0] ? `, ${relation(o, others[0])} the ${others[0].label}` : '';
      return `${o.label} (${zone(o)}, ${size(o)}${nb})`;
    });
    const byNear = objs.slice().sort((p, q) => nearness(q) - nearness(p));
    let t = `Layout of the labelled objects as the user sees the picture: ${list.join('; ')}. Looks closest to the camera: ${byNear[0].label}; farthest: ${byNear[byNear.length - 1].label}.`;
    if (companion) t += ` The companion (you) is ${companion}.`;
    return t;
  }

  // direct answers to common spatial questions; null when the question is not one of them
  function answer(q, objs) {
    const text = q.trim().replace(/[?.!]+$/, ''); let m;
    const nobody = what => `I don't see anything ${what}.`;
    const pick = (cands, ref, fn) => cands.filter(c => c !== ref && fn(c, ref)).sort((p, r) => dist(p, ref) - dist(r, ref));
    const rel = (name, words, fn) => {
      const ref = find(objs, name);
      if (!ref) return `I don't see a ${name.replace(/^the\s+/i, '')} to measure from.`;
      const hits = pick(objs, ref, fn);
      return hits.length ? `${cap(hits[0].label)} is ${words} the ${ref.label}${hits.length > 1 ? `, and so is the ${hits[1].label}` : ''}.` : nobody(`${words} the ${ref.label}`);
    };
    if ((m = text.match(/^(?:what|which)(?:'s| is| are)?(?: the)?(?: object| thing| item)?s? (?:is |are )?(?:to |on )?the left of (.+)$/i))) return rel(m[1], 'to the left of', leftOf);
    if ((m = text.match(/^(?:what|which)(?:'s| is| are)?(?: the)?(?: object| thing| item)?s? (?:is |are )?(?:to |on )?the right of (.+)$/i))) return rel(m[1], 'to the right of', rightOf);
    if ((m = text.match(/^(?:what|which)(?:'s| is| are)?(?: the)?(?: object| thing| item)?s? (?:is |are )?(?:directly )?(?:above|over|on top of) (.+)$/i))) return rel(m[1], 'above', above);
    if ((m = text.match(/^(?:what|which)(?:'s| is| are)?(?: the)?(?: object| thing| item)?s? (?:is |are )?(?:directly )?(?:below|under|beneath) (.+)$/i))) return rel(m[1], 'below', below);
    if ((m = text.match(/^(?:what|which)(?:'s| is| are)?(?: the)?(?: object| thing| item)?s? (?:is |are )?(?:next to|beside|near|closest to|nearest to) (.+)$/i))) {
      const ref = find(objs, m[1]); if (!ref) return `I don't see a ${m[1].replace(/^the\s+/i, '')} to measure from.`;
      const hits = objs.filter(c => c !== ref).sort((p, r) => dist(p, ref) - dist(r, ref));
      return hits.length ? `${cap(hits[0].label)} is the closest to the ${ref.label}.` : nobody(`near the ${ref.label}`);
    }
    if ((m = text.match(/^where(?:'s| is| are) (?:the |my )?(.+)$/i))) {
      const o = find(objs, m[1]); if (!o) return null;                       // not a labelled object: let the model handle it
      const nb = objs.filter(p => p !== o).sort((p, q) => dist(o, p) - dist(o, q))[0];
      return `The ${o.label} is in the ${zone(o)} of the picture${nb ? `, ${relation(o, nb)} the ${nb.label}` : ''}.`;
    }
    if (/^how many (?:objects|things|items)(?: are (?:there|here|in view|visible))?$/i.test(text)) return objs.length ? `I can see ${objs.length} labelled object${objs.length === 1 ? '' : 's'}: ${objs.map(o => o.label).join(', ')}.` : 'There are no labelled objects right now. Say "label everything" first.';
    if (/^(?:what|which)(?:'s| is)? (?:the )?(?:closest|nearest)(?: object| thing| item)?(?: to (?:the )?camera| to me| to us)?$/i.test(text)) {
      const o = objs.slice().sort((p, q) => nearness(q) - nearness(p))[0]; return o ? `The ${o.label} looks closest to the camera.` : null;
    }
    if (/^(?:what|which)(?:'s| is)? (?:the )?(?:farthest|furthest)(?: object| thing| item)?(?: from (?:the )?camera| from me)?$/i.test(text)) {
      const o = objs.slice().sort((p, q) => nearness(p) - nearness(q))[0]; return o ? `The ${o.label} looks farthest from the camera.` : null;
    }
    if (/^(?:what|which)(?:'s| is)? (?:the )?(?:biggest|largest)(?: object| thing| item)?$/i.test(text)) {
      const o = objs.slice().sort((p, q) => q.area - p.area)[0]; return o ? `The ${o.label} looks the biggest.` : null;
    }
    return null;
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const isSpatial = q => /\b(left of|right of|to the left|to the right|on the left|on the right|above|below|under|beneath|behind|beside|between|next to|nearest|closest|farthest|furthest|on top of|in front of|where is|where are|where's|how many|biggest|largest)\b/i.test(q);

  return { W, H, toView, zone, size, nearness, relation, find, describe, answer, isSpatial, leftOf, rightOf, above, below };
})();
if (typeof module !== 'undefined') module.exports = LensScene;

// ---- browser glue: labels -> measured layout -> direct answers + context for the model ----
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const sceneObjects = () => (typeof tracks !== 'undefined' ? tracks : []).map(t => ({ label: t.label, box: t.target.map(v => v * LensTracker.SCALE) })); // tracking px -> detection px
  const viewObjs = () => LensScene.toView(sceneObjects(), !!window.lensMirror?.());   // positions as the user sees them (mirror-aware)
  window.lensSpatialContext = () => { const o = viewObjs(); return o.length ? LensScene.describe(o, window.lensCompanionWhere?.()) : ''; };

  const prevIntent = window.lensIntent;
  window.lensIntent = async question => {
    const q = question.trim();
    if (LensScene.isSpatial(q)) {
      let objs = viewObjs();
      if (!objs.length && /^(what|which|where|how many)/i.test(q)) {   // a layout question and nothing is labelled yet: scan first
        const b = addMsg('Looking at the layout…', 'bot');
        try { await runDetect(null); } catch {}
        b.remove(); objs = viewObjs();
      }
      const a = objs.length ? LensScene.answer(q, objs) : null;
      if (a) { addMsg(a, 'bot'); history.push({ role: 'user', content: question }, { role: 'assistant', content: a }); window.onBotText?.(a, true); return true; }
    }
    return prevIntent ? prevIntent(question) : false;
  };
}
