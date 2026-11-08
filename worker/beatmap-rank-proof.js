// A legacy score's SHA-256 must match an actual downloadable difficulty. IDs and titles are discovery hints only.
import { beatmapListing, beatmapSetInfo, lookupExactBeatmap } from './index.js';
import { md5Hex } from './verify-bundle.js';
export const PROOF_VERSION = 1;
const missing = () => ({ version: PROOF_VERSION, listed: false, status: 'missing', checked: Date.now() });
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

export async function resolveRankProof(hash, hint, env, { stored = null, fetchImpl = fetch, lookup = lookupExactBeatmap,
  search = beatmapListing, setInfo = beatmapSetInfo } = {}) {
  if (!/^[a-f0-9]{64}$/.test(hash || '')) return missing();
  if (stored?.version === PROOF_VERSION && Date.now() - stored.checked < 7 * 86400000) return stored;
  const check = async (checksum, setId) => {
    try {
      const b = await lookup(checksum, env, fetchImpl, setId);
      return { version: PROOF_VERSION, listed: true, checksum, beatmapId: b.id, setId: b.beatmapset_id || b.beatmapset?.id || setId || 0,
        status: String(b.beatmapset?.status || b.status || 'unknown').toLowerCase(), checked: Date.now() };
    } catch (e) { return e?.status === 404 ? missing() : null; }
  };
  // This proof was made from file bytes by the server, never from a profile's claimed checksum.
  if (/^[a-f0-9]{32}$/.test(stored?.checksum || '')) return check(stored.checksum, stored.setId);
  let candidates = [], sid = Number(hint?.onlineSetId || hint?.sid) || 0;
  try {
    const id = Number(hint?.onlineId || hint?.beatmapId) || 0;
    if (id > 0) candidates = [{ id }];
    else if (sid > 0) { const set = await setInfo(sid, env, fetchImpl); candidates = set.beatmaps || set.ChildrenBeatmaps || []; }
    else if (hint?.title) {
      const d = await search(new URLSearchParams({ q: `${hint.artist || ''} ${hint.title}`.trim().slice(0, 200), m: '3', s: 'any' }), env, fetchImpl);
      const sets = Array.isArray(d) ? d : d?.beatmapsets || [];
      candidates = sets.flatMap(s => (s.beatmaps || s.ChildrenBeatmaps || []).map(m => ({ ...m, sid: s.id || s.SetID })));
    }
    if (!candidates.length) return missing();
    // A set containing many difficulties can be narrowed by version, never granted credit by that name alone.
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const named = candidates.filter(m => same(m.version || m.DiffName, hint?.version));
    if (named.length) candidates = named;
    if (candidates.length > 32) return null;
    let unavailable = false;
    for (const m of candidates) {
      const id = Number(m.id || m.BeatmapID);
      if (!(id > 0)) continue;
      let bytes = null, absent = 0;
      for (const url of [`https://osu.ppy.sh/osu/${id}`, `https://catboy.best/osu/${id}`]) {
        try {
          const r = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
          if (r.status === 404) { absent++; continue; }
          if (!r.ok || Number(r.headers.get('content-length')) > 5e6) continue;
          const b = new Uint8Array(await r.arrayBuffer());
          if (b.length > 5e6 || !/^\s*osu file format/.test(new TextDecoder().decode(b.subarray(0, 100)))) continue;
          bytes = b; break;
        } catch { /* next source */ }
      }
      if (!bytes) { if (absent < 2) unavailable = true; continue; }
      if (await digest(bytes) === hash) return check(md5Hex(bytes), Number(m.sid || m.beatmapset_id) || sid);
    }
    return unavailable ? null : missing();
  } catch (e) { return e?.status === 404 ? missing() : null; }
}
