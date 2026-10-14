import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

export function loadSceneCollisionParts() {
  const root=fileURLToPath(new URL('../docs/assets/scene/',import.meta.url));
  const manifest=JSON.parse(fs.readFileSync(`${root}manifest.json`));
  return manifest.meshes.map(mesh=>{
    const bytes=fs.readFileSync(root+mesh.buffer),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    const p=mesh.collision.position,i=mesh.collision.index,raw=new Float32Array(buffer,p.byteOffset,p.count*p.itemSize);
    const indices=new Uint32Array(buffer,i.byteOffset,i.count*i.itemSize);
    const instance=manifest.instances.find(i=>i.mesh===mesh.id),c=Math.cos(instance.rotationZ),s=Math.sin(instance.rotationZ),scale=instance.scale;
    const positions=new Float64Array(raw.length);
    for(let n=0;n<raw.length;n+=3){positions[n]=(raw[n]*c-raw[n+1]*s)*scale+instance.position[0];positions[n+1]=(raw[n]*s+raw[n+1]*c)*scale+instance.position[1];positions[n+2]=raw[n+2]*scale+instance.position[2]}
    return {name:mesh.id,positions,indices};
  });
}
