import * as THREE from './vendor/three.module.min.js';
import {CollisionWorld,Character,DEFAULT_PROFILE,PROFILE_LIMITS,sanitizeProfile,CONTROLLER_REVISION} from './physics.js?v=5';
import {createNightElf} from './character.js?v=5';
import {setupEraComparison} from './recording.js?v=5';

const $=selector=>document.querySelector(selector);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const BASE='assets/scene/';
const readSaved=()=>{try{return JSON.parse(localStorage.getItem('gothik.calibration.v2'))||{}}catch{return {}}};
const saved=readSaved();
let profile=sanitizeProfile(saved.profile),gateOffset=(Array.isArray(saved.gateOffset)&&saved.gateOffset.length===3?saved.gateOffset:[0,0,0]).map(n=>clamp(Number(n)||0,-1,1));
let sensitivity=clamp(Number(saved.sensitivity)||.0025,.0005,.006);
let cameraMode=['first','third','overview'].includes(saved.cameraMode)?saved.cameraMode:'third';
let startPoint=saved.startPoint==='ledge'?'ledge':'approach';
let manifest,world,character,gateInstance,meshParts=[],gateMesh,avatar,nightElf,traceLine,collisionLines=[];
let renderer,camera,scene,last=performance.now(),accumulator=0,uiLast=0;
let status='loading',attempt=1,elapsed=0,yaw=.05,cameraYaw=.05,pitch=.12,cameraDistance=7;
const startPresets={approach:[365.5,-106.45,-33.285],ledge:[370.8909831713,-106.1320700658,-31.7630334139]};
let start=[...startPresets[startPoint]],attemptStart=[...start],lastTrace=null,traceVisible=false,trace=[],events=[],traceClock=0;
let ledgeReached=false,gapReached=false,jumpPending=false,mouseButtons=0,pointer=null,unlockExpected=false,pauseOwner=null;
const keys=new Set(),logs=[];
const minimap=$('#minimap').getContext('2d');
const diagnostics=document.createElement('div');diagnostics.className='diagnostics';diagnostics.hidden=true;$('#viewport').append(diagnostics);
const traceSummary=document.createElement('div');traceSummary.className='trace-summary';traceSummary.hidden=true;$('#viewport').append(traceSummary);
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${(n%60).toFixed(1).padStart(4,'0')}`;
const rounded=v=>Math.round(v*1000000)/1000000;

function log(message,type='notice') {
  logs.push({time:elapsed,message,type});if(logs.length>6)logs.shift();
  $('#log').replaceChildren(...logs.map(entry=>{const li=document.createElement('li');li.className=entry.type;
    const time=document.createElement('time');time.textContent=clock(entry.time);li.append(time,document.createTextNode(entry.message));return li}));
}
let toastUntil=0;
function toast(text){$('#toast').textContent=text;toastUntil=performance.now()+2400}
function clearInput(){keys.clear();mouseButtons=0;pointer=null;jumpPending=false;}
function releaseCursor(){if(document.pointerLockElement){unlockExpected=true;document.exitPointerLock()}clearInput()}
function save(){try{localStorage.setItem('gothik.calibration.v2',JSON.stringify({profile,gateOffset,sensitivity,cameraMode,startPoint}))}catch{}}
function traceRecord(kind,detail={}) {events.push({t:rounded(elapsed),kind,...detail})}
function getGatePosition(){return gateInstance.position.map((n,i)=>n+gateOffset[i])}

async function getJSON(path){const response=await fetch(path);if(!response.ok)throw new Error(`Could not load ${path}: ${response.status}`);return response.json()}
async function getBuffer(path){const response=await fetch(path);if(!response.ok)throw new Error(`Could not load ${path}: ${response.status}`);return response.arrayBuffer()}
function view(buffer,descriptor){
  const types={Float32:Float32Array,Uint32:Uint32Array,Uint8:Uint8Array};const Type=types[descriptor.type];
  if(!Type||descriptor.byteOffset%Type.BYTES_PER_ELEMENT)throw new Error('Invalid scene buffer descriptor');
  return new Type(buffer,descriptor.byteOffset,descriptor.count*descriptor.itemSize);
}
function geometryFrom(buffer,mesh,collision=false) {
  const g=new THREE.BufferGeometry(),attributes=collision?{position:mesh.collision.position}:mesh.attributes;
  for(const [name,descriptor] of Object.entries(attributes))g.setAttribute(name,new THREE.BufferAttribute(view(buffer,descriptor),descriptor.itemSize));
  g.setIndex(new THREE.BufferAttribute(view(buffer,collision?mesh.collision.index:mesh.index),1));
  if(!collision){for(const group of mesh.groups)g.addGroup(group.start,group.count,group.materialIndex)}
  g.computeBoundingSphere();return g;
}
function transformPositions(source,instance) {
  const out=new Float64Array(source.length),angle=instance.rotationZ||0,c=Math.cos(angle),s=Math.sin(angle),scale=instance.scale||1;
  const position=instance.mesh==='gate'?getGatePosition():instance.position;
  for(let i=0;i<source.length;i+=3){out[i]=(source[i]*c-source[i+1]*s)*scale+position[0];out[i+1]=(source[i]*s+source[i+1]*c)*scale+position[1];out[i+2]=source[i+2]*scale+position[2]}
  return out;
}
function rebuildWorld() {
  const parts=meshParts.map(part=>({name:part.mesh.id,positions:transformPositions(view(part.buffer,part.mesh.collision.position),part.instance),indices:view(part.buffer,part.mesh.collision.index)}));
  world=new CollisionWorld(parts);
  for(const line of collisionLines){scene.remove(line);line.geometry.dispose();line.material.dispose()}
  collisionLines=[];
  for(const part of parts) {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(part.positions),3));g.setIndex(new THREE.BufferAttribute(part.indices,1));
    const material=new THREE.MeshBasicMaterial({color:part.name==='gate'?0xf1c664:0x60d5df,wireframe:true,transparent:true,opacity:.45,depthTest:false});
    const mesh=new THREE.Mesh(g,material);mesh.visible=$('#collision-toggle').checked;mesh.renderOrder=20;scene.add(mesh);collisionLines.push(mesh);
  }
  gateMesh.position.set(...getGatePosition());
  let ground=world.groundAt(start[0],start[1],-28,-36,profile.slopeDegrees);
  if(startPoint==='approach'&&Number.isFinite(ground))start[2]=ground+profile.skin;
  character=new Character(world,profile,start);
}
async function loadRoom() {
  renderer=new THREE.WebGLRenderer({canvas:$('#scene'),antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setClearColor(0x1d182b);scene=new THREE.Scene();scene.fog=new THREE.Fog(0x241b30,65,175);
  camera=new THREE.PerspectiveCamera(65,1,.03,230);camera.up.set(0,0,1);
  manifest=await getJSON(`${BASE}manifest.json`);
  if(manifest.schema!=='gothik-client-scene-v1')throw new Error('Unsupported room manifest');
  gateInstance=manifest.instances.find(instance=>instance.mesh==='gate');
  if(!gateInstance)throw new Error('Gate placement is missing');
  const loader=new THREE.TextureLoader(),textures=new Map();
  await Promise.all(manifest.textures.map(async t=>{
    const texture=await loader.loadAsync(`${BASE}${t.file}`);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);textures.set(t.fileDataID,texture);
  }));
  const materialIds=manifest.materials.map(m=>m.id),materials=manifest.materials.map(m=>new THREE.MeshBasicMaterial({
    map:textures.get(m.textureFileDataID),side:THREE.DoubleSide,vertexColors:typeof m.id==='number',
    color:typeof m.id==='number'?0xffffff:0xafa8e4,alphaTest:m.blendMode===1?.5:0,
    transparent:m.blendMode>1,depthWrite:m.blendMode<=1,
  }));
  await Promise.all(manifest.meshes.map(async mesh=>{
    const buffer=await getBuffer(`${BASE}${mesh.buffer}`);
    for(const group of mesh.groups)group.materialIndex=materialIds.indexOf(group.material);
    if(mesh.groups.some(g=>g.materialIndex<0))throw new Error('Missing room material');
    const geometry=geometryFrom(buffer,mesh);
    for(const instance of manifest.instances.filter(i=>i.mesh===mesh.id)) {
      const visible=new THREE.Mesh(geometry,materials);
      visible.position.set(...instance.position);visible.rotation.z=instance.rotationZ||0;visible.scale.setScalar(instance.scale||1);scene.add(visible);
      meshParts.push({mesh,buffer,instance});if(mesh.id==='gate')gateMesh=visible;
    }
  }));
  $('#load-status').textContent='Loading the original Night Elf female and animations';
  nightElf=await createNightElf();avatar=nightElf.object3D;renderPortrait();scene.add(avatar);
  rebuildWorld();resize();reset(false);status='ready';
  $('#begin-button').disabled=false;$('#begin-button').textContent='Enter practice';$('#load-status').textContent=`Original Era room · ${world.triangles.length.toLocaleString()} collision triangles`;
  document.querySelectorAll('[data-needs-room]').forEach(control=>control.disabled=false);
  $('#viewport').setAttribute('aria-busy','false');log('Original room loaded. Right mouse steers your character.');
  requestAnimationFrame(frame);
}

function renderPortrait() {
  const portraitRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true});portraitRenderer.setSize(144,144);portraitRenderer.outputColorSpace=THREE.SRGBColorSpace;
  const portraitScene=new THREE.Scene(),portraitCamera=new THREE.OrthographicCamera(-.43,.43,.43,-.43,.1,10);
  portraitCamera.up.set(0,0,1);portraitCamera.position.set(3,-.04,2.08);portraitCamera.lookAt(0,0,1.95);
  portraitScene.add(avatar);nightElf.update(0,{grounded:true,speed:0,moving:false,yaw:0,camera:portraitCamera});
  portraitRenderer.render(portraitScene,portraitCamera);
  const portrait=$('#character-portrait');portrait.src=portraitRenderer.domElement.toDataURL('image/png');portrait.hidden=false;
  $('#portrait-placeholder').remove();portraitRenderer.dispose();nightElf.reset();
}

function completeTrace(reason) {
  if(!trace.length)return;
  lastTrace={schema:'gothik-attempt-v1',controller:CONTROLLER_REVISION,client:manifest.client,gate:{placement:[...gateInstance.position],rotationZ:gateInstance.rotationZ,scale:gateInstance.scale,offset:[...gateOffset]},
    profile:{...profile},start:attemptStart,result:reason,duration:rounded(elapsed),jumps:character.jumps,events:events.map(e=>({...e})),samples:trace.map(s=>({...s}))};
  renderTrace();
}
function reset(run=true) {
  if(character&&trace.length)completeTrace(status==='complete'?'cleared':'restarted');
  releaseCursor();elapsed=0;traceClock=0;trace=[];events=[];ledgeReached=false;gapReached=false;accumulator=0;
  start=[...startPresets[startPoint]];const floor=world.groundAt(start[0],start[1],-28,-36,profile.slopeDegrees);if(startPoint==='approach'&&Number.isFinite(floor))start[2]=floor+profile.skin;
  yaw=startPoint==='ledge'?.3:.05;cameraYaw=yaw;pitch=.12;character?.reset(start);nightElf?.reset();attemptStart=character.position.toArray();
  if(startPoint==='ledge'&&character.position.z>-32.6)ledgeReached=true;
  status=run?'running':'ready';$('#opening').hidden=run;$('#paused').hidden=true;$('#result').hidden=true;
  if(run){attempt++;traceRecord('start');log(`Attempt ${attempt}. Find the right-hand ledge.`);$('#viewport').focus({preventScroll:true})}
  updateHUD();
}
function pause(reason='manual') {
  if(status!=='running')return;status='paused';pauseOwner=reason;releaseCursor();$('#paused').hidden=reason==='dialog';traceRecord('pause',{reason});updateHUD();
}
function resume() {
  if(status!=='paused')return;status='running';pauseOwner=null;$('#paused').hidden=true;accumulator=0;last=performance.now();
  clearInput();traceRecord('resume');$('#viewport').focus({preventScroll:true});updateHUD();
}
function begin(){if(status==='ready'){status='running';$('#opening').hidden=true;traceRecord('start');$('#viewport').focus({preventScroll:true});log('Approach the right stone ledge, then work into the gap.');updateHUD()}}
function finish() {
  status='complete';traceRecord('clear');completeTrace('cleared');releaseCursor();log('Gate cleared in this prototype. Compare this attempt in Era.','success');
  $('#result-attempt').textContent=`ATTEMPT ${attempt}`;$('#result-title').textContent='Gate cleared.';
  $('#result-detail').textContent='You reached the far side of the closed gate.';
  const stats=[['Time',`${elapsed.toFixed(2)}s`],['Jumps',String(character.jumps)],['Facing',`${(yaw*180/Math.PI%360+360)%360|0}°`]];
  $('#result-stats').replaceChildren(...stats.map(([label,value])=>{const span=document.createElement('span'),strong=document.createElement('strong');strong.textContent=value;span.append(strong,document.createTextNode(label));return span}));
  $('#result').hidden=false;updateHUD();
}

function movementInput() {
  let forward=(keys.has('KeyW')||keys.has('ArrowUp')||mouseButtons===3?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
  let strafe=(keys.has('KeyE')?1:0)-(keys.has('KeyQ')?1:0),turn=0;
  if(mouseButtons&2)strafe+=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  else turn=(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)-(keys.has('KeyD')||keys.has('ArrowRight')?1:0);
  return {forward,strafe,turn,yaw};
}
function queueJump(){if(!jumpPending)jumpPending=movementInput()}
function input(){const controls=movementInput(),jumpLaunch=jumpPending||null;jumpPending=false;return {...controls,jump:!!jumpLaunch,jumpLaunch}}
function tick(dt) {
  const controls=input();
  if(controls.turn){yaw+=controls.turn*profile.turnSpeed*dt;cameraYaw=yaw;controls.yaw=yaw}
  const update=character.step(dt,controls);elapsed+=dt;traceClock+=dt;
  const speed=Math.hypot(character.velocity.x,character.velocity.y);
  const moving=character.grounded?!!(controls.forward||controls.strafe):speed>.025;
  nightElf.update(dt,{...update,grounded:character.grounded,moving,backward:controls.forward<0,
    speed,yaw,movementAngle:Math.atan2(character.velocity.y,character.velocity.x),verticalSpeed:character.velocity.z,camera});
  if(update.jumped){traceRecord('jump',{position:character.position.toArray().map(rounded),yaw:rounded(yaw),launch:controls.jumpLaunch,mode:character.airMode});log(`Jump ${character.jumps}. ${character.airMode==='standing'||character.airMode==='nudge'?'Standing takeoff.':'Running takeoff.'}`)}
  if(update.nudged)traceRecord('air-nudge',{position:character.position.toArray().map(rounded),yaw:rounded(yaw),speed:rounded(speed)});
  if(update.landed)traceRecord('land',{position:character.position.toArray().map(rounded)});
  if(traceClock>=1/60){traceClock%=1/60;trace.push({t:rounded(elapsed),x:rounded(character.position.x),y:rounded(character.position.y),z:rounded(character.position.z),yaw:rounded(yaw),grounded:character.grounded,input:{forward:controls.forward,strafe:controls.strafe}});if(trace.length>36000)trace.shift()}
  const gate=getGatePosition(),pos=character.position;
  const roomFloor=-33.285;
  if(!ledgeReached&&character.grounded&&pos.z>roomFloor+.65&&pos.x>gate[0]-3&&pos.y<gate[1]-5){ledgeReached=true;traceRecord('ledge');log('On the right ledge. Work into the wall/gate seam.','success');toast('Right ledge reached')}
  if(ledgeReached&&!gapReached&&pos.x>gate[0]-.95&&pos.y<gate[1]-6.4&&pos.y>gate[1]-8.2){gapReached=true;traceRecord('gap');log('At the seam. Adjust your facing for the next jump.','success');toast('Line up your jump')}
  if(ledgeReached&&pos.x>gate[0]+2.1&&pos.x<gate[0]+18&&Math.abs(pos.y-gate[1])<13&&character.grounded&&pos.z<roomFloor+.65)finish();
  if(pos.z<start[2]-5||pos.x<gate[0]-50||pos.x>gate[0]+30||Math.abs(pos.y-gate[1])>40){completeTrace('out-of-area');log('Outside the practice area. Approach reset.','error');reset(true)}
}

function updateCamera() {
  const pos=character.position,head=pos.clone().add(new THREE.Vector3(0,0,1.95));
  const forward=new THREE.Vector3(Math.cos(cameraYaw)*Math.cos(pitch),Math.sin(cameraYaw)*Math.cos(pitch),-Math.sin(pitch));
  if(cameraMode==='overview') {
    const gate=getGatePosition();camera.position.set(gate[0]-18,gate[1]-19,gate[2]+18);camera.lookAt(new THREE.Vector3(gate[0],gate[1]-2,gate[2]+3));avatar.visible=true;
  } else if(cameraMode==='first') {camera.position.copy(head);camera.lookAt(head.clone().add(forward));avatar.visible=false;}
  else {
    const backward=forward.clone().negate(),distance=world.raycast(head,backward,cameraDistance);
    camera.position.copy(head).addScaledVector(backward,Math.max(.1,Math.min(cameraDistance,distance-.12)));
    camera.lookAt(head.clone().add(forward));avatar.visible=true;
  }
  avatar.position.copy(pos);avatar.rotation.z=yaw;
}
function resize(){if(!renderer)return;const box=$('#viewport').getBoundingClientRect();renderer.setSize(box.width,box.height,false);camera.aspect=box.width/box.height;camera.updateProjectionMatrix()}
function frame(now) {
  const delta=Math.min((now-last)/1000,.075);last=now;
  if(status==='running') {accumulator+=delta;let steps=0;while(accumulator>=1/240&&steps++<20&&status==='running'){tick(1/240);accumulator-=1/240}}
  else {accumulator=0;if(status==='ready')nightElf.update(delta,{grounded:character.grounded,yaw,speed:0,moving:false,camera})}
  updateCamera();renderer.render(scene,camera);
  if(now-uiLast>80){updateHUD();uiLast=now}
  if(toastUntil&&now>toastUntil){$('#toast').textContent='';toastUntil=0}
  requestAnimationFrame(frame);
}
function updateHUD() {
  if(!character)return;
  const state=status==='paused'?'Paused':status==='complete'?'Gate cleared':status==='ready'?'Ready':character.grounded?'Standing':character.airMode==='standing'?'Standing jump':character.airMode==='nudge'?'Jump + W nudge':'Running jump';
  $('#movement-state').textContent=state;$('#elapsed').textContent=clock(elapsed);$('#attempt-number').textContent=`ATTEMPT ${attempt}`;
  $('#heading').textContent=`Facing ${((yaw*180/Math.PI%360+360)%360).toFixed(1)}°`;
  const aboveFloor=character.position.z+33.285;
  $('#height').textContent=`Height ${aboveFloor>=0?'+':''}${aboveFloor.toFixed(2)}`;
  [...$('#checklist').children].forEach((li,i)=>li.classList.toggle('done',[ledgeReached,gapReached,status==='complete'][i]));
  $('#coach').textContent=character.airMode==='standing'?'You are rising straight up. Tap W to start a small forward drift.':gapReached?'Make a small facing adjustment, then jump forward through the seam.':ledgeReached?'Work into the wall/gate seam. Use Space first, then tap W for a short jump.':'Get close to the plinth. Press Space first, then tap W once airborne.';
  $('#pause-button').querySelector('span').textContent=status==='paused'?'▶':'Ⅱ';
  diagnostics.hidden=!$('#diagnostics-toggle').checked;
  const p=character.position;diagnostics.textContent=`WMO X ${p.x.toFixed(5)}\nWMO Y ${p.y.toFixed(5)}\nWMO Z ${p.z.toFixed(5)}\nVertical ${character.velocity.z.toFixed(4)}\nHorizontal ${Math.hypot(character.velocity.x,character.velocity.y).toFixed(4)}\nGrounded ${character.grounded?'yes':'no'}\nJump mode ${character.airMode}\nContacts ${character.lastContacts.length}\nRadius ${profile.radius.toFixed(3)} · Height ${profile.height.toFixed(3)}\nAnimation ${nightElf.animationName}\nRun speed ${profile.speed.toFixed(2)} yd/s\nFixed step 240 Hz`;
  updateMinimap();
}
function updateMinimap() {
  const ctx=minimap,w=180,h=180,gate=getGatePosition(),scale=4.4;
  const map=(x,y)=>[90+(y-gate[1])*scale,90-(x-gate[0])*scale];
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#2f293c';ctx.fillRect(0,0,w,h);
  ctx.save();ctx.beginPath();ctx.arc(90,90,88,0,Math.PI*2);ctx.clip();
  ctx.strokeStyle='#494151';ctx.lineWidth=1;
  for(let i=-4;i<=4;i++){ctx.beginPath();ctx.moveTo(0,90+i*22);ctx.lineTo(180,90+i*22);ctx.stroke();ctx.beginPath();ctx.moveTo(90+i*22,0);ctx.lineTo(90+i*22,180);ctx.stroke()}
  ctx.fillStyle='#63576c';ctx.fillRect(0,85,59,10);ctx.fillRect(121,85,59,10);
  ctx.strokeStyle='#d1ad6f';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(...map(gate[0],gate[1]-7));ctx.lineTo(...map(gate[0],gate[1]+7));ctx.stroke();
  if(traceVisible&&lastTrace){ctx.strokeStyle='#94bfa4';ctx.lineWidth=1.5;ctx.beginPath();lastTrace.samples.forEach((p,i)=>{const [x,y]=map(p.x,p.y);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke()}
  const [x,y]=map(character.position.x,character.position.y);ctx.translate(x,y);ctx.rotate(-yaw);
  ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(-4,5);ctx.lineTo(0,3);ctx.lineTo(4,5);ctx.closePath();ctx.fillStyle='#f0d775';ctx.fill();ctx.strokeStyle='#38250f';ctx.lineWidth=1;ctx.stroke();ctx.restore();
}
function renderTrace() {
  if(traceLine){scene.remove(traceLine);traceLine.geometry.dispose();traceLine.material.dispose();traceLine=null}
  if(!lastTrace)return;
  const positions=lastTrace.samples.flatMap(p=>[p.x,p.y,p.z+.1]);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  traceLine=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x9ad8a8,transparent:true,opacity:.8,depthTest:false}));traceLine.visible=traceVisible;traceLine.renderOrder=21;scene.add(traceLine);
}
function toggleTrace(force){traceVisible=typeof force==='boolean'?force:!traceVisible;if(!lastTrace&&trace.length)completeTrace('in-progress');
  if(!lastTrace){toast('Make an attempt first. Its path will appear here.');traceVisible=false}
  if(traceLine)traceLine.visible=traceVisible;$('#trace-button').setAttribute('aria-pressed',String(traceVisible));traceSummary.hidden=!traceVisible;
  traceSummary.textContent=lastTrace?`Last attempt · ${lastTrace.duration.toFixed(2)}s · ${lastTrace.jumps} jumps · ${lastTrace.result}`:'';
}
function cycleCamera(){cameraMode={first:'third',third:'overview',overview:'first'}[cameraMode];$('#camera-select').value=cameraMode;save();toast(`${{first:'First person',third:'Third person',overview:'Room overview'}[cameraMode]} camera`)}
function openDialog(dialog){if(status==='running')pause('dialog');releaseCursor();dialog.showModal()}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function profileSnapshot(){return {schema:'gothik-calibration-v1',controller:CONTROLLER_REVISION,profile:{...profile},gateOffset:[...gateOffset],sensitivity,cameraMode,startPoint,client:manifest?.client}}
const speedPreset=value=>{const preset=[7,8.4,9.1,9.31,9.52].find(n=>Math.abs(n-value)<.001);return preset===undefined?'custom':String(preset)};
const fieldNames={speed:['Run speed','yd/s'],backwardSpeed:['Backward speed','yd/s'],jumpSpeed:['Jump velocity','unverified · yd/s'],gravity:['Gravity','emulator reference'],radius:['Collider radius','unverified · yd'],height:['Collider height','unverified · yd'],stepHeight:['Step height','unverified · yd'],slopeDegrees:['Ground slope limit','unverified · degrees'],skin:['Contact margin','unverified · yd'],groundSnap:['Ground snap','unverified · yd'],standingAirSpeed:['Standing jump nudge speed','provisional · yd/s'],airSteering:['Running jump air steering','0 locked · 1 responsive'],turnSpeed:['Keyboard turn rate','radians/s']};
function renderProfileFields(draft={}){
  const values=draft.profile||profile,offset=draft.gateOffset||gateOffset;
  $('#profile-fields').replaceChildren(...Object.keys(DEFAULT_PROFILE).map(key=>{const label=document.createElement('label');label.append(document.createTextNode(fieldNames[key][0]));const input=document.createElement('input');input.id=`profile-${key}`;input.type='number';input.value=String(values[key]);input.min=PROFILE_LIMITS[key][0];input.max=PROFILE_LIMITS[key][1];input.step=['skin','groundSnap'].includes(key)?'.001':['radius','height','stepHeight','airSteering'].includes(key)?'.01':'.1';const small=document.createElement('small');small.textContent=fieldNames[key][1];label.append(input,small);return label}));
  ['x','y','z'].forEach((axis,i)=>$(`#gate-${axis}`).value=offset[i]);$('#sensitivity').value=draft.sensitivity??sensitivity;$('#camera-select').value=draft.cameraMode||cameraMode;
  $('#start-select').value=draft.startPoint||startPoint;
  $('#speed-preset').value=speedPreset(values.speed);
}
function applyProfile() {
  profile=sanitizeProfile(Object.fromEntries(Object.keys(DEFAULT_PROFILE).map(key=>[key,$(`#profile-${key}`).value])));
  gateOffset=['x','y','z'].map(axis=>clamp(Number($(`#gate-${axis}`).value)||0,-1,1));
  sensitivity=clamp(Number($('#sensitivity').value),.0005,.006);cameraMode=$('#camera-select').value;
  startPoint=$('#start-select').value==='ledge'?'ledge':'approach';$('#opening-start').value=startPoint;
  completeTrace('profile-changed');rebuildWorld();
  renderProfileFields();save();$('#calibration').close();reset(true);toast('Calibration applied. Approach reset.');log('Movement calibration changed. Compare with the real client.');
  $('#opening-speed').value=speedPreset(profile.speed);
}

window.addEventListener('resize',resize);
window.addEventListener('blur',()=>{if(status==='running')pause('focus');clearInput()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&status==='running')pause('focus')});
document.addEventListener('keydown',event=>{
  if(event.target.closest('input,select,textarea')||document.querySelector('dialog[open]'))return;
  const code=event.code;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE'].includes(code))event.preventDefault();
  if(event.repeat)return;
  if(!character)return;
  if(code==='Enter'&&status==='ready'){begin();return}
  if(code==='KeyR'&&status!=='loading'){reset(true);return}
  if(code==='KeyP'){status==='running'?pause():resume();return}
  if(code==='KeyV'){cycleCamera();return}
  if(code==='KeyT'){toggleTrace();return}
  if(code==='Escape'){if(status==='running')pause();return}
  if(status!=='running')return;
  keys.add(code);traceRecord('key-down',{code});if(code==='Space')queueJump();
});
document.addEventListener('keyup',event=>{if(keys.delete(event.code)&&status==='running')traceRecord('key-up',{code:event.code})});
const canvas=$('#scene');
canvas.addEventListener('contextmenu',event=>event.preventDefault());
canvas.addEventListener('pointerdown',event=>{
  if(status!=='running')return;event.preventDefault();$('#viewport').focus({preventScroll:true});
  if(event.button===0)mouseButtons|=1;if(event.button===2){mouseButtons|=2;yaw=cameraYaw}
  pointer={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);
  if(event.button===2&&!document.pointerLockElement&&canvas.requestPointerLock) {
    try {const request=canvas.requestPointerLock();request?.catch(()=>{});}catch{}
  }
  traceRecord('mouse-down',{button:event.button});
});
document.addEventListener('pointermove',event=>{
  if(status!=='running'||!mouseButtons)return;
  const locked=document.pointerLockElement===canvas;
  const dx=locked?event.movementX:(pointer?event.clientX-pointer.x:0),dy=locked?event.movementY:(pointer?event.clientY-pointer.y:0);
  if(pointer){pointer.x=event.clientX;pointer.y=event.clientY}
  cameraYaw-=dx*sensitivity;pitch=clamp(pitch+dy*sensitivity,-1.1,1.3);
  if(mouseButtons&2)yaw=cameraYaw;
});
document.addEventListener('pointerup',event=>{
  if(event.button===0)mouseButtons&=~1;if(event.button===2)mouseButtons&=~2;
  if(status==='running')traceRecord('mouse-up',{button:event.button});
  if(!mouseButtons){pointer=null;if(document.pointerLockElement){unlockExpected=true;document.exitPointerLock()}}
});
canvas.addEventListener('pointercancel',()=>clearInput());
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement){if(!unlockExpected&&status==='running')pause('cursor');unlockExpected=false;clearInput()}});
canvas.addEventListener('wheel',event=>{event.preventDefault();if(cameraMode==='overview')return;cameraDistance=clamp(cameraDistance+event.deltaY*.008,.1,17);cameraMode=cameraDistance<.5?'first':'third';$('#camera-select').value=cameraMode;save()},{passive:false});
$('#begin-button').addEventListener('click',begin);$('#resume-button').addEventListener('click',resume);
$('#opening-start').value=startPoint;
$('#opening-start').addEventListener('change',event=>{startPoint=event.target.value==='ledge'?'ledge':'approach';save();reset(false)});
$('#opening-speed').value=speedPreset(profile.speed);
$('#opening-speed').addEventListener('change',event=>{if(event.target.value==='custom')return;profile=sanitizeProfile({...profile,speed:Number(event.target.value)});character.profile={...profile};save();renderProfileFields();reset(false)});
$('#speed-preset').addEventListener('change',event=>{if(event.target.value!=='custom')$('#profile-speed').value=event.target.value});
$('#reset-button').addEventListener('click',()=>reset(true));$('#retry-button').addEventListener('click',()=>reset(true));
$('#pause-button').addEventListener('click',()=>status==='running'?pause():resume());$('#camera-button').addEventListener('click',cycleCamera);
$('#trace-button').addEventListener('click',()=>toggleTrace());$('#jump-button').addEventListener('click',()=>{if(status==='running')queueJump()});
$('#result-trace-button').addEventListener('click',()=>{$('#result').hidden=true;toggleTrace(true);cameraMode='overview';$('#camera-select').value=cameraMode;toast('Last attempt path. Press R for another attempt.')});
$('#guide-button').addEventListener('click',()=>openDialog($('#guide')));
$('#calibration-button').addEventListener('click',()=>{renderProfileFields();openDialog($('#calibration'))});
const eraComparison=setupEraComparison({dialog:$('#era-comparison'),getAttempt:()=>lastTrace,
  onUseSpeed:speed=>{renderProfileFields({profile:{...profile,speed}});$('#era-comparison').close();openDialog($('#calibration'));$('#profile-status').textContent=`Measured speed ${speed.toFixed(3)} yd/s is in the form. Apply to use it.`}});
$('#compare-button').addEventListener('click',()=>{if(trace.length)completeTrace('in-progress');eraComparison.refresh();openDialog($('#era-comparison'))});
for(const dialog of [$('#guide'),$('#calibration'),$('#era-comparison')])dialog.addEventListener('close',()=>{if(status==='paused'&&pauseOwner==='dialog'&&!document.querySelector('dialog[open]'))resume()});
$('#apply-profile').addEventListener('click',applyProfile);
$('#default-profile').addEventListener('click',()=>{renderProfileFields({profile:{...DEFAULT_PROFILE},gateOffset:[0,0,0],sensitivity:.0025});$('#profile-status').textContent='Defaults restored in the form. Apply to restart with them.'});
$('#collision-toggle').addEventListener('change',event=>{collisionLines.forEach(mesh=>mesh.visible=event.target.checked)});
$('#diagnostics-toggle').addEventListener('change',updateHUD);
$('#export-attempt').addEventListener('click',()=>{if(trace.length)completeTrace(status==='complete'?'cleared':'in-progress');if(lastTrace)download(`gothik-attempt-${attempt}.json`,lastTrace);else $('#profile-status').textContent='Make an attempt before exporting its trace.'});
$('#export-profile').addEventListener('click',()=>download('gothik-calibration.json',profileSnapshot()));
$('#import-profile').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try {
    if(file.size>65536)throw new Error('Calibration file is too large.');const incoming=JSON.parse(await file.text());
    if(incoming.schema!=='gothik-calibration-v1'||typeof incoming.profile!=='object'||!Array.isArray(incoming.gateOffset)||incoming.gateOffset.length!==3)throw new Error('Choose a Gothik calibration export.');
    const draft={profile:sanitizeProfile(incoming.profile),gateOffset:incoming.gateOffset.map(n=>clamp(Number(n)||0,-1,1)),sensitivity:clamp(Number(incoming.sensitivity)||.0025,.0005,.006)};
    if(['first','third','overview'].includes(incoming.cameraMode))draft.cameraMode=incoming.cameraMode;
    if(['approach','ledge'].includes(incoming.startPoint))draft.startPoint=incoming.startPoint;
    renderProfileFields(draft);$('#profile-status').textContent='Calibration imported into the form. Apply to use it.';
  }catch(error){$('#profile-status').textContent=error.message}event.target.value='';
});
document.querySelectorAll('#opening-start,#opening-speed,#calibration-button,#compare-button,#reset-button,#camera-button,#trace-button,#pause-button,#jump-button').forEach(control=>{control.dataset.needsRoom='';control.disabled=true});
renderProfileFields();$('#viewport').setAttribute('aria-busy','true');
loadRoom().catch(error=>{status='error';$('#load-status').textContent='Room load failed. Reload to try again.';$('#begin-button').textContent='Unable to load room';log(error.message,'error');console.error(error)});
