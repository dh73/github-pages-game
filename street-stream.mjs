import {PHOTOS, PHOTO_STEP, photoAt, streetURL, clamp, damp} from './ride-core.mjs?v=drive-3';

// Native Google embeds only. No copied tiles, private endpoints, or hidden attribution.
// Document load cannot verify cross-origin tile availability; keep explicit repair UI.
export class StreetStream {
  constructor(container) {
    this.container = container; this.slots = new Map(); this.epoch = 0;
    this.active = null; this.previous = null; this.want = 0; this.cameraDistance = 0;
    this.capacity = 6; this.concurrent = 2; this.ahead = 3;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  dispose(slot) {
    clearTimeout(slot.timeout); clearTimeout(slot.settle);
    slot.frame.onload = null; slot.frame.onerror = null;
    slot.frame.remove(); this.slots.delete(slot.index);
    if (this.active === slot) this.active = null;
    if (this.previous === slot) this.previous = null;
  }
  reset(index = 0) {
    this.epoch++; [...this.slots.values()].forEach(s => this.dispose(s));
    this.active = null; this.previous = null; this.want = index;
    this.cameraDistance = PHOTOS[index].distance; this.plan(index);
  }
  plan(index) {
    this.want = index;
    const now = performance.now();
    if (this.previous && now >= this.previous.retireAt) {
      this.previous.frame.style.opacity = '0'; this.previous = null;
    }
    for (const slot of this.slots.values()) {
      if (slot !== this.active && slot !== this.previous && (slot.index < index - 1 || slot.index > index + this.ahead)) this.dispose(slot);
    }
    let pending = [...this.slots.values()].filter(s => !s.ready && !s.failed).length;
    for (let i = index; i <= Math.min(index + this.ahead, PHOTOS.length - 1); i++) {
      if (pending >= this.concurrent || this.slots.size >= this.capacity) break;
      if (!this.slots.has(i)) { this.load(i); pending++; }
    }
  }
  load(index) {
    const frame = document.createElement('iframe'), epoch = this.epoch;
    frame.title = `Google Street View · Vicente Guerrero · tramo ${index + 1}`;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.loading = 'eager'; frame.allow = 'fullscreen';
    frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
    const slot = {index, frame, ready: false, failed: false, timeout: 0, settle: 0, retireAt: 0};
    this.slots.set(index, slot);
    const current = () => epoch === this.epoch && this.slots.get(index) === slot;
    const failed = () => { if (current()) { slot.failed = true; this.plan(this.want); } };
    slot.timeout = setTimeout(failed, 25000);
    frame.onload = () => {
      if (!current()) return;
      clearTimeout(slot.settle);
      slot.settle = setTimeout(() => {
        if (!current()) return;
        clearTimeout(slot.timeout); slot.ready = true; slot.failed = false; this.plan(this.want);
      }, 750);
    };
    frame.onerror = failed; frame.src = streetURL(PHOTOS[index]); this.container.append(frame);
  }
  warm(index) {
    this.plan(index);
    return Boolean(this.slots.get(index)?.ready);
  }
  best(index) {
    return [...this.slots.values()].filter(s => s.ready && s.index <= index).sort((a, b) => b.index - a.index)[0] || null;
  }
  canDrive(index) {
    this.plan(index);
    if (this.slots.get(index)?.ready) return true;
    // Absorb short network jitter without a stop at every 17 m seam.
    // Bound stale imagery to two intervals; never continue indefinitely on one photo.
    const latest = this.best(index);
    return Boolean(latest && index !== PHOTOS.length - 1 && index - latest.index <= 2);
  }
  failed(index) { return !this.canDrive(index) && Boolean(this.slots.get(index)?.failed); }
  render(distance, dt) {
    const index = photoAt(distance), slot = this.best(index), now = performance.now();
    if (!slot) return;
    if (this.active !== slot) {
      if (this.previous && this.previous !== this.active) this.previous.frame.style.opacity = '0';
      this.previous = this.active;
      if (this.previous) this.previous.retireAt = now + 650;
      this.active = slot; slot.enteredAt = now;
      for (const s of this.slots.values()) {
        s.frame.classList.toggle('visible', s === slot);
        s.frame.tabIndex = s === slot ? 0 : -1;
        s.frame.setAttribute('aria-hidden', String(s !== slot));
        s.frame.style.zIndex = s === slot ? '2' : '1';
        if (s !== slot && s !== this.previous) s.frame.style.opacity = '0';
      }
    }
    this.cameraDistance = damp(this.cameraDistance, distance, 12, dt);
    const transition = this.reduced || !this.previous ? 1 : clamp((now - slot.enteredAt) / 650, 0, 1);
    const alpha = transition * transition * (3 - 2 * transition);
    slot.frame.style.opacity = String(alpha);
    if (this.previous) this.previous.frame.style.opacity = transition < 1 ? '1' : '0';
    for (const s of [this.previous, slot]) {
      if (!s) continue;
      const progress = clamp((this.cameraDistance - PHOTOS[s.index].distance) / PHOTO_STEP, 0, 1.3);
      // Optical push between real photos; NOT fabricated 3D geometry.
      // Scale is <= 1: the whole native frame, including all attribution, stays visible.
      const scale = this.reduced ? 1 : .943 + progress * .039;
      s.frame.style.transform = `scale(${scale.toFixed(5)})`;
    }
    this.container.dataset.photo = slot.index;
    this.container.dataset.lag = String(Math.max(0, index - slot.index));
    this.container.dataset.loaded = String([...this.slots.values()].filter(s => s.ready).length);
  }
}
