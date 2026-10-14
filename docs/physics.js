import {Vector3, Triangle} from './vendor/three.module.min.js';

// Original collision triangles remain separate from the visible mesh. This
// browser controller is a calibratable approximation, not Blizzard's solver.
export const DEFAULT_PROFILE = Object.freeze({
  speed:9.1, backwardSpeed:4.5, jumpSpeed:7.9555, gravity:19.2911,
  radius:0.27777779, height:2.25, stepHeight:0.4, slopeDegrees:50,
  skin:0.002, groundSnap:0.05, standingAirSpeed:1, airSteering:0, turnSpeed:2.3,
});
export const CONTROLLER_REVISION='standing-jump-v3';
export const PROFILE_LIMITS = Object.freeze({
  speed:[1,15], backwardSpeed:[1,15], jumpSpeed:[3,14], gravity:[8,40],
  radius:[0.12,0.8], height:[1,3.5], stepHeight:[0,0.8],
  slopeDegrees:[20,70], skin:[0.0001,0.03], groundSnap:[0.005,0.2],
  standingAirSpeed:[0.1,4], airSteering:[0,1], turnSpeed:[0.5,5],
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
  // A downward sweep of the bottom sphere finds support across its footprint.
  // Face, edge and vertex contacts are solved vertically, keeping X/Y fixed.
  // Ground contact must not turn gravity into sideways slope motion.
  supportAt(position,profile,up=0.03,down=0.06) {
    const radius=profile.radius,margin=radius+profile.skin;
    const low=position.z-down,high=position.z+up;
    const candidates=this.query([position.x-margin,position.y-margin,low-profile.skin],
      [position.x+margin,position.y+margin,high+radius+margin]);
    const minNormal=Math.cos(profile.slopeDegrees*Math.PI/180);
    let support=null;
    const accept=(centerZ,point,tri,id)=>{
      const feetZ=centerZ-radius;
      if(feetZ<low-1e-7||feetZ>high+1e-7||centerZ<point.z-1e-7||support&&feetZ<=support.z)return;
      const normal=new Vector3(position.x-point.x,position.y-point.y,centerZ-point.z).normalize();
      support={z:feetZ,normal,triangle:id,name:tri.name,depth:0};
    };
    for(const id of candidates) {
      const tri=this.triangles[id];
      if(Math.abs(tri.normal.z)<minNormal)continue;
      const n=tri.normal.z<0?tri.normal.clone().negate():tri.normal;
      const centerZ=tri.a.z-(n.x*(position.x-tri.a.x)+n.y*(position.y-tri.a.y))/n.z+margin/n.z;
      this.point.set(position.x,position.y,centerZ).addScaledVector(n,-margin);
      this.triangle.set(tri.a,tri.b,tri.c);
      if(this.triangle.containsPoint(this.point))accept(centerZ,this.point,tri,id);
      for(const [a,b] of [[tri.a,tri.b],[tri.b,tri.c],[tri.c,tri.a]]) {
        const ex=b.x-a.x,ey=b.y-a.y,ez=b.z-a.z,L=ex*ex+ey*ey+ez*ez;
        if(L<1e-12)continue;
        const dx=position.x-a.x,dy=position.y-a.y,h=dx*ex+dy*ey;
        const A=1-ez*ez/L,B=-2*h*ez/L,C=dx*dx+dy*dy-h*h/L-margin*margin;
        const discriminant=B*B-4*A*C;
        if(A>1e-10&&discriminant>=0) {
          const z=(-B+Math.sqrt(discriminant))/(2*A),t=(h+z*ez)/L;
          if(t>=0&&t<=1){this.point.set(a.x+ex*t,a.y+ey*t,a.z+ez*t);accept(a.z+z,this.point,tri,id)}
        }
      }
      for(const vertex of [tri.a,tri.b,tri.c]) {
        const d=(position.x-vertex.x)**2+(position.y-vertex.y)**2;
        if(d<=margin*margin)accept(vertex.z+Math.sqrt(margin*margin-d),vertex,tri,id);
      }
    }
    return support;
  }
  resolveHorizontal(position,profile,previous=position) {
    const contacts=[],radius=profile.radius,margin=radius+profile.skin;
    const minNormal=Math.cos(profile.slopeDegrees*Math.PI/180);
    for(let pass=0;pass<6;pass++) {
      let changed=false;
      const candidates=this.query([position.x-margin,position.y-margin,position.z-profile.skin],
        [position.x+margin,position.y+margin,position.z+profile.height+profile.skin]);
      for(const id of candidates) {
        const tri=this.triangles[id];
        this.bottom.set(position.x,position.y,position.z+radius);
        this.top.set(position.x,position.y,position.z+profile.height-radius);
        const distance=this.closestToCapsule(tri,this.bottom,this.top);
        if(distance>=margin-1e-8)continue;
        if(distance>1e-9)this.normal.subVectors(this.closestBody,this.closestMesh).divideScalar(distance);
        else {
          this.normal.copy(tri.normal);
          this.point.copy(previous).add(new Vector3(0,0,profile.height/2)).sub(tri.a);
          if(this.normal.dot(this.point)<0)this.normal.negate();
        }
        if(Math.abs(tri.normal.z)>=minNormal&&this.normal.z>0)continue;
        // Head-on floor/ceiling contacts belong to the vertical sweep.
        if(this.closestBody.z>=position.z+profile.height-radius-1e-6&&this.normal.z<-.25)continue;
        const horizontal=this.normal.x*this.normal.x+this.normal.y*this.normal.y;
        if(horizontal<1e-6)continue;
        const depth=margin-distance,correction=Math.min(depth/horizontal,margin*2);
        position.x+=this.normal.x*correction;position.y+=this.normal.y*correction;
        contacts.push({normal:new Vector3(this.normal.x,this.normal.y,0).normalize(),depth,triangle:id,name:tri.name});
        changed=true;
      }
      if(!changed)break;
    }
    return contacts;
  }
  ceilingAt(position,profile) {
    const radius=profile.radius,margin=radius+profile.skin,contacts=[];
    for(let pass=0;pass<4;pass++) {
      let changed=false;
      const candidates=this.query([position.x-margin,position.y-margin,position.z+profile.height-radius-margin],
        [position.x+margin,position.y+margin,position.z+profile.height+profile.skin]);
      this.top.set(position.x,position.y,position.z+profile.height-radius);
      for(const id of candidates) {
        const tri=this.triangles[id];this.triangle.set(tri.a,tri.b,tri.c);
        this.triangle.closestPointToPoint(this.top,this.closestMesh);
        const distance=this.top.distanceTo(this.closestMesh);
        if(distance>=margin-1e-8||distance<1e-10)continue;
        this.normal.subVectors(this.top,this.closestMesh).divideScalar(distance);
        if(this.normal.z>=-.25)continue;
        const depth=margin-distance;position.z-=depth/-this.normal.z;
        this.top.z=position.z+profile.height-radius;
        contacts.push({normal:this.normal.clone(),depth,triangle:id,name:tri.name});changed=true;
      }
      if(!changed)break;
    }
    return contacts;
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
    this.airMode='grounded';
    this.lastContacts=this.world.resolveHorizontal(this.position,this.profile,this.position.clone());
    const support=this.world.supportAt(this.position,this.profile,0.4,0.25);
    this.grounded=!!support;
    if(support){this.position.z=support.z;this.lastContacts.push(support)}
  }
  step(dt,input) {
    const p=this.profile,previous=this.position.clone(),wasGrounded=this.grounded;
    const forward=input.forward||0,strafe=input.strafe||0;
    const magnitude=Math.hypot(forward,strafe),scale=magnitude>1?1/magnitude:1;
    const speed=forward<0?p.backwardSpeed:p.speed;
    const desired=new Vector3(Math.cos(input.yaw)*forward+Math.sin(input.yaw)*strafe,
      Math.sin(input.yaw)*forward-Math.cos(input.yaw)*strafe,0).multiplyScalar(speed*scale);
    let jumped=false,nudged=false;
    if(input.jump&&this.grounded) {
      // Preserve the motion present when Space was pressed. A later W event
      // in the same browser frame must not turn this into a running takeoff.
      const launch=input.jumpLaunch||input,lf=launch.forward||0,ls=launch.strafe||0;
      const length=Math.hypot(lf,ls),launchSpeed=lf<0?p.backwardSpeed:p.speed;
      const facing=Number.isFinite(launch.yaw)?launch.yaw:input.yaw,normalize=length>1?1/length:1;
      this.velocity.set((Math.cos(facing)*lf+Math.sin(facing)*ls)*launchSpeed*normalize,
        (Math.sin(facing)*lf-Math.cos(facing)*ls)*launchSpeed*normalize,p.jumpSpeed);
      this.airMode=length>0?'running':'standing';
      this.grounded=false;this.jumps++;jumped=true;
    } else if(this.grounded) {this.velocity.x=desired.x;this.velocity.y=desired.y;}
    if(!this.grounded&&this.airMode==='standing'&&magnitude>0) {
      // Classic distinguishes horizontal initiation after a standing jump
      // from a running jump's launch momentum. The speed remains calibratable;
      // 1 yd/s is a provisional starting value, not a recovered client constant.
      const horizontal=Math.min(p.standingAirSpeed,desired.length());
      this.velocity.x=desired.x/desired.length()*horizontal;
      this.velocity.y=desired.y/desired.length()*horizontal;
      this.airMode='nudge';nudged=true;
    } else if(!this.grounded&&!jumped&&this.airMode==='running'&&p.airSteering>0) {
      const blend=1-Math.exp(-p.airSteering*24*dt);
      this.velocity.x+=(desired.x-this.velocity.x)*blend;this.velocity.y+=(desired.y-this.velocity.y)*blend;
    }
    this.position.x+=this.velocity.x*dt;this.position.y+=this.velocity.y*dt;
    const attempted=this.position.clone();
    let contacts=this.world.resolveHorizontal(this.position,p,previous);
    if(wasGrounded&&!jumped) {
      this.velocity.z=0;
      let support=this.world.supportAt(this.position,p,p.stepHeight,p.groundSnap);
      // A real floor must support a step. A wall alone cannot elevate the actor.
      if(contacts.length&&magnitude&&p.stepHeight>0) {
        const elevated=attempted.clone();elevated.z=previous.z+p.stepHeight;
        const raisedContacts=this.world.resolveHorizontal(elevated,p,previous);
        const raisedSupport=this.world.supportAt(elevated,p,0,p.stepHeight+p.groundSnap);
        const progress=point=>(point.x-previous.x)**2+(point.y-previous.y)**2;
        if(raisedSupport&&raisedSupport.z>previous.z+p.skin&&progress(elevated)>progress(this.position)+1e-10) {
          this.position.copy(elevated);support=raisedSupport;contacts=raisedContacts;
        }
      }
      this.grounded=!!support;
      if(support){this.position.z=support.z;contacts.push(support)}
    }
    if(!this.grounded) {
      const vertical=this.velocity.z*dt-.5*p.gravity*dt*dt;
      this.position.z=previous.z+vertical;this.velocity.z-=p.gravity*dt;
      if(vertical<=0) {
        const atPreviousHeight=this.position.clone();atPreviousHeight.z=previous.z;
        const support=this.world.supportAt(atPreviousHeight,p,p.skin,-vertical+p.skin);
        if(support&&support.z>=this.position.z-p.skin){this.position.z=support.z;this.velocity.z=0;this.grounded=true;contacts.push(support)}
      } else {
        const ceilings=this.world.ceilingAt(this.position,p);
        if(ceilings.length){this.velocity.z=0;contacts.push(...ceilings)}
      }
      contacts.push(...this.world.resolveHorizontal(this.position,p,previous));
    }
    this.lastContacts=contacts;
    const landed=!wasGrounded&&this.grounded;
    if(this.grounded)this.airMode='grounded';
    else if(wasGrounded&&!jumped)this.airMode='running';
    return {jumped,nudged,landed,contacts};
  }
}
