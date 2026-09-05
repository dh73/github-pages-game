import {routeAt,buildRoute,buildQuad,buildSeal,buildCone,Mesh,routeLength} from './route-scene.mjs?v=route-4';
const I=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
function model(x=0,y=0,z=0,yaw=0,pitch=0,roll=0,sx=1,sy=1,sz=1){
  const cy=Math.cos(yaw),syaw=Math.sin(yaw),cx=Math.cos(pitch),sp=Math.sin(pitch),cz=Math.cos(roll),sr=Math.sin(roll);
  const ry=new Float32Array([cy,0,-syaw,0,0,1,0,0,syaw,0,cy,0,0,0,0,1]);
  const rx=new Float32Array([1,0,0,0,0,cx,sp,0,0,-sp,cx,0,0,0,0,1]);
  const rz=new Float32Array([cz,sr,0,0,-sr,cz,0,0,0,0,1,0,0,0,0,1]);
  const m=multiply(multiply(ry,rx),rz);
  for(let i=0;i<3;i++){m[i]*=sx;m[4+i]*=sy;m[8+i]*=sz;}
  m[12]=x;m[13]=y;m[14]=z;return m;
}
function perspective(fov,aspect,near,far){const t=1/Math.tan(fov/2),o=new Float32Array(16);o[0]=t/aspect;o[5]=t;o[10]=(far+near)/(near-far);o[11]=-1;o[14]=2*far*near/(near-far);return o;}
function ortho(l,r,b,t,n,f){return new Float32Array([2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,-2/(f-n),0,-(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1]);}
function lookAt(eye,target){
  let z=eye.map((v,i)=>v-target[i]),l=Math.hypot(...z);z=z.map(v=>v/l);
  let x=[z[2],0,-z[0]];l=Math.hypot(...x);x=x.map(v=>v/l);
  const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
  return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-x.reduce((s,v,i)=>s+v*eye[i],0),-y.reduce((s,v,i)=>s+v*eye[i],0),-z.reduce((s,v,i)=>s+v*eye[i],0),1]);
}
const vertex=`
attribute vec3 a_position;attribute vec3 a_normal;attribute vec3 a_color;attribute float a_material;
uniform mat4 u_model;uniform mat4 u_vp;uniform mat4 u_light;
varying vec3 v_world;varying vec3 v_normal;varying vec3 v_color;varying float v_material;varying vec4 v_shadow;varying vec3 v_local;
void main(){vec4 w=u_model*vec4(a_position,1.);v_world=w.xyz;v_local=a_position;v_normal=mat3(u_model)*a_normal;v_color=a_color;v_material=a_material;v_shadow=u_light*w;gl_Position=u_vp*w;}`;
const fragment=`
precision highp float;
varying vec3 v_world;varying vec3 v_normal;varying vec3 v_color;varying float v_material;varying vec4 v_shadow;varying vec3 v_local;
uniform vec3 u_eye;uniform sampler2D u_shadow;uniform sampler2D u_sign;uniform sampler2D u_noise;uniform float u_shadowSize;
float noise(vec2 p){return texture2D(u_noise,p/256.).r;}
float unpack(vec4 c){return dot(c,vec4(1.,1./255.,1./65025.,1./16581375.));}
void main(){
 if(v_material>7.5&&v_material<8.5){float a=max(0.,1.-dot(v_local.xz,v_local.xz));gl_FragColor=vec4(.06,.05,.035,a*a*.40);return;}
 vec3 n=normalize(v_normal),light=normalize(vec3(-.65,.96,.32)),base=v_color;
 float distance=length(v_world-u_eye),detail=1.-smoothstep(28.,95.,distance);
 if(v_material<.5)base*=.93+.11*noise(v_world.xz*4.+v_world.y*6.);
 else if(v_material<1.5){float grain=noise(v_world.xz*74.);base*=.86+.22*noise(v_world.xz*.34)+detail*(grain-.5)*.18;}
 else if(v_material<2.5)base*=.85+.27*noise(v_world.xz*2.7);
 else if(v_material<3.5){vec2 q=v_world.xz*1.7;float joint=step(.96,fract(q.x))+step(.97,fract(q.y));base*=.94+.08*noise(q*30.)-joint*.10*detail;}
 else if(v_material>9.5){base=texture2D(u_sign,v_local.xy*.5+.5).rgb;}
 vec3 sc=v_shadow.xyz/v_shadow.w*.5+.5;
 float shade=0.;
 if(sc.x>0.&&sc.x<1.&&sc.y>0.&&sc.y<1.&&sc.z<1.){
   float bias=max(.00035,.00065*(1.-max(0.,dot(n,light))));
   for(int x=0;x<2;x++)for(int y=0;y<2;y++){
     vec2 offset=(vec2(float(x),float(y))-.5)*1.6/u_shadowSize;
     float dep=unpack(texture2D(u_shadow,sc.xy+offset));shade+=step(sc.z-bias,dep)*.25;
   }
 }else shade=1.;
 float sun=max(0.,dot(n,light));
 vec3 col=base*(vec3(.32,.39,.44)+vec3(.85,.72,.53)*sun*(.28+.72*shade));
 if(v_material>3.5&&v_material<4.5){vec3 view=normalize(u_eye-v_world);col+=vec3(.22,.20,.14)*pow(max(0.,dot(n,normalize(light+view))),42.)*shade;}
 if(v_material>5.5&&v_material<6.5)col=base*1.04;
 float fog=1.-exp(-pow(distance/205.,1.65));
 col=mix(col,vec3(.77,.78,.69),clamp(fog,0.,.94));
 col=pow(max(col,vec3(0.)),vec3(.91));gl_FragColor=vec4(col,1.);
}`;
const shadowFragment=`precision highp float;void main(){vec4 enc=fract(gl_FragCoord.z*vec4(1.,255.,65025.,16581375.));enc-=enc.yzww*vec4(1./255.,1./255.,1./255.,0.);gl_FragColor=enc;}`;
const skyVertex=`attribute vec2 a_position;varying vec2 v_uv;void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,1.,1.);}`;
const skyFragment=`precision mediump float;varying vec2 v_uv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
void main(){float h=smoothstep(.30,1.,v_uv.y);vec3 c=mix(vec3(.81,.81,.71),vec3(.32,.56,.70),h);float cloud=noise(v_uv*vec2(6.,10.))*.60+noise(v_uv*vec2(14.,20.))*.26+noise(v_uv*vec2(29.,40.))*.14;c=mix(c,vec3(.94,.9,.79),smoothstep(.61,.83,cloud)*smoothstep(.50,.85,v_uv.y)*.6);gl_FragColor=vec4(c,1.);}`;
export class RouteRenderer {
 constructor(canvas,{onLost=()=>{},onRestored=()=>{}}={}){
   this.canvas=canvas;this.onLost=onLost;this.onRestored=onRestored;this.ready=false;this.lost=false;this.camera='chase';this.frameCount=0;this.resources=[];
   this.quality=1;this.slow=0;this.lastQuality=0;this.eye=null;this.viewTarget=null;this.width=1;this.height=1;
   canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;this.ready=false;onLost();});
   canvas.addEventListener('webglcontextrestored',()=>{try{this.init();this.resize(this.width,this.height);this.lost=false;onRestored();}catch(e){onLost(e);}});
   this.gl=canvas.getContext('webgl',{alpha:false,antialias:true,depth:true,powerPreference:'high-performance',preserveDrawingBuffer:false});
   if(!this.gl)throw new Error('Este navegador no pudo activar WebGL. Prueba Safari o Chrome con aceleración gráfica.');
   this.staticData=buildRoute();this.quadData=buildQuad();this.sealData=buildSeal();this.coneData=buildCone();
   this.init();
 }
 program(vs,fs){
   const gl=this.gl,compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
   const a=compile(gl.VERTEX_SHADER,vs),b=compile(gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,a);gl.attachShader(p,b);gl.linkProgram(p);gl.deleteShader(a);gl.deleteShader(b);
   if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
   this.resources.push(['program',p]);
   const attributes=Object.fromEntries(['position','normal','color','material'].map(n=>[n,gl.getAttribLocation(p,'a_'+n)]));
   const uniforms=Object.fromEntries(['model','vp','light','eye','shadow','sign','noise','shadowSize'].map(n=>[n,gl.getUniformLocation(p,'u_'+n)]));return {p,attributes,uniforms};
 }
 upload(data){const gl=this.gl,b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);this.resources.push(['buffer',b]);return {buffer:b,count:data.length/10};}
 init(){
   const gl=this.gl;this.resources=[];
   this.main=this.program(vertex,fragment);this.depth=this.program(vertex,shadowFragment);this.sky=this.program(skyVertex,skyFragment);
   this.world=this.upload(this.staticData);this.body=this.upload(this.quadData.body);this.wheel=this.upload(this.quadData.wheel);this.person=this.upload(this.quadData.rider);this.seal=this.upload(this.sealData);this.cone=this.upload(this.coneData);
   const blob=new Mesh();blob.quad([-1,0,-1],[-1,0,1],[1,0,1],[1,0,-1],[0,0,0],8,[0,1,0]);this.blob=this.upload(blob.array());
   const sign=new Mesh();sign.quad([-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0],[1,1,1],10);this.sign=this.upload(sign.array());
   this.skyBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.skyBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);this.resources.push(['buffer',this.skyBuffer]);
   const text=document.createElement('canvas');text.width=512;text.height=128;const c=text.getContext('2d');c.fillStyle='#234d40';c.fillRect(0,0,512,128);c.strokeStyle='#dcd8bb';c.lineWidth=4;c.strokeRect(8,8,496,112);c.textAlign='center';c.fillStyle='#fff5d8';c.font='bold 33px sans-serif';c.fillText('VICENTE GUERRERO',256,56);c.font='19px sans-serif';c.fillText('AYUNTAMIENTO 92 · GUASAVE',256,92);
   this.signTexture=gl.createTexture();this.resources.push(['texture',this.signTexture]);gl.bindTexture(gl.TEXTURE_2D,this.signTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,text);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
   // Mipmapped material noise is prepared once, not regenerated per fragment.
   this.noiseTexture=gl.createTexture();this.resources.push(['texture',this.noiseTexture]);gl.bindTexture(gl.TEXTURE_2D,this.noiseTexture);
   const texels=new Uint8Array(256*256*4);let seed=92;
   for(let i=0;i<texels.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)|0;const v=(seed>>>24);texels[i]=texels[i+1]=texels[i+2]=v;texels[i+3]=255;}
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,texels);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
   this.shadowSize=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE));
   this.shadow=gl.createTexture();this.resources.push(['texture',this.shadow]);gl.bindTexture(gl.TEXTURE_2D,this.shadow);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.shadowSize,this.shadowSize,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   const fb=gl.createFramebuffer(),rb=gl.createRenderbuffer();this.resources.push(['framebuffer',fb],['renderbuffer',rb]);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.shadow,0);gl.bindRenderbuffer(gl.RENDERBUFFER,rb);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,this.shadowSize,this.shadowSize);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,rb);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('No se pudo preparar la iluminación de la ruta.');
   this.lightVP=multiply(ortho(-240,240,-320,320,10,850),lookAt([-260,400,-80],[0,0,-routeLength/2]));
   gl.viewport(0,0,this.shadowSize,this.shadowSize);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(2,4);gl.useProgram(this.depth.p);gl.uniformMatrix4fv(this.depth.uniforms.vp,false,this.lightVP);gl.uniformMatrix4fv(this.depth.uniforms.light,false,this.lightVP);this.draw(this.world,I(),this.depth);
   gl.disable(gl.POLYGON_OFFSET_FILL);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindRenderbuffer(gl.RENDERBUFFER,null);
   this.ready=true;this.eye=null;this.frameCount=0;this.triangles=this.world.count/3;
 }
 draw(mesh,transform,program=this.main){
   const gl=this.gl,a=program.attributes;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
   for(const [name,size,offset] of [['position',3,0],['normal',3,12],['color',3,24],['material',1,36]]){
     if(a[name]<0)continue;gl.enableVertexAttribArray(a[name]);gl.vertexAttribPointer(a[name],size,gl.FLOAT,false,40,offset);
   }
   gl.uniformMatrix4fv(program.uniforms.model,false,transform);gl.drawArrays(gl.TRIANGLES,0,mesh.count);
 }
 resize(width,height){
   this.width=Math.max(1,width);this.height=Math.max(1,height);
   const ratio=Math.min(window.devicePixelRatio||1,1.5)*this.quality;
   this.canvas.width=Math.max(1,Math.round(this.width*ratio));this.canvas.height=Math.max(1,Math.round(this.height*ratio));
 }
 resetCamera(){this.eye=null;this.viewTarget=null;}
 render(v,objects,dt,{playing=false,reducedMotion=false}={}){
   if(!this.ready||this.lost)return;const gl=this.gl;this.frameCount++;
   // Only camera / vehicle / game-object matrices change during a ride.
   const q=routeAt(v.distance,v.lane*2.8),future=routeAt(v.distance+14,v.lane*2.8);
   const cockpit=this.camera==='driver',bump=playing&&!reducedMotion?Math.sin(v.distance*2.7)*Math.min(.014,v.speed*.0014):0;
   const desiredEye=cockpit?[q.x-q.fx*.50,1.72+bump,q.z-q.fz*.50]:[q.x-q.fx*4.9,2.65+bump,q.z-q.fz*4.9];
   const target=cockpit?[future.x,1.57,future.z]:[q.x+q.fx*9,1.12,q.z+q.fz*9];
   if(!this.eye){this.eye=desiredEye;this.viewTarget=target;}else{
     const f=1-Math.exp(-Math.min(dt,.1)*(reducedMotion?30:11));for(let i=0;i<3;i++){this.eye[i]+=(desiredEye[i]-this.eye[i])*f;this.viewTarget[i]+=(target[i]-this.viewTarget[i])*f;}
   }
   gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(.7,.78,.76,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
   gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.useProgram(this.sky.p);gl.bindBuffer(gl.ARRAY_BUFFER,this.skyBuffer);
   for(let i=0;i<4;i++)gl.disableVertexAttribArray(i);
   gl.enableVertexAttribArray(this.sky.attributes.position);gl.vertexAttribPointer(this.sky.attributes.position,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,3);
   gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.useProgram(this.main.p);
   const aspect=this.width/this.height,fov=(aspect<.85?79:64)+(reducedMotion?0:v.speed*.14);
   this.vp=multiply(perspective(fov*Math.PI/180,aspect,.075,520),lookAt(this.eye,this.viewTarget));
   gl.uniformMatrix4fv(this.main.uniforms.vp,false,this.vp);gl.uniformMatrix4fv(this.main.uniforms.light,false,this.lightVP);gl.uniform3fv(this.main.uniforms.eye,this.eye);gl.uniform1f(this.main.uniforms.shadowSize,this.shadowSize);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.shadow);gl.uniform1i(this.main.uniforms.shadow,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.signTexture);gl.uniform1i(this.main.uniforms.sign,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.noiseTexture);gl.uniform1i(this.main.uniforms.noise,2);
   this.draw(this.world,I());
   for(const s of [12,124,238,340]){const p=routeAt(s,-5.5);this.draw(this.sign,model(p.x,2.6,p.z,p.yaw,0,0,1.4,.35,1));}
   for(const o of objects){if(o.passed||o.distance<v.distance-5||o.distance>v.distance+125)continue;
     const p=routeAt(o.distance,o.lane*2.8);
     if(o.kind==='cone')this.draw(this.cone,model(p.x,0,p.z,p.yaw));
     else this.draw(this.seal,model(p.x,1.1,p.z,p.yaw));
   }
   gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);this.draw(this.blob,model(q.x,.024,q.z,q.yaw,0,0,1.15,1,1.6));gl.depthMask(true);gl.disable(gl.BLEND);
   const yaw=q.yaw-v.heading,tilt=reducedMotion?0:v.roll*Math.PI/180*.65,pitch=reducedMotion?0:v.pitch*Math.PI/180*.70;
   const body=model(q.x,bump,q.z,yaw,pitch,tilt);this.draw(this.body,body);
   if(!cockpit)this.draw(this.person,body);
   for(const side of [-1,1])for(const end of [-1,1]){
     const offset=model(side*.62,.35,end*.66,end<0?-v.steer*.30/(1+v.speed*.07):0,0,0);
     const spin=model(0,0,0,0,-v.distance/.34,0);
     this.draw(this.wheel,multiply(body,multiply(offset,spin)));
   }
   this.lastPose={distance:v.distance,x:q.x,z:q.z,eye:[...this.eye],target:[...this.viewTarget]};
   // Dynamic resolution reacts slowly; physics never depends on frame rate.
   if(playing&&dt>.023)this.slow+=dt;else this.slow=Math.max(0,this.slow-dt*.5);
   if(this.slow>3&&this.quality>.65){this.quality=Math.max(.65,this.quality-.1);this.slow=0;this.resize(this.width,this.height);}
 }
 dispose(){
   const gl=this.gl;for(const [type,r]of this.resources){const fn={buffer:'deleteBuffer',program:'deleteProgram',texture:'deleteTexture',framebuffer:'deleteFramebuffer',renderbuffer:'deleteRenderbuffer'}[type];gl[fn](r);}this.resources=[];this.ready=false;
 }
}
