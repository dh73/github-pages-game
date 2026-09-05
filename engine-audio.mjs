// Locally synthesized four-stroke exhaust, intake, tires and wind; no media fetches.
// AudioContext is created/resumed synchronously inside a Start/Resume/click gesture.
export class EngineAudio {
  constructor(onState=()=>{}) {this.context=null;this.enabled=true;this.level=.58;this.onState=onState;this.nodes=[];this.active=false;this.rpm=1400;this.startCount=0;}
  create(){
    if(this.context&&this.context.state!=='closed')return;
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)throw new Error('Audio no disponible en este navegador');
    try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
    const c=this.context=new Context({latencyHint:'interactive'});this.startCount++;
    this.master=c.createGain();this.master.gain.value=0;
    this.compressor=c.createDynamicsCompressor();this.compressor.threshold.value=-16;this.compressor.knee.value=18;this.compressor.ratio.value=5;this.compressor.attack.value=.004;this.compressor.release.value=.18;
    this.analyser=c.createAnalyser();this.analyser.fftSize=1024;
    this.master.connect(this.compressor);this.compressor.connect(this.analyser);this.analyser.connect(c.destination);
    this.engineBus=c.createGain();this.engineBus.gain.value=0;this.engineBus.connect(this.master);
    const real=new Float32Array(65),imag=new Float32Array(65);
    for(let i=1;i<65;i++)imag[i]=(1+Math.cos(i*.64)*.3)/Math.pow(i,.93);
    this.motor=c.createOscillator();this.motor.setPeriodicWave(c.createPeriodicWave(real,imag));this.motor.frequency.value=1400/120;
    this.exhaust=c.createBiquadFilter();this.exhaust.type='lowpass';this.exhaust.frequency.value=680;this.exhaust.Q.value=.55;
    this.exhaustGain=c.createGain();this.exhaustGain.gain.value=.56;
    this.motor.connect(this.exhaust);this.exhaust.connect(this.exhaustGain);this.exhaustGain.connect(this.engineBus);
    this.motor.start();this.nodes.push(this.motor);
    const buffer=c.createBuffer(1,Math.round(c.sampleRate*2),c.sampleRate),data=buffer.getChannelData(0);
    let seed=9217,low=0;
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;const white=((seed>>>0)/4294967296)*2-1;low=(low+.022*white)/1.022;data[i]=white*.42+low*3;}
    const noise=(type,frequency,q)=>{
      const src=c.createBufferSource();src.buffer=buffer;src.loop=true;const filter=c.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;
      const gain=c.createGain();gain.gain.value=0;src.connect(filter);filter.connect(gain);gain.connect(this.engineBus);src.start();this.nodes.push(src);return {filter,gain};
    };
    this.intake=noise('bandpass',420,.7);this.wind=noise('highpass',780,.5);this.tires=noise('bandpass',1700,.5);
    c.addEventListener('statechange',()=>this.report());this.samples=new Float32Array(1024);this.report();
  }
  unlock(){
    try {
      this.create();
      // Do not put an await, timer, network request or countdown before resume().
      const promise=this.context.resume();
      this.master.gain.setTargetAtTime(this.enabled?this.level:0,this.context.currentTime,.025);
      return Promise.resolve(promise).then(()=>{this.report();return this.context.state==='running';},()=>{this.onState('blocked');return false;});
    }catch{this.onState('unavailable');return Promise.resolve(false);}
  }
  report(){this.onState(!this.enabled?'muted':this.context?.state==='running'?'running':this.context?'blocked':'ready');}
  toggle(){this.enabled=!this.enabled;if(this.enabled)return this.unlock();if(this.context)this.master.gain.setTargetAtTime(0,this.context.currentTime,.035);this.report();return Promise.resolve(false);}
  setVolume(value){this.level=Math.max(0,Math.min(1,Number(value)||0));if(this.context)this.master.gain.setTargetAtTime(this.enabled?this.level:0,this.context.currentTime,.03);}
  update(ride,active){
    this.active=active;
    if(!this.context||this.context.state==='closed')return;
    const t=this.context.currentTime,speed=Math.max(0,ride.speed||0),load=Math.max(0,ride.throttle||0);
    const gear=speed<4?1:speed<8?2:speed<12?3:4;
    const gearBase=[0,0,4,8,12][gear];
    this.rpm=1400+(speed-gearBase)*340+load*1350;
    this.motor.frequency.setTargetAtTime(this.rpm/120,t,.07);
    this.exhaust.frequency.setTargetAtTime(450+load*820+speed*26,t,.08);
    this.exhaustGain.gain.setTargetAtTime(.4+load*.22,t,.05);
    this.intake.gain.gain.setTargetAtTime(.065+load*.16,t,.08);
    this.wind.gain.gain.setTargetAtTime(Math.min(.20,speed*speed*.00075),t,.15);
    this.tires.gain.gain.setTargetAtTime(speed*.0035+Math.min(.15,Math.abs(ride.lateralSpeed||0)*.065),t,.06);
    this.engineBus.gain.setTargetAtTime(active?1:0,t,.025);
  }
  tone(from,to=from,duration=.17){
    if(!this.enabled||this.context?.state!=='running')return;
    const c=this.context,t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.frequency.setValueAtTime(from,t);o.frequency.exponentialRampToValueAtTime(to,t+duration);
    g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(.12,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g);g.connect(this.master);o.start();o.stop(t+duration+.03);o.onended=()=>{o.disconnect();g.disconnect();};
  }
  meter(){
    if(!this.analyser)return {rms:0,peak:0,state:'uninitialized',starts:this.startCount};
    this.analyser.getFloatTimeDomainData(this.samples);let energy=0,peak=0;for(const v of this.samples){energy+=v*v;peak=Math.max(peak,Math.abs(v));}
    return {rms:Math.sqrt(energy/this.samples.length),peak,state:this.context.state,starts:this.startCount,enabled:this.enabled};
  }
  silence(){this.update({},false);}
  dispose(){for(const n of this.nodes){try{n.stop();n.disconnect();}catch{}}this.nodes=[];this.context?.close().catch(()=>{});}
}
