/* Stream quality is expendable. The player's configured frame limit and display cadence are not. */
class GameViewBudget {
  static TIERS = [
    { fps: 30, width: 1280, bitrate: 2500000, snapshot: 6000 },
    { fps: 30, width: 1280, bitrate: 3000000, snapshot: 4000 },
    { fps: 30, width: 1600, bitrate: 3500000, snapshot: 3000 },
    { fps: 30, width: 1600, bitrate: 4000000, snapshot: 2200 },
    { fps: 30, width: 1920, bitrate: 5000000, snapshot: 1500 },
    { fps: 30, width: 1920, bitrate: 6000000, snapshot: 1000 },
  ];
  constructor() {
    this.level = 5; this.displayMs = 1000 / 60; this.targetMs = this.displayMs;
    this.work = 0; this.paintCost = .4; this.last = 0; this.lastDraw = 0; this.window = 0;
    this.frames = 0; this.late = 0; this.healthy = 0; this.blockedUntil = 0; this.lastPaint = -Infinity;
    this.slices = []; this.encoderPressureUntil = 0; this.changed = false;
  }
  get quality() { return GameViewBudget.TIERS[this.level]; }
  begin(ts) { this.frameStart = ts; }
  sample(ts, work, limit = 0, drawn = true) {
    const dt = ts - this.last;
    if (this.last && dt > 1 && dt < 100) {
      this.slices.push(dt); if (this.slices.length > 120) this.slices.shift();
      // Keep the best observed display cadence: a missed frame must not lower the player's FPS goal.
      if (this.slices.length >= 16 && ts - (this.cadenceAt || 0) >= 500) {
        this.cadenceAt = ts;
        const sorted = [...this.slices].sort((a, b) => a - b);
        this.displayMs = Math.min(this.displayMs, sorted[Math.floor(sorted.length * .2)]);
      }
    }
    this.last = ts;
    this.targetMs = Math.max(this.displayMs, limit > 0 ? 1000 / limit : this.displayMs);
    this.work += (Math.max(0, work) - this.work) * .15;
    if (drawn) {
      if (this.lastDraw && ts - this.lastDraw < 250) {
        this.frames++;
        if (ts - this.lastDraw > this.targetMs + Math.max(this.targetMs * .25, this.displayMs * .75)) this.late++;
      }
      this.lastDraw = ts;
    }
    if (!this.window) this.window = ts;
    if (ts - this.window < 750) return;
    const missed = this.frames ? this.late / this.frames : 0;
    const busy = this.work > this.displayMs * .65 || missed > .06 || ts < this.encoderPressureUntil;
    if (busy) {
      this.lower(ts, missed > .2 || this.work > this.displayMs * .85 ? 2 : 1);
      this.healthy = 0;
    } else if (missed < .02 && this.work < this.displayMs * .45) {
      this.healthy += ts - this.window;
      if (this.healthy >= 6000 && this.level < GameViewBudget.TIERS.length - 1) { this.level++; this.changed = true; this.healthy = 0; }
    } else this.healthy = 0;
    this.window = ts; this.frames = this.late = 0;
  }
  lower(now, steps = 1) {
    const next = Math.max(0, this.level - steps);
    if (next !== this.level) { this.level = next; this.changed = true; }
    this.blockedUntil = now + 180; this.healthy = 0;
  }
  encoder(now, cpuLimited, encodeMs = 0) {
    if (cpuLimited || encodeMs > 1000 / this.quality.fps * .7) { this.encoderPressureUntil = now + 2500; this.lower(now); }
  }
  slack(now) {
    const reserve = Math.max(.8, this.displayMs * .2);
    return Math.max(0, (this.frameStart || 0) + this.displayMs - now - reserve);
  }
  canSpend(now, cost = .2) {
    return now >= this.blockedUntil && this.work < this.displayMs * .85 && this.slack(now) > cost + .25;
  }
  slice(now) { return Math.max(0, Math.min(.8, this.displayMs * .08, this.slack(now) * .25)); }
  due(now) { return now - this.lastPaint >= 1000 / this.quality.fps && this.canSpend(now, this.paintCost); }
  painted(now, cost) {
    this.lastPaint = now; this.paintCost += (cost - this.paintCost) * .2;
    if (cost > Math.min(2, this.displayMs * .2)) this.lower(now);
  }
}
