import {Vector3, Triangle} from './vendor/three.module.min.js';

// Original collision triangles remain separate from the visible mesh. This
// browser controller is a calibratable approximation, not Blizzard's solver.
export const DEFAULT_PROFILE = Object.freeze({
  speed:7, backwardSpeed:4.5, jumpSpeed:7.9555, gravity:19.2911,
  radius:0.15, height:1.95, stepHeight:0.4, slopeDegrees:50,
  skin:0.002, groundSnap:0.05, airSteering:0, turnSpeed:2.3,
});
export const PROFILE_LIMITS = Object.freeze({
  speed:[1,15], backwardSpeed:[1,15], jumpSpeed:[3,14], gravity:[8,40],
  radius:[0.12,0.8], height:[1,3.5], stepHeight:[0,0.8],
  slopeDegrees:[20,70], skin:[0.0001,0.03], groundSnap:[0.005,0.2],
  airSteering:[0,1], turnSpeed:[0.5,5],
});
export function sanitizeProfile(candidate={}) {
  if(!candidate||typeof candidate!=='object')candidate={};
  const clean={};
  for(const [key,value] of Object.entries(DEFAULT_PROFILE)) {
    const proposed=Number(candidate[key]), [min,max]=PROFILE_LIMITS[key];
    clean[key]=Number.isFinite(proposed)?Math.max(min,Math.min(max,proposed)):value;
  }
  clean.height=Math.max(clean.height,clean.radius*2+0.1);
  return clean;
}

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const segmentPoint=(a,b,p,out)=>{
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
  const d=dx*dx+dy*dy+dz*dz;
  const t=d?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy+(p.z-a.z)*dz)/d,0,1):0;
  return out.set(a.x+dx*t,a.y+dy*t,a.z+dz*t);
};
// Closest points on two line segments, including parallel and zero-length cases.
function segmentPair(a,b,c,d,out1,out2) {
  const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z;
  const vx=d.x-c.x,vy=d.y-c.y,vz=d.z-c.z;
  const wx=a.x-c.x,wy=a.y-c.y,wz=a.z-c.z;
  const A=ux*ux+uy*uy+uz*uz,B=ux*vx+uy*vy+uz*vz;
  const C=vx*vx+vy*vy+vz*vz,D=ux*wx+uy*wy+uz*wz,E=vx*wx+vy*wy+vz*wz;
  let s=0,t=0;
  if(A<1e-16) t=C>1e-16?clamp(E/C,0,1):0;
  else if(C<1e-16) s=clamp(-D/A,0,1);
  else {
    const den=A*C-B*B;
    s=den>1e-16?clamp((B*E-C*D)/den,0,1):0;
    t=(B*s+E)/C;
    if(t<0){t=0;s=clamp(-D/A,0,1)}
    else if(t>1){t=1;s=clamp((B-D)/A,0,1)}
  }
  out1.set(a.x+ux*s,a.y+uy*s,a.z+uz*s);
  out2.set(c.x+vx*t,c.y+vy*t,c.z+vz*t);
}

export class CollisionWorld {
  constructor(parts) {
    this.triangles=[];
    for(const part of parts) {
      const p=part.positions,idx=part.indices;
      for(let i=0;i<idx.length;i+=3) {
        const a=new Vector3().fromArray(p,idx[i]*3),b=new Vector3().fromArray(p,idx[i+1]*3),c=new Vector3().fromArray(p,idx[i+2]*3);
        const normal=new Vector3().subVectors(b,a).cross(new Vector3().subVectors(c,a));
        if(normal.lengthSq()<1e-16)continue;
        normal.normalize();
        this.triangles.push({a,b,c,normal,name:part.name,
          min:[Math.min(a.x,b.x,c.x),Math.min(a.y,b.y,c.y),Math.min(a.z,b.z,c.z)],
          max:[Math.max(a.x,b.x,c.x),Math.max(a.y,b.y,c.y),Math.max(a.z,b.z,c.z)]});
      }
    }
    this.tree=this.build(this.triangles.map((_,i)=>i));
    this.triangle=new Triangle();this.bottom=new Vector3();this.top=new Vector3();
    this.closestBody=new Vector3();this.closestMesh=new Vector3();this.tmpA=new Vector3();this.tmpB=new Vector3();
    this.delta=new Vector3();this.point=new Vector3();this.normal=new Vector3();
  }
  build(ids) {
    if(!ids.length)return null;
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const id of ids){const tri=this.triangles[id];for(let k=0;k<3;k++){min[k]=Math.min(min[k],tri.min[k]);max[k]=Math.max(max[k],tri.max[k])}}
    if(ids.length<=12)return {min,max,ids};
    let axis=0;if(max[1]-min[1]>max[axis]-min[axis])axis=1;if(max[2]-min[2]>max[axis]-min[axis])axis=2;
    ids.sort((a,b)=>(this.triangles[a].min[axis]+this.triangles[a].max[axis])-(this.triangles[b].min[axis]+this.triangles[b].max[axis]));
    const middle=ids.length>>1;
    return {min,max,left:this.build(ids.slice(0,middle)),right:this.build(ids.slice(middle))};
  }
  query(min,max,node=this.tree,out=[]) {
    if(!node||node.min.some((n,i)=>n>max[i])||node.max.some((n,i)=>n<min[i]))return out;
    if(node.ids)out.push(...node.ids);else{this.query(min,max,node.left,out);this.query(min,max,node.right,out)}
    return out;
  }
  closestToCapsule(tri,start,end) {
    this.triangle.set(tri.a,tri.b,tri.c);
    const n=tri.normal,den=n.dot(this.delta.subVectors(end,start));
    if(Math.abs(den)>1e-12) {
      const t=n.dot(this.point.subVectors(tri.a,start))/den;
      if(t>=0&&t<=1) {
        this.point.copy(start).addScaledVector(this.delta,t);
        if(this.triangle.containsPoint(this.point)) {
          this.closestBody.copy(this.point);this.closestMesh.copy(this.point);return 0;
        }
      }
    }
    let best=Infinity;
    for(const endpoint of [start,end]) {
      this.triangle.closestPointToPoint(endpoint,this.tmpB);
      const distance=endpoint.distanceToSquared(this.tmpB);
      if(distance<best){best=distance;this.closestBody.copy(endpoint);this.closestMesh.copy(this.tmpB)}
    }
    for(const [a,b] of [[tri.a,tri.b],[tri.b,tri.c],[tri.c,tri.a]]) {
      segmentPair(start,end,a,b,this.tmpA,this.tmpB);
      const distance=this.tmpA.distanceToSquared(this.tmpB);
      if(distance<best){best=distance;this.closestBody.copy(this.tmpA);this.closestMesh.copy(this.tmpB)}
    }
    return Math.sqrt(best);
  }
  resolve(position,profile,previous=position,iterations=6) {
    const contacts=[];const radius=profile.radius,margin=radius+profile.skin;
    for(let pass=0;pass<iterations;pass++) {
      const candidates=this.query([position.x-margin,position.y-margin,position.z-profile.skin],
        [position.x+margin,position.y+margin,position.z+profile.height+profile.skin]);
      let changed=false;
      for(const id of candidates) {
        const tri=this.triangles[id];
        this.bottom.copy(position).add(new Vector3(0,0,radius));
        this.top.copy(position).add(new Vector3(0,0,profile.height-radius));
        const distance=this.closestToCapsule(tri,this.bottom,this.top);
        if(distance>=margin)continue;
        if(distance>1e-9) this.normal.subVectors(this.closestBody,this.closestMesh).divideScalar(distance);
        else {
          this.normal.copy(tri.normal);
          this.point.copy(previous).add(new Vector3(0,0,profile.height/2)).sub(tri.a);
          if(this.normal.dot(this.point)<0)this.normal.negate();
        }
        const penetration=margin-distance;
        position.addScaledVector(this.normal,penetration);
        contacts.push({normal:this.normal.clone(),depth:penetration,triangle:id,name:tri.name});
        changed=true;
      }
      if(!changed)break;
    }
    return contacts;
  }
  groundAt(x,y,top,bottom,slopeDegrees=50) {
    const candidates=this.query([x-1e-4,y-1e-4,bottom],[x+1e-4,y+1e-4,top]);
    let highest=-Infinity;const minNormal=Math.cos(slopeDegrees*Math.PI/180);
    const down=new Vector3(0,0,-1),origin=new Vector3(x,y,top);
    for(const id of candidates) {
      const t=this.triangles[id];
      if(Math.abs(t.normal.z)<minNormal)continue;
      const length=t.normal.dot(new Vector3().subVectors(t.a,origin))/t.normal.dot(down);
      if(length<0||top-length<bottom)continue;
      this.point.copy(origin).addScaledVector(down,length);this.triangle.set(t.a,t.b,t.c);
      if(this.triangle.containsPoint(this.point))highest=Math.max(highest,this.point.z);
    }
    return highest;
  }
  raycast(origin,direction,maxDistance) {
    const end=new Vector3().copy(origin).addScaledVector(direction,maxDistance);
    const candidates=this.query([Math.min(origin.x,end.x),Math.min(origin.y,end.y),Math.min(origin.z,end.z)],
      [Math.max(origin.x,end.x),Math.max(origin.y,end.y),Math.max(origin.z,end.z)]);
    let closest=maxDistance;
    for(const id of candidates) {
      const tri=this.triangles[id],den=tri.normal.dot(direction);
      if(Math.abs(den)<1e-10)continue;
      const distance=tri.normal.dot(this.point.subVectors(tri.a,origin))/den;
      if(distance<0||distance>closest)continue;
      this.point.copy(origin).addScaledVector(direction,distance);this.triangle.set(tri.a,tri.b,tri.c);
      if(this.triangle.containsPoint(this.point))closest=distance;
    }
    return closest;
  }
}

export class Character {
  constructor(world,profile,start) {
    this.world=world;this.profile=sanitizeProfile(profile);
    this.position=new Vector3(...start);this.velocity=new Vector3();
    this.grounded=false;this.lastContacts=[];this.jumps=0;
    this.reset(start);
  }
  reset(start) {
    this.position.set(...start);this.velocity.set(0,0,0);this.jumps=0;
    this.world.resolve(this.position,this.profile,this.position);
    const floor=this.world.groundAt(this.position.x,this.position.y,this.position.z+0.1,this.position.z-0.15,this.profile.slopeDegrees);
    this.grounded=Number.isFinite(floor)&&this.position.z-floor<0.15;
  }
  step(dt,input) {
    const p=this.profile,previous=this.position.clone(),wasGrounded=this.grounded;
    const forward=input.forward||0,strafe=input.strafe||0;
    const magnitude=Math.hypot(forward,strafe),scale=magnitude>1?1/magnitude:1;
    const speed=forward<0?p.backwardSpeed:p.speed;
    const desired=new Vector3(Math.cos(input.yaw)*forward+Math.sin(input.yaw)*strafe,
      Math.sin(input.yaw)*forward-Math.cos(input.yaw)*strafe,0).multiplyScalar(speed*scale);
    if(this.grounded) {this.velocity.x=desired.x;this.velocity.y=desired.y;}
    else if(p.airSteering>0) {
      const blend=1-Math.exp(-p.airSteering*24*dt);
      this.velocity.x+=(desired.x-this.velocity.x)*blend;this.velocity.y+=(desired.y-this.velocity.y)*blend;
    }
    let jumped=false;
    if(input.jump&&this.grounded) {this.velocity.z=p.jumpSpeed;this.grounded=false;this.jumps++;jumped=true;}
    this.velocity.z-=p.gravity*dt;
    this.position.addScaledVector(this.velocity,dt);
    let contacts=this.world.resolve(this.position,p,previous);
    const wall=contacts.some(c=>Math.abs(c.normal.z)<0.35);
    // Step onto short floor changes while walking. A jump never receives a step.
    if(wasGrounded&&!jumped&&wall&&p.stepHeight>0&&magnitude>0) {
      const elevated=previous.clone();elevated.z+=p.stepHeight;
      elevated.x+=desired.x*dt;elevated.y+=desired.y*dt;
      const raisedContacts=this.world.resolve(elevated,p,previous);
      const floor=this.world.groundAt(elevated.x,elevated.y,elevated.z,elevated.z-p.stepHeight-0.06,p.slopeDegrees);
      if(Number.isFinite(floor)&&floor>previous.z+p.skin&&raisedContacts.every(c=>Math.abs(c.normal.z)>0.35)) {
        elevated.z=floor+p.skin;this.position.copy(elevated);contacts=raisedContacts;this.velocity.z=0;
      }
    }
    const minNormal=Math.cos(p.slopeDegrees*Math.PI/180);
    const airX=this.velocity.x,airY=this.velocity.y;
    this.grounded=false;
    for(const contact of contacts) {
      const n=contact.normal,dot=this.velocity.dot(n);
      if(dot<0)this.velocity.addScaledVector(n,-dot);
      if(n.z>=minNormal&&this.velocity.z<=0.2)this.grounded=true;
    }
    // Contact clips the attempted displacement. It must not erase the stored
    // airborne direction, otherwise pushing against the seam stops the entire
    // jump even after the rising body has cleared that contact.
    if(!this.grounded){this.velocity.x=airX;this.velocity.y=airY;}
    if(!jumped&&this.velocity.z<=0&&wasGrounded) {
      const ground=this.world.groundAt(this.position.x,this.position.y,this.position.z+p.skin,this.position.z-p.groundSnap,p.slopeDegrees);
      if(Number.isFinite(ground)){this.position.z=ground+p.skin;this.velocity.z=0;this.grounded=true;}
    }
    this.lastContacts=contacts;
    return {jumped,landed:!wasGrounded&&this.grounded,contacts};
  }
}
