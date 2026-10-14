import assert from 'node:assert/strict';
import {CollisionWorld,Character,DEFAULT_PROFILE} from '../docs/physics.js';
import {loadSceneCollisionParts} from './scene-fixture.mjs';

const parts=loadSceneCollisionParts();
let collisionParts=parts;
if(process.argv.includes('--local')) {
  collisionParts=parts.filter(part=>part.name==='wmo-17').map(part=>{
    const kept=[];
    for(let i=0;i<part.indices.length;i+=3){
      const ids=[part.indices[i],part.indices[i+1],part.indices[i+2]],p=part.positions;
      const ranges=[ids.map(n=>p[n*3]),ids.map(n=>p[n*3+1]),ids.map(n=>p[n*3+2])];
      if(ranges.every((range,k)=>Math.max(...range)>=[370.3,-106.7,-33.5][k]&&Math.min(...range)<=[371.7,-105.5,-29.5][k]))kept.push(...ids);
    }
    return {...part,indices:new Uint32Array(kept)};
  });
}
const world=new CollisionWorld(collisionParts),dt=1/240;
const run=(character,seconds,input={yaw:.3})=>{for(let i=0;i<Math.round(seconds/dt);i++)character.step(dt,input)};

for(const radius of [.15,DEFAULT_PROFILE.radius]) {
  const ledge=new Character(world,{...DEFAULT_PROFILE,radius},[370.8909831713,-106.1320700658,-31.7630334139]);
  const original=ledge.position.clone();run(ledge,10);
  const horizontalDrift=Math.hypot(ledge.position.x-original.x,ledge.position.y-original.y);
  console.log(`Idle ledge (${radius.toFixed(3)} radius), ${world.triangles.length} triangles: drift=${horizontalDrift.toFixed(6)}, height loss=${(original.z-ledge.position.z).toFixed(6)}`);
  assert.ok(horizontalDrift<.005,'Standing still on the ledge must not drift horizontally');
  assert.ok(Math.abs(ledge.position.z-original.z)<.02,'Standing still on the ledge must not slide down');
  assert.ok(ledge.grounded,'The ledge must remain a valid standing surface');
  run(ledge,.1,{yaw:Math.PI,forward:1});
  assert.ok(!ledge.grounded,'Moving off the ledge must remove support');
  assert.ok(ledge.position.z<original.z-.015,'An unsupported character must fall rather than hover');
}

const floor={name:'flat-floor',positions:new Float64Array([-20,-20,0,20,-20,0,20,20,0,-20,20,0]),indices:new Uint32Array([0,1,2,0,2,3])};
const wall={name:'vertical-wall',positions:new Float64Array([2,-20,0,2,20,0,2,20,8,2,-20,8]),indices:new Uint32Array([0,1,2,0,2,3])};
const ceiling={...floor,name:'low-ceiling',positions:Float64Array.from(floor.positions,(n,i)=>i%3===2?3:n)};
const jumpTest=parts=>{
  const c=new Character(new CollisionWorld(parts),DEFAULT_PROFILE,[0,0,.002]);
  const initial=c.position.z;let apex=0,landed=false;
  for(let i=0;i<360;i++){
    const result=c.step(dt,{yaw:0,forward:1,jump:i===0});
    apex=Math.max(apex,c.position.z-initial);if(result.landed){landed=true;break}
  }
  return {c,apex,landed};
};
const free=jumpTest([floor]),blocked=jumpTest([floor,wall]);
const underCeiling=jumpTest([floor,ceiling]);
const expected=DEFAULT_PROFILE.jumpSpeed**2/(2*DEFAULT_PROFILE.gravity);
assert.ok(Math.abs(free.apex-expected)<.002,'Free jump must follow its ballistic arc');
assert.ok(blocked.apex<=free.apex+.002,'Wall contact must not add jump height');
assert.ok(blocked.c.position.x<2-DEFAULT_PROFILE.radius,'A closed wall must block the moving actor');
assert.ok(free.landed&&blocked.landed,'Both jumps must land');
assert.equal(blocked.c.velocity.z,0,'Landing must stop downward velocity');
assert.ok(underCeiling.apex<=3-DEFAULT_PROFILE.height+.002,'A low ceiling must stop ascent');
assert.ok(underCeiling.landed,'The character must land after hitting a ceiling');
console.log(`PASS stable ledge, walk-off fall, blocked wall, jump apex ${free.apex.toFixed(5)} yd`);
