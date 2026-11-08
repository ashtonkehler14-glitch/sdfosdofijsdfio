/* Profile cosmetics are player-owned. Community tags come only from the server's admin tools. */
const ProfileAppearance = {
  presets: [
    { id: 'signature', name: 'Signature', desc: 'The original mania look', accent: '#ff83b9', bg: 'linear-gradient(125deg, #75416d, #271d37 80%)' },
    { id: 'midnight', name: 'Midnight', desc: 'Deep violet · quiet glow', accent: '#b8a1ff', bg: 'radial-gradient(ellipse at 75% 0%, #6652ac, transparent 65%), linear-gradient(135deg, #17162e, #30234d)' },
    { id: 'aurora', name: 'Aurora', desc: 'Emerald · northern light', accent: '#72e4c1', bg: 'radial-gradient(ellipse at 80% 0%, #318d82, transparent 65%), linear-gradient(125deg, #132f38, #172638)' },
    { id: 'ember', name: 'Ember', desc: 'Copper · warm afterglow', accent: '#ffb07c', bg: 'radial-gradient(ellipse at 90% 0%, #a25242, transparent 70%), linear-gradient(125deg, #3c242b, #261c2b)' },
    { id: 'sakura', name: 'Sakura', desc: 'Rose · soft bloom', accent: '#ffb1d2', bg: 'radial-gradient(ellipse at 80% 0%, #a96389, transparent 70%), linear-gradient(125deg, #482b46, #282137)' },
    { id: 'glacier', name: 'Glacier', desc: 'Ice blue · crisp contrast', accent: '#91d8ff', bg: 'radial-gradient(ellipse at 80% 0%, #3b7595, transparent 70%), linear-gradient(125deg, #1d3047, #192132)' },
  ],
  clean(a) {
    a = a && typeof a === 'object' ? a : {};
    return { style: this.presets.some(p => p.id === a.style) ? a.style : 'signature',
      banner: typeof a.banner === 'string' && a.banner.length <= 48000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a.banner) ? a.banner : '',
      position: Number.isFinite(a.position) ? clamp(a.position, 0, 100) : 50,
      bio: typeof a.bio === 'string' ? a.bio.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) : '' };
  },
  paint(el, appearance) {
    const a = this.clean(appearance), p = this.presets.find(p => p.id === a.style);
    el.dataset.profileStyle = a.style;
    el.style.setProperty('--pf-accent', p.accent);
    el.style.setProperty('--pf-gradient', p.bg);
    return a;
  },
  tags(list) {
    return (Array.isArray(list) ? list : []).slice(0, 3).filter(t => t && typeof t.name === 'string' && t.name.trim()).map(t => {
      const colour = /^#[0-9a-f]{6}$/i.test(t.colour) ? t.colour : '#b8a1ff';
      return h('span.pf-community-tag', { title: 'Community tag · assigned by an admin', style: { '--tag-colour': colour } }, h('span.pf-tag-dot'), t.name.slice(0, 24));
    });
  },
  async packBanner(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('This image could not be opened.');
      // Preserve a little height for the focal-position control. Flatten uploads to a safe, compact raster image.
      for (const width of [1440, 1200, 960, 720]) {
        const ratio = Math.min(1, width / img.naturalWidth, 900 / img.naturalHeight);
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * ratio)); c.height = Math.max(1, Math.round(img.naturalHeight * ratio));
        const ctx = c.getContext('2d'); ctx.fillStyle = '#1b1729'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        for (const q of [0.86, 0.7, 0.5, 0.35]) { const data = c.toDataURL('image/webp', q); if (data.length <= 48000 && /^data:image\/(webp|png|jpeg);/.test(data)) return data; }
      }
      throw new Error('This image is too detailed to fit. Try a smaller or simpler image.');
    } catch (e) { throw new Error(e && e.message || 'This image could not be opened.'); }
    finally { URL.revokeObjectURL(url); }
  },
  open() {
    if (this.o) return;
    const draft = this.clean(ProfileManager.profile.appearance);
    let busy = false, closed = false, uploadSeq = 0;
    const previewCover = h('div.pa-preview-cover'), previewBio = h('p.pa-preview-bio'), styleName = h('span.pa-style-name');
    const preview = h('div.pa-preview', previewCover, h('div.pa-preview-inner', h('span.pa-preview-label', 'LIVE PREVIEW'),
      ProfileManager.avatarEl(76), h('h3', ProfileManager.profile.name), h('div.pa-preview-tags', ...this.tags(ProfileScreen.ownTags)), previewBio));
    const status = h('p.pa-status', { role: 'status', 'aria-live': 'polite' });
    const counter = h('span.pa-counter');
    const bio = h('textarea.input.pa-bio', { id: 'pa-bio', maxlength: 160, rows: 3, placeholder: 'A little about you…', value: draft.bio });
    bio.value = draft.bio;
    const position = h('input.slider', { id: 'pa-position', type: 'range', min: 0, max: 100, step: 1, value: draft.position, 'aria-label': 'Banner vertical position' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, 'aria-label': 'Upload profile banner' });
    const remove = h('button.btn.sm', { type: 'button', onclick: () => { uploadSeq++; draft.banner = ''; draft.position = 50; position.value = 50; busy = false; save.disabled = false; status.textContent = 'Banner removed from preview. Save to apply.'; paint(); } }, icon('x'), 'Remove');
    const upload = h('button.btn.sm', { type: 'button', onclick: () => file.click() }, icon('upload'), 'Upload banner');
    const tiles = this.presets.map(p => h('button.pa-preset', { type: 'button', dataset: { style: p.id }, style: { '--tile-bg': p.bg, '--tile-accent': p.accent }, 'aria-label': p.name + ' profile style', onclick: () => { draft.style = p.id; paint(); } },
      h('span.pa-preset-art', h('span.pa-preset-check', icon('check'))), h('b', p.name), h('small', p.desc)));
    const paint = () => {
      this.paint(preview, draft); previewCover.style.backgroundImage = draft.banner ? `url("${draft.banner}")` : '';
      previewCover.style.backgroundPosition = `center ${draft.position}%`;
      previewBio.textContent = draft.bio || 'Your next chapter starts here.'; previewBio.classList.toggle('placeholder', !draft.bio);
      styleName.textContent = this.presets.find(p => p.id === draft.style).name;
      counter.textContent = `${bio.value.length} / 160`; position.disabled = !draft.banner; remove.disabled = !draft.banner;
      for (const t of tiles) { const selected = t.dataset.style === draft.style; t.classList.toggle('selected', selected); t.setAttribute('aria-pressed', String(selected)); }
    };
    bio.addEventListener('input', () => { draft.bio = bio.value; paint(); });
    position.addEventListener('input', () => { draft.position = +position.value; paint(); });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = ''; if (!f) return;
      const seq = ++uploadSeq; busy = true; save.disabled = true; status.textContent = 'Preparing your banner…';
      try { const banner = await this.packBanner(f); if (closed || seq !== uploadSeq) return; draft.banner = banner; status.textContent = 'Banner ready. Adjust its position below.'; paint(); }
      catch (e) { if (!closed && seq === uploadSeq) status.textContent = e.message; }
      finally { if (!closed && seq === uploadSeq) { busy = false; save.disabled = false; } }
    });
    const save = h('button.btn.primary', { type: 'button', onclick: async () => {
      if (busy) return; busy = true; save.disabled = true;
      const before = ProfileManager.profile.appearance;
      try {
        ProfileManager.profile.appearance = this.clean(draft); await ProfileManager.save();
        // Send immediately as well as through the normal profile-change debounce.
        if (typeof Rankings !== 'undefined') Rankings.report();
        if (!closed) this.o?.close(); Toast.ok('Profile updated');
      } catch { ProfileManager.profile.appearance = before; status.textContent = 'Could not save your profile. Please try again.'; busy = false; save.disabled = false; }
    } }, icon('check'), 'Save changes');
    const panel = h('div.pa-editor', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Customize profile' },
      h('div.pa-head', h('div', h('span.pa-eyebrow', 'MAKE IT YOURS'), h('h2', 'Customize profile'), h('p', 'Your style, wherever you play.')), h('button.icon-btn', { 'aria-label': 'Close profile editor', onclick: () => this.o.close() }, icon('x'))),
      h('div.pa-body', h('aside.pa-preview-side', preview, h('div.pa-preview-caption', icon('brush'), styleName, h('span', 'Only you can edit your profile.'))),
        h('div.pa-controls', h('section.pa-section', h('h3', 'Choose your style'), h('p', 'A coordinated colour palette for your profile.'), h('div.pa-presets', ...tiles)),
          h('section.pa-section', h('div.pa-section-title', h('h3', 'Profile banner'), h('span.pa-optional', 'Optional')), h('p', 'PNG, JPEG or WebP · up to 10 MB. Wide images work best.'), h('div.pa-upload', upload, remove, file),
            h('label.pa-label', { for: 'pa-position' }, 'Banner position'), position),
          h('section.pa-section', h('div.pa-section-title', h('label', { for: 'pa-bio' }, 'About you'), counter), bio), status)),
      h('div.pa-foot', h('span', 'Preview changes before saving.'), h('button.btn.ghost', { onclick: () => this.o.close() }, 'Cancel'), save));
    this.o = makeOverlay(panel, { cls: 'pa-wrap', onKey: e => {
      if (e.key !== 'Tab') return false;
      const controls = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled):not([type=file]), textarea:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); return true; }
      if (!e.shiftKey && document.activeElement === last) { first.focus(); return true; }
      return false;
    }, onClose: () => { closed = true; uploadSeq++; this.o = null; } });
    paint(); requestAnimationFrame(() => tiles.find(t => t.dataset.style === draft.style)?.focus());
  },
};
