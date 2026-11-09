/* Live View menus: inert DOM updates rendered by the viewer, without source-side page screenshots. */
const MenuView = {
  tags: new Set('div span p button img input textarea select option optgroup label h1 h2 h3 h4 h5 h6 ul ol li table tbody thead tfoot tr td th section header footer nav main aside article a strong b em i small time hr br progress meter canvas video svg path circle rect line polyline polygon ellipse g defs lineargradient radialgradient stop clippath mask pattern text tspan use symbol title desc'.split(' ')),
  svg: new Set('svg path circle rect line polyline polygon ellipse g defs lineargradient radialgradient stop clippath mask pattern text tspan use symbol title desc'.split(' ')),
  names: { lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath' },
  max: 8 * 1024 * 1024,
  attr(name) { return /^(id|class|style|title|alt|role|type|value|checked|selected|disabled|hidden|placeholder|width|height|viewBox|d|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|fill-rule|clip-rule|opacity|transform|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|points|offset|stop-color|stop-opacity|preserveAspectRatio|xmlns|data-[\w-]+|aria-[\w-]+)$/.test(name); },
  // Only opaque resource tokens enter attributes. The viewer never fetches URLs supplied by the player.
  css(value, resolve) {
    if (String(value || '').includes('\\')) return '';
    return String(value || '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_, a, b, c) => `url("${resolve((a ?? b ?? c ?? '').trim())}")`);
  },
  open(owner, channel, valid, privateOpen) {
    const m = { owner, channel, stopped: false, paused: false, active: false, queue: [], parts: new Map(), nodes: new Map(), assets: new Map(), objects: new Set(), bytes: 0, updates: 0 };
    const alive = () => !m.stopped && valid();
    const send = (value, urgent = false) => {
      if (!alive() || channel.readyState !== 'open') return;
      const json = JSON.stringify(value); if (json.length > this.max) return;
      const key = ++m.serial, n = Math.ceil(json.length / 8000), chunks = [];
      for (let i = 0; i < n; i++) chunks.push(JSON.stringify({ k: key, i, n, d: json.slice(i * 8000, (i + 1) * 8000) }));
      if (urgent) m.queue.unshift(...chunks); else m.queue.push(...chunks);
      pump();
    };
    m.serial = 0;
    const pump = () => {
      clearTimeout(m.pumpTimer);
      if (!alive() || channel.readyState !== 'open') return;
      let count = 0;
      while (m.queue.length && channel.bufferedAmount < 65536 && count++ < 8) { const next = m.queue.shift(); channel.send(next); m.bytes += next.length; }
      if (m.queue.length) m.pumpTimer = setTimeout(pump, 16);
    };
    channel.bufferedAmountLowThreshold = 16384; channel.onbufferedamountlow = pump;
    const receive = raw => {
      if (!alive() || typeof raw !== 'string' || raw.length > 33000) return;
      let p; try { p = JSON.parse(raw); } catch { return; }
      if (!Number.isInteger(p.k) || !Number.isInteger(p.n) || p.n < 1 || p.n > 1100 || !Number.isInteger(p.i) || p.i < 0 || p.i >= p.n || typeof p.d !== 'string' || p.d.length > 8000) return;
      if (!m.parts.has(p.k)) { if (m.parts.size > 16) { m.parts.clear(); return; } m.parts.set(p.k, { n: p.n, size: 0, got: 0, data: [] }); }
      const part = m.parts.get(p.k); if (part.n !== p.n || part.data[p.i] !== undefined) return;
      part.data[p.i] = p.d; part.size += p.d.length; part.got++;
      if (part.size > this.max) { m.parts.delete(p.k); return; }
      if (part.got === part.n) { m.parts.delete(p.k); try { const value = JSON.parse(part.data.join('')); if (value && typeof value === 'object') owner.host ? sourceMessage(value) : viewerMessage(value); } catch { /* malformed or expired update */ } }
    };
    channel.onmessage = e => receive(e.data);
    const sourceMessage = value => { if (value.t === 'rendered' && value.epoch === m.currentEpoch) m.rendered = true; if (value.t === 'ready') { m.ready = true; m.disabled = false; clearTimeout(m.fallbackTimer); if (owner.host) invalidate(); } };
    let invalidate = () => {}, viewerMessage = () => {};
    const menuActive = () => !owner.capture?.native && (Screens.currentName !== 'gameplay' || !GameplayScreen.s?.running || (typeof Overlays !== 'undefined' && !!Overlays.top()) || (typeof SkinEditor !== 'undefined' && SkinEditor.on));
    const state = () => { if (!alive() || m.disabled) return; m.active = !!menuActive(); m.observeActive?.(m.active && !m.paused); owner.capture?.setSuspended(m.active); };
    if (owner.host) {
      const ids = new WeakMap(), dirty = new Set(), urls = new Map(); let next = 0, assetId = 0, epoch = 0;
      const id = node => { if (!ids.has(node)) ids.set(node, ++next); return ids.get(node); };
      const eligible = node => node.nodeType === 3 || node.nodeType === 1 && (node === document.body || this.tags.has(node.localName.toLowerCase())) && !node.matches('.admin-view-sharing, .admin-view-wrap, #lz-cur, [data-admin-view-ignore], #loading-screen.done, #drop-overlay:not(.show)');
      const resource = url => {
        if (!url || url[0] === '#') return url || '';
        if (urls.has(url)) return urls.get(url);
        const token = 'mv:' + ++assetId; urls.set(url, token);
        // Asset reads are asynchronous and cached; no rasterization or computed style walk is needed.
        (async () => {
          try {
            const full = new URL(url, location.href); if (!['http:', 'https:', 'data:', 'blob:'].includes(full.protocol)) return;
            const blob = await (await fetch(full.href)).blob();
            if (!alive() || blob.size > 3 * 1024 * 1024 || !/^(image\/(png|jpeg|webp|gif|avif|svg\+xml|bmp)|font\/(woff2?|ttf|otf))$/i.test(blob.type)) return;
            const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            send({ t: 'asset', id: token, mime: blob.type, data: btoa(binary) });
          } catch { /* a missing public image keeps its placeholder */ }
        })();
        return token;
      };
      const attrs = node => {
        const a = {};
        for (const attr of node.attributes) if (this.attr(attr.name)) a[attr.name] = attr.name === 'style' ? this.css(attr.value, resource) : attr.value.slice(0, 16000);
        if (node.tagName === 'IMG') a.src = resource(node.currentSrc || node.src);
        if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') a.value = node.value;
        if (node.tagName === 'INPUT') { if (node.checked) a.checked = ''; else delete a.checked; }
        if (node.tagName === 'OPTION') { if (node.selected) a.selected = ''; else delete a.selected; }
        if (node.tagName === 'USE') { const href = node.getAttribute('href') || node.getAttribute('xlink:href'); if (href?.startsWith('#')) a.href = href; }
        return a;
      };
      let work = 0;
      const yieldWork = async check => {
        if (++work % 32) return;
        await new Promise(resolve => typeof requestIdleCallback === 'function' ? requestIdleCallback(resolve) : setTimeout(resolve, 0));
        if (!check()) throw new Error('Menu view changed.');
      };
      const serialize = async (node, check, depth = 0) => {
        if (!check() || depth > 64 || !eligible(node)) return null;
        await yieldWork(check);
        if (node.nodeType === 3) return { i: id(node), x: (node.nodeValue || '').slice(0, 32000) };
        if (node.matches('[data-private], input[type=password], .login-panel, .setup-step-account')) return null;
        const out = { i: id(node), t: node === document.body ? 'body' : ['CANVAS', 'VIDEO'].includes(node.tagName) ? 'img' : node.localName, a: attrs(node), c: [], sx: node.scrollLeft || 0, sy: node.scrollTop || 0 };
        if (['CANVAS', 'VIDEO'].includes(node.tagName)) { delete out.a.src; out.a['data-mv-canvas'] = String(out.i); }
        for (const child of node.childNodes) { const c = await serialize(child, check, depth + 1); if (c) out.c.push(c); }
        return out;
      };
      const blocked = () => m.paused || privateOpen();
      const flush = async () => {
        if (!alive() || m.disabled || m.busy || !m.ready || !m.active || blocked()) return;
        if (!m.reset && (m.queue.length > 32 || channel.bufferedAmount > 65536)) return;
        m.busy = true; const at = epoch, check = () => alive() && epoch === at && m.active && !blocked();
        try {
          if (dirty.has(document.body)) m.reset = true;
          const roots = m.reset ? [document.body] : [...dirty].filter(n => n.isConnected && ![...dirty].some(p => p !== n && p.nodeType === 1 && p.contains(n)));
          dirty.clear(); const reset = m.reset; m.reset = false;
          for (const node of roots) {
            const tree = await serialize(node, check); if (!tree || !check()) continue;
            send(reset ? { t: 'snapshot', epoch: at, tree, html: attrs(document.documentElement), w: innerWidth, h: innerHeight } : { t: 'patch', epoch: at, tree }, reset); m.updates++;
          }
        } catch (e) { m.error = e.message; if (alive()) m.reset = true; }
        finally { m.busy = false; }
      };
      invalidate = () => { epoch++; m.currentEpoch = epoch; m.rendered = false; canvasAt = new WeakMap(); state(); m.videoAt = owner.capture?.paintedFrames || 0; m.videoNotified = false; m.reset = true; dirty.clear(); send({ t: 'mode', active: m.active, blocked: blocked(), epoch }, true); };
      const observer = new MutationObserver(records => {
        if (!m.active || blocked()) return;
        for (const r of records) { const node = r.target; if (node.nodeType === 1 && node.closest('.admin-view-sharing, .admin-view-wrap, #lz-cur')) continue; if (node.parentElement?.closest('.admin-view-sharing, .admin-view-wrap, #lz-cur')) continue; dirty.add(node); }
      });
      m.observeActive = active => { if (m.observing === active) return; m.observing = active; if (active) observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'src', 'value', 'checked', 'selected', 'disabled'] }); else observer.disconnect(); };
      const scroll = e => { if (m.active && !blocked()) { const n = e.target === document ? document.scrollingElement : e.target; if (n?.nodeType === 1) send({ t: 'scroll', id: id(n), x: n.scrollLeft, y: n.scrollTop }); } };
      const input = e => { if (m.active && !blocked()) dirty.add(e.target); };
      const pointer = e => { m.pointer = { x: e.clientX, y: e.clientY, id: e.target?.nodeType === 1 ? id(e.target) : 0 }; };
      document.addEventListener('scroll', scroll, true); document.addEventListener('input', input, true); document.addEventListener('pointermove', pointer, { passive: true });
      const off = Bus.on('screen:changed', invalidate); window.addEventListener('resize', invalidate);
      let canvasAt = new WeakMap(); const canvasPending = new WeakSet();
      const canvases = () => {
        if (!m.ready || !m.rendered || !m.active || blocked() || m.queue.length > 16) return;
        for (const node of document.querySelectorAll('#app canvas, #app video')) {
          if (!ids.has(node) || canvasPending.has(node) || node.closest('[data-private]')) continue;
          const before = canvasAt.get(node), now = performance.now();
          if (before && (Screens.currentName === 'gameplay' && !(typeof SkinEditor !== 'undefined' && SkinEditor.on) || now - before < 500)) continue;
          const rect = node.getBoundingClientRect(); if (!rect.width || !rect.height || node.tagName === 'VIDEO' && node.readyState < 2) continue;
          const at = epoch, n = id(node), width = node.width || node.videoWidth, height = node.height || node.videoHeight;
          if (!width || !height) continue;
          canvasPending.add(node); canvasAt.set(node, now);
          try {
            const canvas = document.createElement('canvas'), scale = Math.min(1, 1024 / width, 768 / height);
            canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
            canvas.getContext('2d').drawImage(node, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(blob => {
              canvasPending.delete(node); if (!blob || !alive() || epoch !== at || blocked() || !m.active) return;
              const reader = new FileReader(); reader.onload = () => { if (alive() && epoch === at && !blocked() && m.active) send({ t: 'canvas', epoch: at, id: n, mime: blob.type, data: String(reader.result).split(',')[1] }); }; reader.readAsDataURL(blob);
            }, 'image/webp', .9);
          } catch { canvasPending.delete(node); }
        }
      };
      let lastState = '', lastPointer = '', lastCanvas = 0;
      m.timer = setInterval(() => {
        if (!alive()) return;
        const signature = `${Screens.currentName}/${!!GameplayScreen.s?.running}/${!!menuActive()}`;
        if (signature !== lastState) { lastState = signature; invalidate(); }
        flush();
        if (!m.active && !m.videoNotified && (owner.capture?.native ? owner.capture.ready : (owner.capture?.paintedFrames || 0) > m.videoAt && owner.capture?.liveFrameMode?.startsWith('gameplay/true'))) { m.videoNotified = true; send({ t: 'video', epoch }, true); }
        if (performance.now() - lastCanvas > 250) { lastCanvas = performance.now(); canvases(); }
        const p = JSON.stringify(m.pointer); if (m.active && !blocked() && p && p !== lastPointer) { lastPointer = p; send({ t: 'pointer', ...m.pointer }); }
      }, 33);
      m.setPaused = paused => { if (m.paused === paused) return; m.paused = paused; m.observeActive(m.active && !paused); epoch++; m.currentEpoch = epoch; m.rendered = false; canvasAt = new WeakMap(); m.queue.length = 0; m.reset = true; dirty.clear(); send({ t: 'mode', active: m.active, blocked: paused, epoch }, true); };
      m.cleanup = () => { observer.disconnect(); off(); window.removeEventListener('resize', invalidate); document.removeEventListener('scroll', scroll, true); document.removeEventListener('input', input, true); document.removeEventListener('pointermove', pointer); };
      channel.onopen = () => { state(); send({ t: 'hello' }); };
      m.fallbackTimer = setTimeout(() => { if (alive() && !m.ready) { m.disabled = true; m.observeActive(false); owner.capture?.setSuspended(false); } }, 5000); state();
    } else {
      const wrap = m.el = h('div.admin-view-menu', { hidden: true });
      const frame = m.iframe = h('iframe', { title: 'Live menu view', sandbox: 'allow-same-origin', tabindex: '-1', 'aria-hidden': 'true' });
      const cursor = m.cursor = h('div.admin-view-menu-cursor'); cursor.innerHTML = '<svg width=22 height=27 viewBox="-2 -2 24 29"><path d="M0 0V20L6 14L12 23L16 20L10 12H19Z" fill="white" stroke="#18171c" stroke-width="1.5"/></svg>'; wrap.append(frame, cursor); owner.video.parentElement.append(wrap);
      frame.srcdoc = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' blob: data:; font-src \'self\' blob: data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'"></head><body inert></body></html>';
      let doc, loaded = false, epoch = -1;
      const ruleCSS = rule => typeof rule.selectorText === 'string' ? rule.selectorText.replace(/:hover/g, '[data-mv-hover]') + '{' + rule.style.cssText + '}' : rule.cssRules ? rule.cssText.slice(0, rule.cssText.indexOf('{') + 1) + [...rule.cssRules].map(ruleCSS).join('\n') + '}' : rule.cssText;
      const css = [...document.querySelectorAll('style')].map(s => { try { return [...s.sheet.cssRules].map(ruleCSS).join('\n'); } catch { return s.textContent; } }).join('\n');
      m.canvasURLs = new Map();
      const resolve = token => token?.startsWith('#') ? token : m.assets.get(token) || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
      const setAttrs = (el, values) => {
        for (const a of [...el.attributes]) if (a.name !== 'inert') el.removeAttribute(a.name);
        for (const [name, value] of Object.entries(values || {})) {
          if (typeof value !== 'string' || value.length > 32000) continue;
          if (name === 'src' && el.tagName === 'IMG' && /^mv:\d+$/.test(value)) { el.dataset.mvResource = value; el.src = resolve(value); }
          else if (name === 'href' && value.startsWith('#') && el.namespaceURI === 'http://www.w3.org/2000/svg') el.setAttribute(name, value);
          else if (this.attr(name) && name !== 'src') {
            if (name === 'style') { el.dataset.mvStyle = value; el.style.cssText = this.css(value, token => /^mv:\d+$/.test(token) || token.startsWith('#') ? resolve(token) : ''); }
            else el.setAttribute(name, /^(fill|stroke)$/.test(name) ? this.css(value, token => token.startsWith('#') ? token : '') : value);
          }
        }
        if ('value' in (values || {}) && 'value' in el && !(el.tagName === 'INPUT' && el.type === 'file')) el.value = values.value;
      };
      const remove = el => { if (!el) return; for (const [id, node] of m.nodes) if (node === el || el.contains?.(node)) m.nodes.delete(id); };
      const pruneCanvases = () => { for (const [id, url] of m.canvasURLs) if (!m.nodes.has(id)) { URL.revokeObjectURL(url); m.canvasURLs.delete(id); } };
      let count = 0;
      const build = (n, depth = 0) => {
        if (!n || !Number.isInteger(n.i) || n.i < 1 || m.nodes.size >= 20000 || ++count > 20000 || depth > 64) return doc.createTextNode('');
        if (typeof n.x === 'string') { const text = doc.createTextNode(n.x.slice(0, 32000)); m.nodes.set(n.i, text); return text; }
        const tag = String(n.t || '').toLowerCase(); if (!this.tags.has(tag)) return doc.createTextNode('');
        if (tag === 'input' && String(n.a?.type).toLowerCase() === 'password') return doc.createTextNode('');
        const el = this.svg.has(tag) ? doc.createElementNS('http://www.w3.org/2000/svg', this.names[tag] || tag) : doc.createElement(tag === 'canvas' || tag === 'video' ? 'img' : tag);
        setAttrs(el, n.a); m.nodes.set(n.i, el);
        for (const child of (Array.isArray(n.c) ? n.c : []).slice(0, 20000)) el.append(build(child, depth + 1));
        if (el.tagName === 'IMG' && el.hasAttribute('data-mv-canvas') && m.canvasURLs.has(n.i)) el.src = m.canvasURLs.get(n.i);
        if (Number.isFinite(n.sx)) el.scrollLeft = n.sx; if (Number.isFinite(n.sy)) el.scrollTop = n.sy;
        return el;
      };
      const fit = () => {
        if (!m.width || !m.height) return;
        const scale = Math.min(wrap.clientWidth / m.width, wrap.clientHeight / m.height); m.scale = scale;
        const left = (wrap.clientWidth - m.width * scale) / 2, top = (wrap.clientHeight - m.height * scale) / 2;
        frame.style.cssText = `width:${m.width}px;height:${m.height}px;left:${left}px;top:${top}px;transform:scale(${scale})`;
        m.offsetX = left; m.offsetY = top;
      };
      const show = () => { const visible = loaded && m.hasSnapshot && ((m.active && m.snapshotEpoch === epoch) || m.holdMenu || m.keepMenu) && !m.paused && !owner.remotePaused; wrap.hidden = !visible; owner.video.style.visibility = visible || m.paused || owner.remotePaused ? 'hidden' : ''; fit(); };
      frame.onload = () => { doc = frame.contentDocument; const style = doc.createElement('style'); style.textContent = css; doc.head.append(style); loaded = true; send({ t: 'ready' }, true); };
      viewerMessage = v => {
        if (v.t === 'hello') { if (loaded) send({ t: 'ready' }, true); return; }
        if (v.t === 'mode') { const visible = !wrap.hidden; m.active = !!v.active; m.paused = !!v.blocked; epoch = v.epoch; m.epoch = epoch; m.holdMenu = m.active && visible; m.keepMenu = !m.active && visible; m.videoTime = owner.video.currentTime; show(); return; }
        if (v.t === 'video' && !m.active && v.epoch === epoch) {
          const reveal = () => { if (!alive() || m.active || m.paused || owner.remotePaused) return; if (owner.video.currentTime > m.videoTime) { m.keepMenu = false; show(); } else m.videoCheck = setTimeout(reveal, 33); }; reveal(); return;
        }
        if (v.t === 'asset' && /^mv:\d+$/.test(v.id) && typeof v.data === 'string' && v.data.length < 4500000 && /^(image\/(png|jpeg|webp|gif|avif|svg\+xml|bmp)|font\/(woff2?|ttf|otf))$/i.test(v.mime)) {
          if (m.assets.size > 512) return; const bytes = Uint8Array.from(atob(v.data), c => c.charCodeAt(0)), url = URL.createObjectURL(new Blob([bytes], { type: v.mime })); const before = m.assets.get(v.id); if (before) { URL.revokeObjectURL(before); m.objects.delete(before); } m.objects.add(url); m.assets.set(v.id, url);
          if (loaded) for (const el of doc.querySelectorAll('[data-mv-resource], [data-mv-style]')) { if (el.dataset.mvResource === v.id) el.src = url; if (el.dataset.mvStyle?.includes(v.id)) el.style.cssText = this.css(el.dataset.mvStyle, resolve); }
          return;
        }
        if (!loaded || v.epoch !== undefined && v.epoch !== epoch || m.paused || owner.remotePaused) return;
        if (v.t === 'canvas' && Number.isInteger(v.id) && typeof v.data === 'string' && v.data.length < 1500000 && /^image\/(png|jpeg|webp)$/.test(v.mime)) { const el = m.nodes.get(v.id); if (el?.tagName === 'IMG' && el.hasAttribute('data-mv-canvas')) { const bytes = Uint8Array.from(atob(v.data), c => c.charCodeAt(0)), url = URL.createObjectURL(new Blob([bytes], { type: v.mime })); const before = m.canvasURLs.get(v.id); if (before) URL.revokeObjectURL(before); m.canvasURLs.set(v.id, url); el.src = url; } return; }
        if (v.t === 'snapshot' && v.tree?.t === 'body' && Number.isFinite(v.w) && v.w > 0 && v.w <= 10000 && Number.isFinite(v.h) && v.h > 0 && v.h <= 10000) {
          m.nodes.clear(); count = 0; setAttrs(doc.documentElement, v.html); setAttrs(doc.body, v.tree.a); doc.body.inert = true; doc.body.replaceChildren(); m.nodes.set(v.tree.i, doc.body);
          for (const child of v.tree.c || []) doc.body.append(build(child)); pruneCanvases(); m.width = v.w; m.height = v.h; m.hasSnapshot = true; m.snapshotEpoch = epoch; m.holdMenu = false; m.keepMenu = false; m.active = true; m.updates++; show(); send({ t: 'rendered', epoch });
        } else if (v.t === 'patch') {
          const old = m.nodes.get(v.tree?.i); if (!old) return;
          remove(old); count = 0; old.replaceWith(build(v.tree)); pruneCanvases(); m.updates++;
        } else if (v.t === 'scroll') { const el = m.nodes.get(v.id); if (el && Number.isFinite(v.x) && Number.isFinite(v.y)) { el.scrollLeft = v.x; el.scrollTop = v.y; } }
        else if (v.t === 'pointer' && Number.isFinite(v.x) && Number.isFinite(v.y)) { cursor.style.transform = `translate(${m.offsetX + v.x * m.scale}px,${m.offsetY + v.y * m.scale}px)`;
          for (const el of m.hover || []) el.removeAttribute('data-mv-hover'); m.hover = [];
          let el = m.nodes.get(v.id); while (el?.nodeType === 1 && el !== doc.body) { el.setAttribute('data-mv-hover', ''); m.hover.push(el); el = el.parentElement; } }
      };
      const resize = new ResizeObserver(fit); resize.observe(wrap); m.cleanup = () => { resize.disconnect(); wrap.remove(); owner.video.style.visibility = ''; };
      m.setPaused = paused => { m.paused = paused; show(); if (!paused) send({ t: 'ready' }, true); };
      channel.onopen = () => { if (loaded) send({ t: 'ready' }, true); };
    }
    channel.onclose = () => { if (alive()) { m.active = false; m.disabled = true; m.observeActive?.(false); owner.capture?.setSuspended(false); if (m.el) { m.el.hidden = true; owner.video.style.visibility = ''; } } };
    m.stop = () => { m.stopped = true; clearInterval(m.timer); clearTimeout(m.pumpTimer); clearTimeout(m.fallbackTimer); clearTimeout(m.videoCheck); m.cleanup?.(); m.queue.length = 0; m.parts.clear(); for (const url of m.objects) URL.revokeObjectURL(url); for (const url of m.canvasURLs?.values() || []) URL.revokeObjectURL(url); channel.close(); };
    return m;
  },
};
