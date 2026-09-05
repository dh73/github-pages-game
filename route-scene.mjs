import {ROAD, LENGTH, pointAt} from './ride-core.mjs?v=route-4';

// The centreline is mapped. Road width, façades, vegetation and props are art,
// not a surveyed reconstruction or re-hosted Street View imagery.
const R = 6371000, rad = Math.PI / 180, origin = pointAt(0);
const forward = [(ROAD[1][1]-ROAD[0][1])*Math.cos(ROAD[0][0]*rad), ROAD[1][0]-ROAD[0][0]];
const norm = Math.hypot(...forward); forward[0]/=norm; forward[1]/=norm;
const right = [forward[1], -forward[0]];
const knots = ROAD.map(([lat,lng],i) => {
  const east=(lng-origin.lng)*rad*R*Math.cos(origin.lat*rad), north=(lat-origin.lat)*rad*R;
  return {x:east*right[0]+north*right[1],z:-(east*forward[0]+north*forward[1]),s:0};
});
knots[0].s=-9;
for(let i=1;i<knots.length;i++) knots[i].s=knots[i-1].s+Math.hypot(knots[i].x-knots[i-1].x,knots[i].z-knots[i-1].z);
for(let i=0;i<knots.length;i++) {
  const a=knots[Math.max(0,i-1)],b=knots[Math.min(knots.length-1,i+1)],d=b.s-a.s;
  knots[i].dx=(b.x-a.x)/d; knots[i].dz=(b.z-a.z)/d;
}
export function routeAt(s, lateral=0) {
  if(!Number.isFinite(s)||!Number.isFinite(lateral)) throw new TypeError('Route position must be finite');
  let x,z,dx,dz;
  const end=s<knots[0].s?knots[0]:s>knots.at(-1).s?knots.at(-1):null;
  if(end) { x=end.x+(s-end.s)*end.dx; z=end.z+(s-end.s)*end.dz; dx=end.dx; dz=end.dz; }
  else {
    let i=0; while(i<knots.length-2 && s>knots[i+1].s)i++;
    const a=knots[i],b=knots[i+1],d=b.s-a.s,t=(s-a.s)/d,t2=t*t,t3=t2*t;
    const value=(p,q,u,v)=>(2*t3-3*t2+1)*p+(t3-2*t2+t)*d*u+(-2*t3+3*t2)*q+(t3-t2)*d*v;
    const deriv=(p,q,u,v)=>((6*t2-6*t)*p+(3*t2-4*t+1)*d*u+(-6*t2+6*t)*q+(3*t2-2*t)*d*v)/d;
    x=value(a.x,b.x,a.dx,b.dx); z=value(a.z,b.z,a.dz,b.dz);
    dx=deriv(a.x,b.x,a.dx,b.dx); dz=deriv(a.z,b.z,a.dz,b.dz);
  }
  const n=Math.hypot(dx,dz); dx/=n; dz/=n;
  return {x:x-dz*lateral,z:z+dx*lateral,fx:dx,fz:dz,rx:-dz,rz:dx,yaw:Math.atan2(-dx,-dz)};
}
export const routeLength=LENGTH;
export const junctions=Object.freeze(knots.map(p=>p.s).filter(s=>s>0&&s<LENGTH));
export function rng(seed=92) { return ()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;}; }

export class Mesh {
  constructor(){this.data=[];}
  tri(a,b,c,color,mat=0,n=null){
    if(!n){const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];const l=Math.hypot(...n)||1;n=n.map(v=>v/l);}
    for(const p of [a,b,c])this.data.push(...p,...n,...color,mat);
  }
  quad(a,b,c,d,color,mat=0,n=null){this.tri(a,b,c,color,mat,n);this.tri(a,c,d,color,mat,n);}
  box(x,y,z,w,h,d,c,mat=0,yaw=0){
    const co=Math.cos(yaw),si=Math.sin(yaw),p=(a,b,e)=>[x+a*co+e*si,y+b,z-a*si+e*co];
    w/=2;h/=2;d/=2;
    const faces=[ [[-w,-h,d],[w,-h,d],[w,h,d],[-w,h,d]], [[w,-h,-d],[-w,-h,-d],[-w,h,-d],[w,h,-d]], [[w,-h,d],[w,-h,-d],[w,h,-d],[w,h,d]], [[-w,-h,-d],[-w,-h,d],[-w,h,d],[-w,h,-d]], [[-w,h,d],[w,h,d],[w,h,-d],[-w,h,-d]], [[-w,-h,-d],[w,-h,-d],[w,-h,d],[-w,-h,d]] ];
    for(const f of faces)this.quad(...f.map(v=>p(...v)),c,mat);
  }
  rod(a,b,r,c,segments=8,mat=0,r2=r){
    const dy=b.map((v,i)=>v-a[i]),len=Math.hypot(...dy)||1,u=dy.map(v=>v/len);
    const up=Math.abs(u[1])>.9?[1,0,0]:[0,1,0];
    let v=[u[1]*up[2]-u[2]*up[1],u[2]*up[0]-u[0]*up[2],u[0]*up[1]-u[1]*up[0]];const vl=Math.hypot(...v);v=v.map(x=>x/vl);
    const w=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const p=(base,r,t)=>base.map((x,j)=>x+r*(v[j]*Math.cos(t)+w[j]*Math.sin(t)));
    for(let i=0;i<segments;i++){
      const t=i/segments*Math.PI*2,t2=(i+1)/segments*Math.PI*2;
      const aa=p(a,r,t),ab=p(a,r,t2),ba=p(b,r2,t),bb=p(b,r2,t2);
      this.quad(aa,ab,bb,ba,c,mat);
      this.tri(a,ab,aa,c,mat,u.map(x=>-x));this.tri(b,ba,bb,c,mat,u);
    }
  }
  ellipsoid(x,y,z,rx,ry,rz,c,rings=7,segs=12,mat=0){
    const p=(a,b)=>[x+Math.sin(a)*Math.cos(b)*rx,y+Math.cos(a)*ry,z+Math.sin(a)*Math.sin(b)*rz];
    for(let j=0;j<rings;j++)for(let i=0;i<segs;i++){
      const a=j/rings*Math.PI,b=(j+1)/rings*Math.PI,t=i/segs*Math.PI*2,v=(i+1)/segs*Math.PI*2;
      const pts=[p(a,t),p(b,t),p(b,v),p(a,v)];
      for(const ids of [[0,1,2],[0,2,3]])for(const id of ids){const q=pts[id],n=[(q[0]-x)/rx**2,(q[1]-y)/ry**2,(q[2]-z)/rz**2],l=Math.hypot(...n)||1;this.data.push(...q,...n.map(v=>v/l),...c,mat);}
    }
  }
  array(){return new Float32Array(this.data);}
}
const plaster=[[.77,.65,.45],[.69,.73,.68],[.71,.40,.26],[.78,.77,.65],[.36,.61,.57],[.72,.62,.61],[.56,.62,.65]];
export function buildRoute(){
  const m=new Mesh(),random=rng(92),p=(s,side,y)=>{const q=routeAt(s,side);return [q.x,y,q.z];};
  const box=(s,side,y,w,h,d,c,mat=0)=>{const q=routeAt(s,side);m.box(q.x,y,q.z,w,h,d,c,mat,q.yaw);};
  const rod=(s,side,y,s2,side2,y2,r,c,n=8)=>m.rod(p(s,side,y),p(s2,side2,y2),r,c,n);
  // Entire static route is built and uploaded before the start button is enabled.
  m.box(0,-.35,-LENGTH/2,340,.6,LENGTH+220,[.59,.49,.32],2);
  for(let s=-65;s<LENGTH+95;s+=2){
    m.quad(p(s,-4,0),p(s,4,0),p(s+2,4,0),p(s+2,-4,0),[.285,.278,.249],1,[0,1,0]);
    for(const side of [-1,1]){
      const junction=junctions.some(j=>Math.abs(s-j)<4.8);
      if(!junction){box(s+1,side*4.22,.075,.4,.15,2,[.64,.60,.51],0);box(s+1,side*5.1,.08,1.4,.16,2,[.70,.66,.55],3);}
    }
  }
  for(const j of junctions){
    box(j,0,-.015,68,.024,8.8,[.285,.278,.249],1);
    for(const side of [-1,1]){
      box(j-6,side*5.1,1.5,.1,3,.1,[.28,.3,.28]);
      box(j-6,side*5.1,2.6,1.4,.36,.08,[.11,.27,.23]);
    }
  }
  for(const side of [-1,1]){
    for(let s=-35;s<LENGTH+65;s+=13+random()*6){
      if(junctions.some(j=>Math.abs(s-j)<10))continue;
      const d=9+random()*4,depth=7+random()*5,h=3+random()*1.4,wall=plaster[Math.floor(random()*plaster.length)],setback=7.7+depth/2+random()*2;
      box(s,side*setback,h/2,depth,h,d,wall,0);
      box(s,side*setback,h+.1,depth+.28,.22,d+.3,[.71,.67,.55],3);
      box(s,side*(setback-depth/2-.08),.4,.17,.8,d,[wall[0]*.72,wall[1]*.7,wall[2]*.7],0);
      if(random()<.24){box(s+1.1,side*(setback+1),h+1.25,depth-2,2.5,d*.65,wall,0);box(s+1.1,side*(setback+1),h+2.6,depth-1.8,.2,d*.69,[.68,.65,.55],3);}
      if(random()<.70){
        const tank=p(s-2,side*(setback+1),h+.35);m.rod(tank,[tank[0],h+1.35,tank[2]],.53,[.13,.15,.15],12,4,.46);
      }
      const front=side*(setback-depth/2-.12);
      for(let w=-1;w<=1;w+=2){
        box(s+w*d*.28,front,1.7,.14,1.35,1.7,[.15,.21,.20],4);
        box(s+w*d*.28,front-side*.09,2.44,.38,.15,2,[.68,.67,.57],3);
        for(let t=-.7;t<=.8;t+=.23)box(s+w*d*.28+t,front-side*.11,1.7,.045,1.4,.028,[.26,.29,.28],4);
        for(let y=1.1;y<2.4;y+=.6)box(s+w*d*.28,front-side*.13,y,.045,.025,1.8,[.26,.29,.28],4);
      }
      box(s,front,1.14,.17,2.28,1.05,[.25,.24,.21],4);
      box(s,front-side*.1,2.36,.55,.16,1.35,[.72,.67,.53],3);
      if(random()<.7){
        const fence=side*6.25;
        box(s,fence,.48,.2,.96,d,[.65,.59,.44],0);
        for(let k=-d/2;k<d/2;k+=.28)box(s+k,fence,1.38,.035,1.0,.035,[.22,.24,.21],4);
        box(s,fence,1.89,.07,.07,d,[.22,.24,.21],4);
        for(const edge of [-1,1])box(s+edge*d/2,fence,1,.44,2,.45,[.72,.65,.52],0);
      }
      if(random()<.7){
        const treeS=s+6,treeSide=side*(6+random()*2),height=4+random()*2;
        rod(treeS,treeSide,.1,treeS+.25,treeSide+.15,height,.14,[.35,.29,.17],8);
        const q=p(treeS,treeSide,height);
        for(let t=0;t<6;t++){const a=t*Math.PI/3,cr=1.1+random()*.6;m.ellipsoid(q[0]+Math.cos(a)*.95,q[1]+random()*.6,q[2]+Math.sin(a)*.95,cr,1.1,cr,[.22+random()*.08,.32+random()*.08,.12+random()*.045],5,8,5);}
      }
      if(random()<.24){ // Parked vehicles stay outside the playable corridor.
        const q=routeAt(s+2,side*5.4);car(m,q.x,q.z,q.yaw,[[.62,.63,.58],[.25,.36,.40],[.52,.19,.12]][Math.floor(random()*3)]);
      }
    }
    for(let s=-35;s<LENGTH+70;s+=34){
      const sp=side*5.8;
      rod(s,sp,0,s,sp,7.4,.12,[.48,.46,.38],10);
      rod(s,sp,6.9,s,sp-side*1.2,7.15,.065,[.24,.27,.25]);
      box(s,sp-side*1.2,7.13,.52,.10,.3,[.75,.76,.65],4);
      for(let k=-1;k<=1;k++){
        let prev=p(s,sp+k*.32,7.25);
        for(let i=1;i<=12;i++){
          const d=i/12,cur=p(s+34*d,sp+k*.32,7.25-Math.sin(d*Math.PI)*.48);
          m.rod(prev,cur,.016,[.15,.17,.15],4);prev=cur;
        }
      }
    }
  }
  // Discreet physical start / finish paint; not a map HUD.
  for(const s of [-.2,LENGTH])for(let i=0;i<16;i++)for(let row=0;row<2;row++)box(s+row*.32,-3.75+i*.5,.02,.5,.016,.32,(i+row)%2?[.79,.76,.65]:[.16,.17,.16]);
  return m.array();
}
function car(m,x,z,yaw,c){
  const b=(a,y,d,w,h,l,col)=>{const co=Math.cos(yaw),si=Math.sin(yaw);m.box(x+a*co+d*si,y,z-a*si+d*co,w,h,l,col,4,yaw);};
  b(0,.62,0,1.65,.57,3.65,c);b(0,1.14,.2,1.48,.67,1.85,c);
  b(0,1.22,-.755,1.36,.47,.03,[.16,.24,.26]);b(0,1.22,1.135,1.36,.47,.03,[.16,.24,.26]);
  b(-.744,1.22,.2,.03,.48,1.5,[.16,.24,.26]);b(.744,1.22,.2,.03,.48,1.5,[.16,.24,.26]);
  b(0,.40,-1.86,1.6,.13,.08,[.48,.49,.46]);b(0,.4,1.86,1.6,.13,.08,[.48,.49,.46]);
  for(const side of [-1,1])for(const end of [-1,1])b(side*.80,.38,end*1.12,.16,.59,.59,[.09,.10,.095]);
}
export function buildQuad(){
  const body=new Mesh(),wheels=new Mesh(),rider=new Mesh();
  const red=[.66,.105,.057],dark=[.085,.096,.09],metal=[.34,.38,.35];
  body.box(0,.58,0,.84,.28,1.64,dark,4);
  body.box(0,.82,-.5,.82,.24,.77,red,4);
  for(const side of [-1,1]){
    body.box(side*.54,.77,-.64,.36,.13,.7,red,4);body.box(side*.54,.75,.59,.36,.14,.65,red,4);
    body.rod([side*.3,.60,-.60],[side*.6,.36,-.66],.045,metal,8);
    body.rod([side*.3,.60,.60],[side*.6,.36,.66],.045,metal,8);
    body.rod([side*.53,.39,-.68],[side*.35,.83,-.42],.06,[.84,.62,.12],9);
    body.box(side*.46,.68,-.96,.2,.12,.025,[1,.87,.53],6);
    body.box(side*.40,.65,.96,.2,.10,.025,[.65,.07,.03],6);
    body.rod([side*.57,.84,-.7],[side*.57,.84,-.96],.025,metal,6);
  }
  body.box(0,.81,.1,.43,.18,.77,[.10,.115,.10],4);
  body.box(0,.59,.14,.46,.34,.60,[.22,.24,.23],4);
  for(let i=0;i<5;i++)body.box(0,.51+i*.05,.12,.51,.018,.51,metal,4);
  body.rod([0,.87,-.41],[0,1.12,-.57],.055,dark,8);
  body.rod([-.49,1.11,-.47],[.49,1.11,-.47],.035,metal,9);
  for(const side of [-1,1])body.rod([side*.34,1.11,-.47],[side*.54,1.11,-.47],.055,dark,10);
  body.box(0,1.04,-.58,.24,.13,.10,dark,4);
  body.box(0,1.075,-.52,.18,.063,.012,[.28,.63,.44],6);
  body.rod([-.56,.49,.85],[.56,.49,.85],.048,metal,8);
  body.box(0,.77,.69,.70,.05,.49,dark,4);
  for(let i=-1;i<=1;i++)body.rod([i*.23,.83,.49],[i*.23,.83,.89],.022,metal,6);
  // Wheel mesh is local; render four copies with steering and true distance/radius spin.
  wheels.rod([-.155,0,0],[.155,0,0],.34,dark,20,4);
  for(const side of [-1,1])wheels.rod([side*.157,0,0],[side*.169,0,0],.175,metal,16,4);
  for(let t=0;t<24;t++){
    const a=t/24*Math.PI*2,y=Math.sin(a)*.335,z=Math.cos(a)*.335;
    wheels.box(0,y,z,.30,.058,.07,[.14,.15,.13],4);
  }
  // A helmeted local rider, without an identifiable person's likeness.
  const skin=[.60,.37,.22],shirt=[.80,.76,.65],jeans=[.13,.23,.28];
  rider.ellipsoid(0,1.23,.03,.25,.36,.18,shirt,8,12,0);
  rider.ellipsoid(0,1.74,-.07,.20,.24,.22,[.89,.70,.22],9,14,4);
  rider.box(0,1.78,-.254,.30,.115,.022,[.08,.14,.15],4);
  for(const side of [-1,1]){
    rider.rod([side*.20,1.46,-.01],[side*.32,1.22,-.26],.07,shirt,9);
    rider.rod([side*.32,1.22,-.26],[side*.43,1.11,-.46],.052,skin,9);
    rider.rod([side*.16,.99,.08],[side*.32,.74,-.14],.11,jeans,9);
    rider.rod([side*.32,.74,-.14],[side*.36,.44,.14],.084,jeans,9);
    rider.box(side*.36,.41,.065,.17,.14,.32,[.16,.12,.075],4);
  }
  return {body:body.array(),wheel:wheels.array(),rider:rider.array()};
}
export function buildSeal(){
  const m=new Mesh(),n=36,r=.56,t=.055;
  for(let i=0;i<n;i++){
    const a=i/n*2*Math.PI,b=(i+1)/n*2*Math.PI;
    m.rod([Math.cos(a)*r,Math.sin(a)*r,0],[Math.cos(b)*r,Math.sin(b)*r,0],t,[.99,.63,.14],5,6);
  }
  return m.array();
}
export function buildCone(){
  const m=new Mesh();m.box(0,.05,0,.48,.1,.48,[.12,.13,.115]);
  m.rod([0,.1,0],[0,.36,0],.20,[.91,.31,.045],12,0,.115);
  m.rod([0,.36,0],[0,.49,0],.115,[.9,.87,.72],12,0,.075);
  m.rod([0,.49,0],[0,.65,0],.075,[.91,.31,.045],12,0,.022);
  return m.array();
}
