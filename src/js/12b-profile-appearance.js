/* Profile appearance uses the same overlay colours, title bars and controls as the game's menus. */
const ProfileAppearance = {
  presets: [
    { id: 'signature', name: 'Signature', desc: 'osu!mania', accent: '#ff66aa', hue: 333, mark: '4K' },
    { id: 'midnight', name: 'Midnight', desc: 'After dark', accent: '#aa88ff', hue: 255, mark: 'DT' },
    { id: 'aurora', name: 'Aurora', desc: 'Find your flow', accent: '#72e4c1', hue: 160, mark: 'SV' },
    { id: 'ember', name: 'Ember', desc: 'Keep the combo', accent: '#ffad70', hue: 24, mark: 'FC' },
    { id: 'sakura', name: 'Sakura', desc: 'Full bloom', accent: '#ff9bcc', hue: 320, mark: 'SS' },
    { id: 'glacier', name: 'Glacier', desc: 'Perfect timing', accent: '#80d5ff', hue: 200, mark: 'MAX' },
    { id: 'miku', name: 'Miku', desc: 'Hatsune Miku', accent: '#39c5bb', hue: 176, character: 'miku', art: 'profile-art/miku.png', mark: '01' },
    { id: 'neru', name: 'Neru', desc: 'Akita Neru', accent: '#ffcf3a', hue: 45, character: 'neru', art: 'neru.png', mark: '02' },
    { id: 'teto', name: 'Teto', desc: 'Kasane Teto', accent: '#ff4d6a', hue: 350, character: 'teto', art: 'profile-art/teto.png', mark: '04' },
  ],
  clean(a) {
    a = a && typeof a === 'object' ? a : {};
    const style = this.presets.some(p => p.id === a.style) ? a.style : 'signature';
    const banner = typeof a.banner === 'string' && a.banner.length <= 48000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a.banner) ? a.banner : '';
    const song = a.song && typeof a.song === 'object' ? a.song : {};
    return { style, banner,
      background: ['best', 'song', 'upload'].includes(a.background) ? a.background : banner ? 'upload' : 'best',
      song: { hash: typeof song.hash === 'string' && /^[a-f0-9]{32,64}$/i.test(song.hash) ? song.hash : '',
        sid: Number.isSafeInteger(song.sid) && song.sid > 0 && song.sid <= 2147483647 ? song.sid : 0,
        title: typeof song.title === 'string' ? song.title.trim().slice(0, 100) : '', artist: typeof song.artist === 'string' ? song.artist.trim().slice(0, 80) : '' },
      position: Number.isFinite(a.position) ? clamp(a.position, 0, 100) : 50,
      bio: typeof a.bio === 'string' ? a.bio.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) : '' };
  },
  paint(el, appearance) {
    const a = this.clean(appearance), p = this.presets.find(p => p.id === a.style);
    el.dataset.profileStyle = a.style; el.dataset.background = a.background; el.classList.add('ov'); el.style.setProperty('--o-h', p.hue);
    el.style.setProperty('--pf-accent', p.accent); el.style.setProperty('--pf-hue', p.hue);
    el.style.setProperty('--pf-gradient', `linear-gradient(115deg, hsl(${p.hue} 32% 23%), hsl(${p.hue} 24% 12%))`);
    return a;
  },
  /** One resolver for the actual profile and the preview. Ignore a stale image when the source changes. */
  async cover(el, appearance, { best = null, own = true } = {}) {
    const a = this.clean(appearance), token = {};
    el._profileCoverToken = token; el.dataset.coverKind = 'preset'; el.style.backgroundImage = ''; el.style.backgroundSize = ''; el.style.backgroundRepeat = '';
    el.style.backgroundPosition = `center ${a.position}%`;
    const put = url => { if (url && el._profileCoverToken === token) { el.style.backgroundImage = `url("${url}")`; el.style.backgroundSize = 'cover'; el.style.backgroundRepeat = 'no-repeat'; el.dataset.coverKind = 'image'; } };
    if (a.background === 'upload') { put(a.banner); return; }
    if (a.background === 'song') {
      // The compact snapshot makes locally imported song artwork visible on other devices too.
      if (a.banner) { put(a.banner); return; }
      const map = own && a.song.hash && BeatmapManager.mapByHash(a.song.hash);
      if (map) { try { const url = await BeatmapManager.bgURL(map); if (url) { put(url); return; } } catch { /* online cover below */ } }
      if (a.song.sid) put(OnlineBeatmaps.coverURL(a.song.sid, 'cover@2x'));
      return;
    }
    const play = best && (best._s || best);
    const map = play && BeatmapManager.mapByHash(play.mapHash || play.key);
    const set = map && BeatmapManager.setById.get(map.setId);
    if (map) { try { const url = await BeatmapManager.bgURL(map); if (url) { put(url); return; } } catch { /* online cover below */ } }
    const sid = (set && set.onlineId > 0 && set.onlineId) || (play && play.onlineSetId > 0 && play.onlineSetId);
    if (sid) put(OnlineBeatmaps.coverURL(sid, 'cover@2x'));
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
    const draft = this.clean(ProfileManager.profile.appearance), stats = ProfileScreen.localData();
    const best = ProfileScreen.coverPlay || stats.top[0] || stats.recent[0];
    let busy = false, saving = false, closed = false, uploadSeq = 0;
    const previewCover = h('div.pa-preview-cover'), previewBio = h('p.pa-preview-bio'), styleName = h('span.pa-style-name');
    const preview = h('div.pa-preview', previewCover,
      h('div.pa-preview-inner', ProfileManager.avatarEl(84), h('div.pa-preview-id', h('h3', ProfileManager.profile.name),
        h('div.pa-preview-tags', ...this.tags(ProfileScreen.ownTags), h('span.pf-tag', 'osu!mania')), previewBio)),
      h('div.pa-preview-stats', h('div', h('span', 'Performance'), h('b', `${Math.round(stats.pp || 0).toLocaleString()}pp`)),
        h('div', h('span', 'Accuracy'), h('b', `${((stats.avgAcc || 0) * 100).toFixed(2)}%`)), h('div', h('span', 'Level'), h('b', String(stats.level || 1)))));
    const status = h('p.pa-status', { role: 'status', 'aria-live': 'polite' });
    const counter = h('span.pa-counter'), bio = h('textarea.input.pa-bio', { id: 'pa-bio', maxlength: 160, rows: 3, placeholder: 'A little about you…' }); bio.value = draft.bio;
    const position = h('input.slider', { id: 'pa-position', type: 'range', min: 0, max: 100, step: 1, value: draft.position, 'aria-label': 'Banner vertical position' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, 'aria-label': 'Upload profile banner' });
    const upload = h('button.btn.sm', { type: 'button', onclick: () => file.click() }, icon('upload'), 'Upload banner');
    const remove = h('button.btn.sm', { type: 'button', onclick: () => {
      if (saving) return; uploadSeq++; draft.banner = ''; draft.background = 'best'; draft.position = 50; position.value = 50; busy = false; save.disabled = false;
      status.textContent = 'Best play background restored in preview. Save to apply.'; paint();
    } }, icon('retry'), 'Use best play instead');
    const tiles = this.presets.map(p => h('button.pa-preset', { type: 'button', dataset: { style: p.id }, style: { '--tile-hue': p.hue, '--tile-accent': p.accent },
      'aria-label': p.name + ' profile style', onclick: () => { if (saving) return; draft.style = p.id; paint(); } },
      h('span.pa-preset-art', h('span.pa-preset-mark', p.mark), p.character ? h('img.pa-character', { src: Host.asset(p.art), alt: '' }) : h('span.pa-note-lanes', ...[0, 1, 2, 3].map(i => h('i', { style: { '--lane': i } }))), h('span.pa-preset-check', icon('check'))),
      h('span.pa-preset-name', h('b', p.name), h('small', p.desc))));
    const sourceNames = { best: 'Best play background', song: 'Selected song background', upload: 'Uploaded banner' };
    const sources = Object.entries(sourceNames).map(([value, label]) => h('button.pa-source', { type: 'button', dataset: { source: value }, 'aria-label': label,
      onclick: () => { if (saving) return; uploadSeq++; busy = false; save.disabled = false; draft.background = value; status.textContent = ''; paint(); } }, icon({ best: 'trophy', song: 'music', upload: 'upload' }[value]), h('span', label), h('span.pa-source-check', icon('check'))));
    const search = h('input.input', { type: 'search', placeholder: 'Search your songs…', 'aria-label': 'Search profile background songs' });
    const songs = h('div.pa-song-list'), pickedSong = h('div.pa-picked-song');
    const songBox = h('div.pa-song-picker', pickedSong, search, songs);
    const imageBox = h('div.pa-upload-box', h('p', 'PNG, JPEG or WebP · up to 10 MB.'), h('div.pa-upload', upload, remove, file));
    const bestHint = h('p.pa-best-hint', best ? `Uses your best performance: ${best.title || (best._s && best._s.title) || 'your top play'}. Updates when you set a new best.` : 'Your best play’s background will appear here once you have a score. Until then, the theme’s colours are shown.');
    const drawSongs = () => {
      const query = search.value.trim().toLowerCase();
      const sets = BeatmapManager.sets.filter(s => !query || `${s.title} ${s.artist}`.toLowerCase().includes(query)).slice(0, 12);
      clearEl(songs);
      for (const set of sets) {
        const map = (set.maps && set.maps[0]) || (set.mapIds && BeatmapManager.maps.get(set.mapIds[0]));
        if (!map) continue;
        const art = h('span.pa-song-art'), selected = draft.background === 'song' && draft.song.hash === map.hash;
        const row = h(`button.pa-song${selected ? '.selected' : ''}`, { type: 'button', dataset: { hash: map.hash }, 'aria-label': `Use ${set.title} as profile background`, 'aria-pressed': String(selected), onclick: async () => {
          if (saving) return;
          const seq = ++uploadSeq; busy = true; save.disabled = true; status.textContent = 'Preparing song background…';
          try {
            let snapshot = ''; const url = await BeatmapManager.bgURL(map).catch(() => null);
            if (url) { const blob = await (await fetch(url)).blob(); snapshot = await this.packBanner(new File([blob], 'background', { type: blob.type || 'image/jpeg' })); }
            if (!snapshot && !(set.onlineId > 0)) throw new Error('This song has no background. Choose another song.');
            if (closed || seq !== uploadSeq) return;
            draft.song = { hash: map.hash, sid: set.onlineId > 0 ? set.onlineId : 0, title: set.title, artist: set.artist };
            draft.banner = snapshot; draft.background = 'song'; status.textContent = 'Song background ready.'; paint(); drawSongs();
          } catch (e) { if (!closed && seq === uploadSeq) status.textContent = e.message || 'Could not load this background.'; }
          finally { if (!closed && seq === uploadSeq) { busy = false; save.disabled = false; } }
        } }, art, h('span', h('b', set.title || 'Untitled'), h('small', set.artist || 'Unknown artist')), selected ? icon('check') : null);
        songs.append(row);
        BeatmapManager.bgURL(map).then(url => { if (url) art.style.backgroundImage = `url("${url}")`; else if (set.onlineId > 0) art.style.backgroundImage = `url("${OnlineBeatmaps.coverURL(set.onlineId, 'list')}")`; }).catch(() => {});
      }
      if (!songs.children.length) songs.append(h('p.pa-empty', BeatmapManager.sets.length ? 'No songs match your search.' : 'Import a beatmap to choose its background.'));
    };
    search.addEventListener('input', drawSongs);
    const paint = () => {
      this.paint(panel, draft); this.paint(preview, draft); this.cover(previewCover, draft, { best });
      previewBio.textContent = draft.bio; previewBio.hidden = !draft.bio;
      styleName.textContent = `${this.presets.find(p => p.id === draft.style).name} · ${sourceNames[draft.background]}`;
      counter.textContent = `${bio.value.length} / 160`;
      position.disabled = draft.background === 'upload' && !draft.banner; remove.disabled = !draft.banner;
      songBox.hidden = draft.background !== 'song'; imageBox.hidden = draft.background !== 'upload'; bestHint.hidden = draft.background !== 'best';
      pickedSong.textContent = draft.song.title ? `Selected: ${draft.song.artist ? draft.song.artist + ' — ' : ''}${draft.song.title}` : 'Choose a song from your library.';
      for (const t of tiles) { const selected = t.dataset.style === draft.style; t.classList.toggle('selected', selected); t.setAttribute('aria-pressed', String(selected)); }
      for (const t of sources) { const selected = t.dataset.source === draft.background; t.classList.toggle('selected', selected); t.setAttribute('aria-pressed', String(selected)); }
    };
    bio.addEventListener('input', () => { draft.bio = bio.value; previewBio.textContent = draft.bio; previewBio.hidden = !draft.bio; counter.textContent = `${bio.value.length} / 160`; });
    position.addEventListener('input', () => { draft.position = +position.value; previewCover.style.backgroundPosition = `center ${draft.position}%`; });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = ''; if (!f || saving) return;
      const seq = ++uploadSeq; busy = true; save.disabled = true; status.textContent = 'Preparing your banner…';
      try { const banner = await this.packBanner(f); if (closed || seq !== uploadSeq) return; draft.banner = banner; draft.background = 'upload'; status.textContent = 'Banner ready. Adjust its position below.'; paint(); }
      catch (e) { if (!closed && seq === uploadSeq) status.textContent = e.message; }
      finally { if (!closed && seq === uploadSeq) { busy = false; save.disabled = false; } }
    });
    const save = h('button.btn.primary', { type: 'button', onclick: async () => {
      if (busy) return;
      if (draft.background === 'upload' && !draft.banner) { status.textContent = 'Upload a banner or choose another background source.'; return; }
      if (draft.background === 'song' && !draft.song.hash && !draft.song.sid) { status.textContent = 'Choose a song first.'; search.focus(); return; }
      saving = true; busy = true; save.disabled = true;
      const before = ProfileManager.profile.appearance;
      try {
        ProfileManager.profile.appearance = this.clean(draft); await ProfileManager.save();
        if (typeof Rankings !== 'undefined') Rankings.report();
        if (!closed) this.o?.close(); Toast.ok('Profile updated');
      } catch { ProfileManager.profile.appearance = before; status.textContent = 'Could not save your profile. Please try again.'; saving = false; busy = false; save.disabled = false; }
    } }, icon('check'), 'Save changes');
    const close = h('button.icon-btn', { 'aria-label': 'Close profile editor', onclick: () => this.o.close() }, icon('x'));
    const panel = h('div.pa-editor.ov', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Customize profile', style: { '--o-h': 333 } },
      overlayHeader('customize profile', { icon: 'brush', actions: [close] }),
      h('div.pa-body', h('aside.pa-preview-side', h('h2.pa-section-heading', 'profile preview'), preview, h('div.pa-preview-caption', icon('brush'), styleName)),
        h('div.pa-controls', h('section.pa-section', h('h2.pa-section-heading', 'theme'), h('p', 'Change the profile’s colours and mood. Your background stays the same.'), h('div.pa-presets', ...tiles)),
          h('section.pa-section', h('h2.pa-section-heading', 'background'), h('div.pa-sources', ...sources), bestHint, songBox, imageBox,
            h('div.set-row.form.frange.pa-position-row', h('div.fleft', h('label', { for: 'pa-position' }, 'Background position')), h('div.fright', position))),
          h('section.pa-section', h('div.pa-section-title', h('label.pa-section-heading', { for: 'pa-bio' }, 'about you'), counter), bio), status)),
      h('div.pa-foot', h('span', 'Changes are only applied when you save.'), h('button.btn.ghost', { onclick: () => this.o.close() }, 'Cancel'), save));
    this.o = makeOverlay(panel, { cls: 'pa-wrap', onKey: e => {
      if (e.key !== 'Tab') return false;
      const controls = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled):not([type=file]), textarea:not(:disabled)')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); return true; }
      if (!e.shiftKey && document.activeElement === last) { first.focus(); return true; }
      return false;
    }, onClose: () => { closed = true; uploadSeq++; this.o = null; } });
    paint(); drawSongs(); requestAnimationFrame(() => tiles.find(t => t.dataset.style === draft.style)?.focus());
  },
};
