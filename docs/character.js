import * as THREE from './vendor/three.module.min.js';

const DEFAULT_BASE = new URL('./assets/character/', import.meta.url);
const IDENTITY = [0, 0, 0, 1];
const angleDifference = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Original character manifest failed to load: ${response.status}`);
  return response.json();
}

function attributeView(buffer, descriptor) {
  const types = {Float32: Float32Array, Uint32: Uint32Array, Uint16: Uint16Array, Uint8: Uint8Array};
  const Type = types[descriptor.type];
  if (!Type || descriptor.byteOffset % Type.BYTES_PER_ELEMENT) throw new Error('Invalid original character buffer');
  return new Type(buffer, descriptor.byteOffset, descriptor.count * descriptor.itemSize);
}

function prepareTrack(buffer, entry) {
  const times = attributeView(buffer, entry.timesMs);
  const source = attributeView(buffer, entry.values);
  let values = source;
  if (entry.encoding === 'm2-uint16-quaternion') {
    values = new Float64Array(source.length);
    for (let i = 0; i < source.length; i += 4) {
      let length = 0;
      for (let j = 0; j < 4; j++) {
        const encoded = source[i + j];
        const value = (encoded - (encoded >= 32768 ? 32768 : 32767)) / 32767;
        values[i + j] = value;
        length += value * value;
      }
      length = Math.sqrt(length);
      if (length < 1e-8) values.set(IDENTITY, i);
      else for (let j = 0; j < 4; j++) values[i + j] /= length;
    }
  }
  return {...entry, times, values};
}

const qLeft = new THREE.Quaternion(), qRight = new THREE.Quaternion(), qBlend = new THREE.Quaternion();
function lerpQuaternion(target, left, right, fraction) {
  const sign = left.dot(right) < 0 ? -1 : 1;
  target.set(left.x + (right.x * sign - left.x) * fraction,
    left.y + (right.y * sign - left.y) * fraction,
    left.z + (right.z * sign - left.z) * fraction,
    left.w + (right.w * sign - left.w) * fraction).normalize();
}
function sampleTrack(track, timeMs, target) {
  const {times, values, channel, interpolation} = track;
  const size = channel === 'rotation' ? 4 : 3;
  if (!times.length) return;
  let left = 0, right = times.length - 1;
  if (timeMs <= times[0]) right = left;
  else if (timeMs >= times[right]) left = right;
  else {
    while (right - left > 1) {
      const middle = (left + right) >> 1;
      if (times[middle] <= timeMs) left = middle;
      else right = middle;
    }
  }
  if (interpolation === 0 || left === right) {
    target.fromArray(values, left * size);
    return;
  }
  const span = times[right] - times[left];
  const fraction = span ? Math.max(0, Math.min(1, (timeMs - times[left]) / span)) : 1;
  if (channel === 'rotation') {
    qLeft.fromArray(values, left * 4);
    qRight.fromArray(values, right * 4);
    lerpQuaternion(target, qLeft, qRight, fraction);
  } else {
    const offset = left * 3, next = right * 3;
    target.set(values[offset] + (values[next] - values[offset]) * fraction,
      values[offset + 1] + (values[next + 1] - values[offset + 1]) * fraction,
      values[offset + 2] + (values[next + 2] - values[offset + 2]) * fraction);
  }
}

function emptyPose(count) {
  return Array.from({length: count}, () => ({
    translation: new THREE.Vector3(), rotation: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1)
  }));
}

function resetPose(pose) {
  for (const bone of pose) {
    bone.translation.set(0, 0, 0);
    bone.rotation.identity();
    bone.scale.set(1, 1, 1);
  }
}

function copyPose(target, source) {
  for (let i = 0; i < target.length; i++) {
    target[i].translation.copy(source[i].translation);
    target[i].rotation.copy(source[i].rotation);
    target[i].scale.copy(source[i].scale);
  }
}

/** Original Classic Era geometry, skeleton and animation data. Z up, +X forward. */
export async function createNightElf({baseURL = DEFAULT_BASE, random = Math.random} = {}) {
  const base = new URL(baseURL, import.meta.url);
  const manifest = await loadJSON(new URL('manifest.json', base));
  if (manifest.schema !== 'gothik-nightelf-v1') throw new Error('Unsupported original Night Elf manifest');
  const response = await fetch(new URL(manifest.buffer, base));
  if (!response.ok) throw new Error(`Original Night Elf model failed to load: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const object3D = new THREE.Group();
  object3D.name = 'Classic Era Night Elf female';
  const modelRoot = new THREE.Group();
  modelRoot.name = 'NightElfFemale model orientation';
  object3D.add(modelRoot);
  const geometry = new THREE.BufferGeometry();
  for (const [name, descriptor] of Object.entries(manifest.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(attributeView(buffer, descriptor), descriptor.itemSize, !!descriptor.normalized));
  }
  geometry.setIndex(new THREE.BufferAttribute(attributeView(buffer, manifest.index), 1));
  const textureLoader = new THREE.TextureLoader();
  const textures = new Map();
  await Promise.all([...new Set(manifest.materials.map(material => material.texture))].map(async file => {
    const texture = await textureLoader.loadAsync(new URL(file, base).href);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    textures.set(file, texture);
  }));
  const materials = manifest.materials.map(material => {
    const properties = {
      map: textures.get(material.texture), color: 0xffffff,
      side: material.flags & 4 ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: material.blendMode === 1 ? .5 : 0,
      transparent: material.blendMode >= 2,
      depthWrite: !(material.flags & 16),
      name: material.textureType === 1 ? 'Original green leather character atlas' : 'Original character texture'
    };
    if (material.blendMode === 3 || material.blendMode === 4) properties.blending = THREE.AdditiveBlending;
    return material.flags & 1 ? new THREE.MeshBasicMaterial(properties) : new THREE.MeshLambertMaterial(properties);
  });
  const materialIds = manifest.materials.map(material => material.id);
  for (const group of manifest.groups) geometry.addGroup(group.start, group.count, materialIds.indexOf(group.material));
  geometry.computeBoundingSphere();
  const bones = manifest.bones.map(source => {
    const bone = new THREE.Bone();
    bone.name = `M2 bone ${source.index}`;
    bone.userData.m2 = source;
    const parentPivot = source.parent < 0 ? [0, 0, 0] : manifest.bones[source.parent].pivot;
    bone.position.set(source.pivot[0] - parentPivot[0], source.pivot[1] - parentPivot[1], source.pivot[2] - parentPivot[2]);
    return bone;
  });
  const bindPositions = bones.map(bone => bone.position.clone());
  const billboards = manifest.bones.filter(bone => bone.flags & 8).map(bone => bone.index);
  const billboardBasis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 0,
    0, 0, 0, 1));
  const cameraQuaternion = new THREE.Quaternion(), parentQuaternion = new THREE.Quaternion();
  for (const source of manifest.bones) {
    if (source.parent < 0) modelRoot.add(bones[source.index]);
    else bones[source.parent].add(bones[source.index]);
  }
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.name = 'Original skinned NightElfFemale';
  // Runtime bounds follow animated limbs. Avoid culling from bind-pose bounds.
  mesh.frustumCulled = false;
  modelRoot.add(mesh);
  object3D.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);

  // Original character art expects diffuse lighting. The room's baked WMO
  // materials remain unaffected by these lights.
  const fill = new THREE.AmbientLight(0xbcb0d0, 1.45);
  const key = new THREE.DirectionalLight(0xfff1df, 1.45);
  key.position.set(2, -4, 7);
  const keyTarget = new THREE.Object3D();
  keyTarget.position.set(0, 0, 1.4);
  key.target = keyTarget;
  object3D.add(fill, key, keyTarget);

  const clips = new Map(manifest.animations.map(clip => [clip.name, {
    ...clip, tracks: clip.tracks.map(track => prepareTrack(buffer, track))
  }]));
  const globalTracks = manifest.globalTracks.map(track => prepareTrack(buffer, track));
  const pose = emptyPose(bones.length), previousPose = emptyPose(bones.length);
  let animation = clips.get('Stand'), animationTime = 0, globalTime = 0, blendTime = 1, blendDuration = 0;
  let previouslyGrounded = true, jumpInProgress = false, landing = false, previousJumped = false, disposed = false;

  function evaluate(dt, camera = null) {
    resetPose(pose);
    const timeMs = animation.loop ? animationTime % animation.durationMs : Math.min(animationTime, animation.durationMs);
    for (const track of animation.tracks) sampleTrack(track, timeMs, pose[track.bone][track.channel]);
    for (const track of globalTracks) {
      const duration = manifest.globalSequencesMs[track.globalSequence];
      sampleTrack(track, duration > 0 ? globalTime % duration : 0, pose[track.bone][track.channel]);
    }
    blendTime += dt;
    const blend = blendDuration > 0 ? Math.min(1, blendTime / blendDuration) : 1;
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i], value = pose[i];
      if (blend < 1) {
        value.translation.lerpVectors(previousPose[i].translation, value.translation, blend);
        qBlend.copy(value.rotation);
        lerpQuaternion(value.rotation, previousPose[i].rotation, qBlend, blend);
        value.scale.lerpVectors(previousPose[i].scale, value.scale, blend);
      }
      bone.position.copy(bindPositions[i]).add(value.translation);
      bone.quaternion.copy(value.rotation);
      bone.scale.copy(value.scale);
    }
    object3D.updateMatrixWorld(true);
    if (camera) {
      camera.getWorldQuaternion(cameraQuaternion);
      cameraQuaternion.multiply(billboardBasis);
      for (const i of billboards) {
        const bone = bones[i];
        bone.parent.getWorldQuaternion(parentQuaternion);
        bone.quaternion.copy(parentQuaternion.invert()).multiply(cameraQuaternion);
        bone.updateMatrixWorld(true);
      }
    }
    skeleton.update();
  }

  function setAnimation(name, {restart = false, blend = true} = {}) {
    const next = clips.get(name);
    if (!next) throw new Error(`The original model has no ${name} animation`);
    if (animation === next && !restart) return;
    copyPose(previousPose, pose);
    animation = next;
    animationTime = 0;
    blendTime = 0;
    blendDuration = blend ? Math.min(.3, next.blendInMs / 1000) : 0;
  }

  function chooseJumpStart() {
    const regular = clips.get('JumpStart'), flip = clips.get('JumpStartFlip');
    const regularWeight = Math.max(0, regular.frequency), flipWeight = Math.max(0, flip.frequency);
    return random() * (regularWeight + flipWeight) < regularWeight ? regular.name : flip.name;
  }

  function locomotion(state) {
    if (!state.moving || !(state.speed > .025)) return 'Stand';
    if (state.backward) return 'WalkBackwards';
    // RunLeft/RunRight are absent and their local AnimationData fallback is
    // Stand. Full-speed movement therefore uses the model's actual Run track.
    if (state.speed > 3.05) return 'Run';
    return 'Walk';
  }

  function update(dt, state = {}) {
    if (disposed) return;
    dt = Math.max(0, Math.min(.1, Number(dt) || 0));
    const grounded = state.grounded !== false;
    const jumped = !!state.jumped;
    const beganJump = jumped && !previousJumped;
    const landed = !!state.landed || (!previouslyGrounded && grounded);
    if (beganJump) {
      jumpInProgress = true;
      landing = false;
      setAnimation(chooseJumpStart(), {restart: true});
    } else if (landed) {
      landing = true;
      jumpInProgress = false;
      setAnimation(state.moving && !state.backward ? 'JumpLandRun' : 'JumpLand', {restart: true});
    } else if (!grounded) {
      landing = false;
      if (jumpInProgress && animation.name.startsWith('JumpStart') && animationTime < animation.durationMs) {
        // Preserve the original start sequence until it completes or lands.
      } else if (jumpInProgress && (state.verticalSpeed ?? 0) > -12) setAnimation('Jump');
      else setAnimation('Fall');
    } else {
      if (landing && animationTime < animation.durationMs) {
        // The authored landing clip finishes before returning to locomotion.
      } else {
        landing = false;
        jumpInProgress = false;
        setAnimation(locomotion(state));
      }
    }
    const scale = animation.movespeed > 0 && state.speed > .025
      ? Math.max(.25, Math.min(2, state.speed / animation.movespeed)) : 1;
    animationTime += dt * 1000 * scale;
    globalTime += dt * 1000;
    // Facing changes orient the original locomotion clip. Unit/camera facing
    // stays independent in the host game's controller.
    if (Number.isFinite(state.yaw)) object3D.rotation.z = state.yaw;
    let relativeAngle = 0;
    if (state.moving && Number.isFinite(state.movementAngle) && Number.isFinite(state.yaw) && !state.backward) {
      relativeAngle = angleDifference(state.movementAngle - state.yaw);
    }
    modelRoot.rotation.z += angleDifference(relativeAngle - modelRoot.rotation.z) * Math.min(1, dt * 18);
    evaluate(dt, state.camera);
    previousJumped = jumped;
    previouslyGrounded = grounded;
  }

  function reset() {
    previouslyGrounded = true;
    jumpInProgress = landing = previousJumped = false;
    modelRoot.rotation.z = 0;
    setAnimation('Stand', {restart: true, blend: false});
    evaluate(0);
  }

  function dispose() {
    disposed = true;
    geometry.dispose();
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    skeleton.dispose();
    object3D.removeFromParent();
  }

  evaluate(0);
  return {object3D, mesh, manifest, update, setAnimation, reset, dispose,
    get animationName() { return animation.name; },
    get animationTimeMs() { return animationTime; }};
}
