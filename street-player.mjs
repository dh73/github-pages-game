import {PHOTOS, PHOTO_STEP, photoAt, streetURL, clamp} from './ride-core.mjs?v=motion-3';

// Native, attributed Google frames only. No screenshots, tile extraction or invented facades.
export class StreetPlayer {
  constructor(container, {reducedMotion = false, maxFrames = 5} = {}) {
    this.container = container; this.reducedMotion = reducedMotion;
    this.maxFrames = clamp(maxFrames, 3, 6); this.slots = [];
    this.active = null; this.target = 0; this.epoch = 0; this.lastSwitch = 0;
  }
  dispose(slot) {
    clearTimeout(slot.timeout); clearTimeout(slot.settle);
    slot.frame.onload = slot.frame.onerror = null;
    slot.frame.remove(); this.slots = this.slots.filter(s => s !== slot);
    if (this.active === slot) this.active = null;
  }
  reset(index = 0) {
    this.epoch++; [...this.slots].forEach(slot => this.dispose(slot));
    this.target = index; this.lastSwitch = performance.now(); this.pump();
  }
  pump() {
    const now = performance.now();
    for (const slot of [...this.slots]) {
      if (slot !== this.active && now > slot.retireAt && (slot.index < this.target - 1 || slot.index > this.target + this.maxFrames)) this.dispose(slot);
    }
    const wishes = Array.from({length:this.maxFrames},(_,i) => this.target+i).filter(i => PHOTOS[i]);
    let loading = this.slots.filter(s => s.loading).length;
    for (const index of wishes) {
      if (this.slots.some(s => s.index === index)) continue;
      if (loading >= 2) break;
      if (this.slots.length >= this.maxFrames) {
        const victim = this.slots.find(s => s !== this.active && now > s.retireAt && s.index < this.target);
        if (!victim) break;
        this.dispose(victim);
      }
      this.load(index); loading++;
    }
  }
  load(index) {
    const frame = document.createElement('iframe');
    frame.title = `Google Street View · Vicente Guerrero · tramo ${index+1}`;
    frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.loading = 'eager';
    frame.allow = 'fullscreen'; frame.tabIndex = -1; frame.setAttribute('aria-hidden','true');
    const epoch = this.epoch;
    const slot = {index,frame,ready:false,failed:false,loading:true,timeout:0,settle:0,retireAt:0};
    this.slots.push(slot);
    const current = () => this.epoch === epoch && this.slots.includes(slot);
    const fail = () => {
      if (!current()) return;
      clearTimeout(slot.timeout); clearTimeout(slot.settle);
      slot.loading = false; slot.failed = true; this.pump();
    };
    slot.timeout = setTimeout(fail,25000);
    frame.onerror = fail;
    frame.onload = () => {
      if (!current()) return;
      clearTimeout(slot.settle);
      // Cross-origin onload is not evidence that Google's panorama tiles succeeded.
      // The always-available repair control handles unavailable/blocked panoramas.
      slot.settle = setTimeout(() => {
        if (!current()) return;
        clearTimeout(slot.timeout); slot.ready = true; slot.failed = false;
        slot.loading = false; this.pump();
      },450);
    };
    frame.src = streetURL(PHOTOS[index]); this.container.append(frame);
  }
  prepare(distance) {
    this.target = photoAt(distance); this.pump();
    const first = this.slots.find(s => s.index === this.target);
    const second = this.slots.find(s => s.index === Math.min(this.target+1,PHOTOS.length-1));
    if (first?.ready) this.activate(first);
    return !!(first?.ready && second?.ready);
  }
  activate(slot) {
    if (!slot || this.active === slot) return;
    const previous = this.active;
    if (previous) previous.retireAt = performance.now()+650;
    this.active = slot; this.lastSwitch = performance.now();
    for (const s of this.slots) {
      s.frame.classList.toggle('visible', s === slot);
      s.frame.classList.toggle('outgoing', s === previous);
      s.frame.style.zIndex = s === slot ? '2' : s === previous ? '1' : '0';
      s.frame.setAttribute('aria-hidden',String(s !== slot)); s.frame.tabIndex = s === slot ? 0 : -1;
    }
  }
  update(distance) {
    this.target = photoAt(distance); this.pump();
    const ready = this.slots.filter(s => s.ready && s.index <= this.target).sort((a,b)=>b.index-a.index)[0];
    if (ready && (!this.active || ready.index >= this.active.index)) this.activate(ready);
    const lag = this.active ? Math.max(0,this.target-this.active.index) : Infinity;
    // One late panorama no longer freezes the drivetrain. A prolonged outage still pauses,
    // rather than pretending the displayed photograph matches a far-away position.
    return {ready:!!this.active, lag, stalled:lag > 2, failed:this.slots.some(s=>s.index>=this.target-2 && s.index<=this.target && s.failed)};
  }
  render(distance) {
    if (!this.active) return;
    // Subtle continuous dolly within each photo. Scale never exceeds 1: native attribution
    // is never cropped, and this is expressly photo interpolation, not 3D reconstruction.
    const phase = clamp((distance-PHOTOS[this.active.index].distance)/PHOTO_STEP,0,1);
    const scale = this.reducedMotion ? 1 : .965 + .035*phase;
    this.active.frame.style.transform = `scale(${scale.toFixed(5)})`;
  }
  failed(index) { return this.slots.some(s=>s.index===index && s.failed); }
  get index() { return this.active?.index ?? 0; }
  get count() { return this.slots.length; }
}
