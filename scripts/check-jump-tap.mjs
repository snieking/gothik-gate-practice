import assert from 'node:assert/strict';
import {CollisionWorld,Character,DEFAULT_PROFILE} from '../docs/physics.js';
import {loadSceneCollisionParts} from './scene-fixture.mjs';

const floor={name:'floor',positions:new Float64Array([-100,-100,0,100,-100,0,0,100,0]),indices:new Uint32Array([0,1,2])};
const world=new CollisionWorld([floor]),dt=1/240;
const character=new Character(world,DEFAULT_PROFILE,[0,0,.002]);
let landed=false,displacementBeforeTap=0,positionAfterRelease=0;
for(let i=0;i<240;i++) {
  const t=i*dt;
  const result=character.step(dt,{yaw:0,jump:i===0,forward:t>=.125&&t<.1875?1:0});
  if(t<.125)displacementBeforeTap=character.position.x;
  if(i===46)positionAfterRelease=character.position.x;
  if(result.landed){landed=true;break}
}
console.log(`Standing jump, W tapped for 62.5 ms after 125 ms: moved ${character.position.x.toFixed(6)} yd`);
assert.ok(landed,'The standing jump must land');
assert.equal(displacementBeforeTap,0,'A standing jump must rise vertically before W is pressed');
assert.ok(character.position.x>.01,'A W tap after stationary takeoff must move the airborne character');
assert.ok(character.position.x>positionAfterRelease+.1,'A standing jump must keep drifting after W is released');

const vertical=new Character(world,DEFAULT_PROFILE,[0,0,.002]);
for(let i=0;i<240;i++){const r=vertical.step(dt,{yaw:0,jump:i===0});if(r.landed)break}
assert.equal(vertical.position.x,0,'A standing jump without W must remain vertical');

const running=new Character(world,DEFAULT_PROFILE,[0,0,.002]);
for(let i=0;i<240;i++) {
  const r=running.step(dt,{yaw:i?Math.PI:0,jump:i===0,forward:i===0?1:0});
  if(r.landed)break;
}
assert.ok(running.position.x>character.position.x*2,'The standing nudge must be distinct from a running jump');
assert.ok(Math.abs(running.position.y)<1e-8,'Turning and releasing W must preserve the running jump direction');

const spaceFirst=new Character(world,DEFAULT_PROFILE,[0,0,.002]);
spaceFirst.step(dt,{yaw:0,jump:true,forward:1,jumpLaunch:{yaw:0,forward:0,strafe:0}});
assert.ok(spaceFirst.velocity.x<DEFAULT_PROFILE.speed,'Space before W in one browser frame must remain a standing takeoff');
const forwardFirst=new Character(world,DEFAULT_PROFILE,[0,0,.002]);
forwardFirst.step(dt,{yaw:0,jump:true,forward:1,jumpLaunch:{yaw:0,forward:1,strafe:0}});
assert.equal(forwardFirst.velocity.x,DEFAULT_PROFILE.speed,'W before Space must preserve a running takeoff');

const room=new Character(new CollisionWorld(loadSceneCollisionParts()),DEFAULT_PROFILE,[365.5,-106.45,-33.285]);
for(let i=0;i<120;i++)room.step(dt,{yaw:.05,forward:1});
const atBase=room.position.clone();let highest=atBase.z,roomLanded=false;
for(let i=0;i<240;i++) {
  const t=i*dt,r=room.step(dt,{yaw:.05,jump:i===0,forward:t>=.125&&t<.1875?1:0});
  highest=Math.max(highest,room.position.z);if(r.landed){roomLanded=true;break}
}
assert.ok(roomLanded&&room.grounded&&room.position.z>atBase.z+.8,'Jump then W tap must reach a supported ledge in the original room');
assert.ok(highest-atBase.z<=DEFAULT_PROFILE.jumpSpeed**2/(2*DEFAULT_PROFILE.gravity)+.002,'The ledge must not add upward jump energy');
const onLedge=room.position.clone();
for(let i=0;i<240;i++)room.step(dt,{yaw:.05});
assert.ok(room.position.distanceTo(onLedge)<.005,'Releasing W must leave a stable landing on the ledge');
console.log('PASS standing tap, retained drift, running inertia, Space/W order, original Gothik ledge');
