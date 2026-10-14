const finite=value=>typeof value==='number'&&Number.isFinite(value);
const svgNS='http://www.w3.org/2000/svg';
const svg=(name,attributes={},text)=>{
  const element=document.createElementNS(svgNS,name);
  for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
  if(text!==undefined)element.textContent=text;
  return element;
};

export function readEraRecording(incoming) {
  if(incoming?.schema!=='gothik-era-recording-v1'||!Array.isArray(incoming.samples))throw new Error('Choose a Gothik movement recorder export.');
  if(incoming.samples.length<2||incoming.samples.length>10000)throw new Error('The recording needs between 2 and 10,000 samples.');
  const samples=incoming.samples.map(sample=>{
    if(!finite(sample.t)||sample.t<0||sample.t>180)throw new Error('The recording has an invalid timestamp.');
    const clean={t:sample.t};
    for(const key of ['x','y','z','speed','facing'])if(finite(sample[key]))clean[key]=sample[key];
    if(typeof sample.falling==='boolean')clean.falling=sample.falling;
    return clean;
  });
  if(samples.some((sample,i)=>i&&sample.t<samples[i-1].t))throw new Error('Recording timestamps must be in order.');
  const events=Array.isArray(incoming.events)?incoming.events.filter(e=>finite(e?.t)&&e.t>=0&&e.t<=180&&e.kind==='jump').map(e=>({t:e.t,kind:'jump'})):[];
  const speeds=samples.map(s=>s.speed).filter(s=>finite(s)&&s>0&&s<=15).sort((a,b)=>a-b);
  const highSpeeds=speeds.filter(speed=>speed>=speeds.at(-1)*.95);
  const measuredSpeed=highSpeeds.length>=5?highSpeeds[Math.floor(highSpeeds.length/2)]:null;
  return {samples,events,client:incoming.client||{},player:incoming.player||{},caseId:incoming.capture?.caseId||'manual',measuredSpeed};
}

export function setupEraComparison({dialog,getAttempt,onUseSpeed}) {
  const $=selector=>dialog.querySelector(selector);
  let recording=null;
  const status=$('#recording-status'),plot=$('#recording-plot');
  const show=()=>{
    if(!recording)return;
    const metric=$('#recording-metric').value,client=recording.samples;
    const request=recording.events[0]?.t;
    const firstTime=Number.isFinite(request)?request:client[0].t;
    const source=client.filter(s=>s.t>=firstTime-.25&&s.t<=firstTime+($('input#recording-window').valueAsNumber||3));
    const heightBase=client.filter(s=>s.t<=firstTime).at(-1)?.z??client.find(s=>s.t>=firstTime)?.z;
    const value=s=>metric==='height'&&finite(s.z)&&finite(heightBase)?s.z-heightBase:metric==='speed'?s.speed:undefined;
    const measured=source.filter(s=>finite(value(s))).map(s=>({t:s.t-firstTime,y:value(s)}));
    const attempt=getAttempt(),jump=attempt?.events.find(e=>e.kind==='jump');
    const simulatedBase=jump?(attempt.samples.filter(s=>s.t<jump.t).at(-1)?.z??attempt.start[2]):0;
    const simulated=metric==='height'&&jump?attempt.samples.filter(s=>s.t>=jump.t-.25&&s.t<=jump.t+maxWindow()).map(s=>({t:s.t-jump.t,y:s.z-simulatedBase})):[];
    const all=[...measured,...simulated],minT=-.25,maxT=Number($('#recording-window').value)||3;
    const minY=Math.min(0,...all.map(s=>s.y)),maxY=Math.max(metric==='height'?.5:1,...all.map(s=>s.y));
    const range=Math.max(.5,maxY-minY),low=minY-range*.08,high=maxY+range*.12;
    const x=t=>52+(t-minT)/(maxT-minT)*546,y=v=>190-(v-low)/(high-low)*154;
    plot.replaceChildren(svg('title',{},`${metric==='height'?'Height since jump request':'Reported speed'}: Era recording and browser attempt`));
    for(let i=0;i<=4;i++) {
      const v=low+(high-low)*i/4;
      plot.append(svg('line',{x1:52,y1:y(v),x2:598,y2:y(v),class:'plot-grid'}),svg('text',{x:43,y:y(v)+4,'text-anchor':'end'},v.toFixed(1)));
    }
    for(let i=0;i<=Math.floor(maxT);i++)plot.append(svg('text',{x:x(i),y:211,'text-anchor':'middle'},`${i}s`));
    plot.append(svg('text',{x:53,y:18},metric==='height'?'Height · yards':'Reported run speed · yd/s'));
    for(const event of recording.events){const t=event.t-firstTime;if(t>=minT&&t<=maxT)plot.append(svg('line',{x1:x(t),y1:28,x2:x(t),y2:190,class:'plot-request'}))}
    const line=(points,className)=>{
      if(points.length<2)return;
      plot.append(svg('polyline',{points:points.filter(s=>s.t>=minT&&s.t<=maxT).map(s=>`${x(s.t).toFixed(2)},${y(s.y).toFixed(2)}`).join(' '),class:className}));
    };
    line(simulated,'plot-browser');line(measured,'plot-era');
    $('#recording-empty').hidden=measured.length>1;
    $('#recording-empty').textContent=metric==='height'?'Era did not expose height in this recording. Speed and input timing may still be available.':'Era did not expose speed in this recording.';
    const duration=client.at(-1).t-client[0].t;
    const stats=[['Client',`${String(recording.client.version||'?')} · ${String(recording.client.build||'?')}`],['Run speed',recording.measuredSpeed===null?'Unavailable':`${recording.measuredSpeed.toFixed(3)} yd/s · ${(recording.measuredSpeed/7*100).toFixed(1)}%`],['Capture',`${duration.toFixed(2)}s · ${client.length} samples`]];
    $('#recording-stats').replaceChildren(...stats.map(([label,text])=>{const item=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=text;item.append(small,strong);return item}));
    $('#use-recorded-speed').disabled=recording.measuredSpeed===null;
    $('#recording-result').hidden=false;
    status.textContent=`${recording.caseId} recording loaded. ${finite(heightBase)?'Height is available.':'Position is unavailable; no height or scene path was invented.'}`;
  };
  const parse=text=>{
    try {
      if(text.length>4000000)throw new Error('The recording must be smaller than 4 MB.');
      const incoming=readEraRecording(JSON.parse(text));recording=incoming;
      $('#recording-metric').value=incoming.samples.some(s=>finite(s.z))?'height':'speed';show();
    }catch(error){status.textContent=error.message}
  };
  $('#read-recording').addEventListener('click',()=>parse($('#recording-json').value));
  $('#import-recording').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    if(file.size>4000000)status.textContent='The recording must be smaller than 4 MB.';
    else parse(await file.text());event.target.value='';
  });
  $('#recording-metric').addEventListener('change',show);
  $('#recording-window').addEventListener('input',show);
  function maxWindow(){return Number($('#recording-window').value)||3}
  $('#use-recorded-speed').addEventListener('click',()=>{if(finite(recording?.measuredSpeed))onUseSpeed(recording.measuredSpeed)});
  return {refresh:show};
}
