import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const canvas=document.querySelector('#scene'),stage=document.querySelector('#stage');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=.9;
const scene=new THREE.Scene();
const env=new THREE.PMREMGenerator(renderer);scene.environment=env.fromScene(new RoomEnvironment(),.04).texture;
const camera=new THREE.PerspectiveCamera(33,1,.1,60);camera.position.set(-2.1,2.6,10.7);
const controls=new OrbitControls(camera,canvas);controls.target.set(0,1.95,0);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=6;controls.maxDistance=13;controls.maxPolarAngle=Math.PI*.65;controls.minPolarAngle=.4;
scene.add(new THREE.HemisphereLight(0xc9f8ff,0x242048,.65));
function light(color,intensity,x,y,z){const l=new THREE.DirectionalLight(color,intensity);l.position.set(x,y,z);scene.add(l);return l;}
const key=light(0xf1fff8,1.6,-3,6,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=6;key.shadow.camera.bottom=-2;key.shadow.normalBias=.03;
light(0x9870ff,1.4,3,3,-3);light(0x00ffb9,.7,-3,1,-2);
const floor=new THREE.Mesh(new THREE.CircleGeometry(5,80),new THREE.ShadowMaterial({opacity:.24}));floor.rotation.x=-Math.PI/2;floor.position.y=.025;floor.receiveShadow=true;scene.add(floor);
const crystal = {side:THREE.DoubleSide,metalness:.08, roughness:.12, clearcoat:1, clearcoatRoughness:.07, ior:1.48, transmission:.12, thickness:.7, envMapIntensity:.75};
const mint=new THREE.MeshPhysicalMaterial({...crystal,color:0x009e7d,envMapIntensity:.25,emissive:0x00c695,emissiveIntensity:.24});
const faceMat=new THREE.MeshPhysicalMaterial({...crystal,color:0x009875,roughness:.21,envMapIntensity:.18,transmission:.025,emissive:0x00deaa,emissiveIntensity:.25});
const purple=new THREE.MeshPhysicalMaterial({...crystal,color:0x6e16e9,metalness:.18,emissive:0x240061,emissiveIntensity:.35});
const teal=new THREE.MeshPhysicalMaterial({...crystal,color:0x00a6a4,emissive:0x003d3f,emissiveIntensity:.2});
const dark=new THREE.MeshStandardMaterial({color:0x052831,roughness:.3});
const white=new THREE.MeshStandardMaterial({color:0xf6fffa,roughness:.19});
const irisMat=new THREE.MeshPhysicalMaterial({color:0x019c65,roughness:.13,metalness:.25,clearcoat:1});
const pupilMat=new THREE.MeshPhysicalMaterial({color:0x031717,roughness:.12,clearcoat:1});
const gold=new THREE.MeshStandardMaterial({color:0xffb025,metalness:.7,roughness:.23});
const root=new THREE.Group();scene.add(root);const body=new THREE.Group();root.add(body);
function sphere(parent,mat,pos,scale){const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,32,24),mat);mesh.position.set(...pos);mesh.scale.set(...scale);mesh.castShadow=true;parent.add(mesh);return mesh;}
// Convex crystal silhouette, triangulated sides; every part has real depth.
const outline=[[-.46,3.65],[.35,3.17],[1.03,2.54],[1.18,1.24],[.65,.65],[-.61,.60],[-1.20,1.33],[-1.19,2.22]];
const front=outline.map(([x,y])=>new THREE.Vector3(x*.78,y,.52));
const back=outline.map(([x,y])=>new THREE.Vector3(x*.92,y-.06,-.42));
function triangle(a,b,c,mat){const g=new THREE.BufferGeometry().setFromPoints([a,c,b]);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;body.add(m);return m;}
// A shallow domed face keeps reflections continuous instead of a cardboard plane.
const inner=front.map(p=>new THREE.Vector3(p.x*.72,2+(p.y-2)*.73,.66));
const center=new THREE.Vector3(0,2,.71);
for(let i=0;i<8;i++){const j=(i+1)%8;triangle(front[i],front[j],inner[i],faceMat);triangle(front[j],inner[j],inner[i],faceMat);triangle(inner[i],inner[j],center,faceMat);}
for(let i=0;i<8;i++){let j=(i+1)%8;const outerA=new THREE.Vector3(outline[i][0],outline[i][1],.05),outerB=new THREE.Vector3(outline[j][0],outline[j][1],.05);const mat=i>=4?purple:i===0?mint:teal;triangle(front[i],outerA,front[j],mat);triangle(front[j],outerA,outerB,mat);triangle(outerA,back[i],outerB,i%2?purple:teal);triangle(outerB,back[i],back[j],i%2?purple:teal);triangle(back[j],back[i],new THREE.Vector3(0,2,-.66),i%2?purple:mint);}
// A few facets on the face perimeter leave the expression unobstructed.
triangle(front[0],front[1],new THREE.Vector3(.08,3.04,.535),mint);
triangle(front[0],new THREE.Vector3(.08,3.04,.535),front[7],teal);
triangle(front[4],front[5],new THREE.Vector3(-.05,.9,.536),purple);
const edges=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(front),new THREE.LineBasicMaterial({color:0xa0ffdf,transparent:true,opacity:.4}));body.add(edges);
const flecks=[];
let seed=83;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
for(let i=0;i<90;i++){const x=(rand()-.5)*1.5,y=.9+rand()*2.1;if(Math.abs(x)<.62&&y>1.65&&y<2.85)continue;flecks.push(x,y,.685);}
const inclusions=new THREE.BufferGeometry();inclusions.setAttribute('position',new THREE.Float32BufferAttribute(flecks,3));
body.add(new THREE.Points(inclusions,new THREE.PointsMaterial({color:0x79ffd2,size:.012,transparent:true,opacity:.38,depthWrite:false})));
// Broad dark eyes, narrow whites and independent glossy pupils echo the reference.
const eyes=[];
for(const x of [-.43,.43]){
 const eye=new THREE.Group();eye.position.set(x,2.22,.69);eye.rotation.z=x<0?-.095:.095;body.add(eye);
 sphere(eye,dark,[0,0,0],[.295,.355,.098]);
 sphere(eye,white,[0,0,.037],[.272,.33,.09]);
 const iris=sphere(eye,irisMat,[0,-.018,.107],[.252,.302,.073]);
 const pupil=sphere(eye,pupilMat,[0,.017,.166],[.195,.237,.047]);
 sphere(eye,new THREE.MeshBasicMaterial({color:0xffffff}),[.068,.128,.209],[.065,.075,.014]);
 sphere(eye,new THREE.MeshBasicMaterial({color:0x71ffe0}),[-.085,-.105,.191],[.029,.032,.009]);
 eyes.push({eye,iris,pupil});
 const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(x-.15,2.69,.63),new THREE.Vector3(x,2.82,.68),new THREE.Vector3(x+.15,2.71,.63));
 body.add(new THREE.Mesh(new THREE.TubeGeometry(curve,20,.047,10,false),dark));
}
const blush=new THREE.MeshPhysicalMaterial({color:0x00edaa,transparent:true,opacity:.38,roughness:.6,depthWrite:false});
for(const x of [-.64,.64])sphere(body,blush,[x,1.93,.655],[.12,.047,.012]);
// Deform one continuous mouth contour: closure, smile, wide vowels and rounded vowels.
const mouth=new THREE.Group();mouth.position.set(0,1.88,.73);body.add(mouth);
const mouthSegments=64,mouthVertices=new Float32Array((mouthSegments+1)*3);
const mouthGeo=new THREE.BufferGeometry();mouthGeo.setAttribute('position',new THREE.BufferAttribute(mouthVertices,3));
const indices=[];for(let i=1;i<=mouthSegments;i++)indices.push(0,i,i===mouthSegments?1:i+1);mouthGeo.setIndex(indices);
const lips=new THREE.Mesh(mouthGeo,new THREE.MeshBasicMaterial({color:0x02241d,side:THREE.DoubleSide}));mouth.add(lips);
const tongue=sphere(mouth,new THREE.MeshStandardMaterial({color:0x21d996,roughness:.45}),[0,-.10,.012],[.135,.045,.009]);
const teeth=sphere(mouth,white,[0,0,.013],[.17,.025,.008]);teeth.visible=false;
function shapeMouth(open,width,round,smile){
 const w=.245*width,h=open,corner=.032*smile;
 mouthVertices[0]=0;mouthVertices[1]=-h*.38;mouthVertices[2]=0;
 for(let i=0;i<mouthSegments;i++){
  const a=i/mouthSegments*Math.PI*2,x=Math.cos(a),y=Math.sin(a);
  const upper=corner*x*x + h*(.08+.32*round)*Math.max(0,y);
  const lower=corner*x*x - h*(1-.15*round)*Math.max(0,-y);
  const k=(i+1)*3;mouthVertices[k]=w*x;mouthVertices[k+1]=y>=0?upper:lower;mouthVertices[k+2]=0;
 }
 mouthGeo.attributes.position.needsUpdate=true;mouthGeo.computeBoundingSphere();
 tongue.visible=h>.065;tongue.position.y=-h*.72;tongue.scale.set(w*.57,Math.min(.045,h*.2),.009);
 teeth.visible=h>.09&&width>1.03;teeth.position.y=h*.05;teeth.scale.x=w*.73;
}
shapeMouth(.17,1,0,1);
// Raised gold badge and a vector-built Bitcoin mark.
const coin=new THREE.Mesh(new THREE.CylinderGeometry(.235,.235,.07,10),gold);coin.rotation.x=Math.PI/2;coin.position.set(0,1.22,.71);body.add(coin);
const coinFace=new THREE.Mesh(new THREE.CircleGeometry(.196,32),new THREE.MeshStandardMaterial({color:0xff9914,metalness:.45,roughness:.27}));coinFace.position.set(0,1.22,.751);body.add(coinFace);
const mark=new THREE.Group();mark.position.set(-.018,1.22,.762);body.add(mark);
function bar(x,y,w,h){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,.017),white);m.position.set(x,y,0);mark.add(m);}
bar(-.045,0,.031,.245);bar(-.072,0,.014,.31);bar(-.025,0,.014,.31);
for(const y of [-.055,.055]){const curve=new THREE.CubicBezierCurve3(new THREE.Vector3(-.035,y+.053,0),new THREE.Vector3(.11,y+.07,0),new THREE.Vector3(.11,y-.07,0),new THREE.Vector3(-.035,y-.053,0));mark.add(new THREE.Mesh(new THREE.TubeGeometry(curve,20,.02,8,false),white));}
// Hierarchical shoulders and wrists provide continuous articulated movement.
function arm(side){const shoulder=new THREE.Group();shoulder.position.set(side*1.04,1.66,.02);body.add(shoulder);const upper=sphere(shoulder,mint,[side*.17,-.22,0],[.19,.35,.2]);upper.rotation.z=side*.35;const wrist=new THREE.Group();wrist.position.set(side*.32,-.48,.025);shoulder.add(wrist);sphere(wrist,mint,[0,0,0],[.215,.235,.17]);for(let i=0;i<3;i++)sphere(wrist,mint,[(i-1)*.125,-.13,.012],[.078,.16,.085]);sphere(wrist,mint,[-side*.19,.015,.015],[.09,.15,.085]).rotation.z=side*.7;return {shoulder,wrist};}
const left=arm(-1),right=arm(1);
for(const side of [-1,1]){sphere(root,mint,[side*.43,.31,.03],[.18,.32,.2]);sphere(root,mint,[side*.44,.15,.2],[.32,.17,.39]);}
const clock=new THREE.Clock();let phase='idle',elapsed=0,waveStart=-99,sequence=false,sequenceStart=0,paused=false,lastTime=0;
const voice=document.querySelector('#voice'),status=document.querySelector('#status'),subtitle=document.querySelector('#subtitle');
let alignment=null;fetch('./audio/alignment.json').then(r=>r.json()).then(data=>alignment=data).catch(()=>{});
let context,analyser,bins;
function audioSetup(){if(context)return;context=new AudioContext();const src=context.createMediaElementSource(voice);analyser=context.createAnalyser();analyser.fftSize=256;src.connect(analyser);analyser.connect(context.destination);bins=new Uint8Array(analyser.frequencyBinCount);}
function setPhase(next){phase=next;paused=false;document.querySelector('#pause').textContent='Pausa';document.querySelectorAll('.action').forEach(b=>b.setAttribute('aria-pressed',String(b.id===next)));status.textContent=next==='wave'?'Ciao! Che bello vederti.':next==='talk'?'Parliamone, insieme.':'Sono qui.';subtitle.textContent=next==='talk'?'Voce italiana · riproduzione in corso':next==='wave'?'Un gesto continuo, dalla spalla fino alle dita.':'Un piccolo respiro. Uno sguardo. Prismo prende vita.';if(next==='wave')waveStart=elapsed;}
function stopAudio(){voice.pause();voice.currentTime=0;}
async function speak(){setPhase('talk');try{audioSetup();await context.resume();voice.currentTime=0;await voice.play();subtitle.textContent=alignment?.text||'Ciao! Sono Prismo, il tuo assistente.';}catch{setPhase('idle');subtitle.textContent='Audio non disponibile. Premi Parla in italiano per riprovare.';}}
for(const name of ['idle','wave','talk'])document.querySelector('#'+name).onclick=()=>{sequence=false;stopAudio();if(name==='talk')speak();else setPhase(name);};
document.querySelector('#demo').onclick=async()=>{stopAudio();audioSetup();await context.resume();sequence=true;sequenceStart=elapsed;setPhase('idle');};
document.querySelector('#pause').onclick=()=>{paused=!paused;document.querySelector('#pause').textContent=paused?'Riprendi':'Pausa';if(paused)voice.pause();else if(phase==='talk')voice.play().catch(()=>{});};
document.querySelector('#reset').onclick=()=>{camera.position.set(-2.1,2.6,10.7);controls.target.set(0,1.95,0);controls.update();};
voice.onended=()=>{setPhase('idle');sequence=false;status.textContent='Decidi sempre tu.';subtitle.textContent='Fine della prova · nessuna operazione sul wallet.';};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const smooth=(a,b,dt,speed=9)=>THREE.MathUtils.lerp(a,b,1-Math.exp(-speed*dt));
let mouthOpen=.17,mouthWidth=1,mouthRound=0,mouthSmile=1;
function render(){requestAnimationFrame(render);const now=clock.getElapsedTime(),dt=Math.min(.05,now-lastTime);lastTime=now;if(!paused)elapsed+=dt;
if(!paused){if(sequence){const t=elapsed-sequenceStart;if(t>2.6&&t<6.8&&phase!=='wave')setPhase('wave');if(t>=6.8&&phase!=='talk'){sequence=false;speak();}}
const breath=reduced.matches?0:Math.sin(elapsed*1.7);root.position.y=breath*.025;body.scale.y=1+breath*.009;body.rotation.y=smooth(body.rotation.y,reduced.matches?0:Math.sin(elapsed*.6)*.025,dt);body.rotation.z=smooth(body.rotation.z,phase==='wave'?-.045:Math.sin(elapsed*.75)*.012,dt);
const wt=elapsed-waveStart;const waving=phase==='wave'&&wt<4.2;const envelope=waving?Math.min(1,wt*2,Math.max(0,(4.2-wt)*2)):0;
right.shoulder.rotation.z=smooth(right.shoulder.rotation.z,envelope*(1.9+Math.sin(wt*7)*.15),dt,6);right.wrist.rotation.z=smooth(right.wrist.rotation.z,envelope*Math.sin(wt*8)*.3,dt);left.shoulder.rotation.z=smooth(left.shoulder.rotation.z,Math.sin(elapsed*1.7)*.035,dt);if(phase==='wave'&&!waving&&!sequence)setPhase('idle');
const blinkPhase=elapsed%4.1;const blink=reduced.matches?1:1-.96*Math.exp(-Math.pow((blinkPhase-3.65)/.075,2));eyes.forEach(({eye})=>eye.scale.y=blink);
let open=.17,width=1,round=0,smile=1;
if(phase==='talk'&&!voice.paused){
 let energy=0;if(analyser){analyser.getByteFrequencyData(bins);for(let i=2;i<45;i++)energy+=bins[i];energy=Math.min(1,energy/(43*95));}
 open=.015+energy*.23;smile=.35;
 const a=alignment?.alignment;
 if(a){
  // Overlap adjacent character windows for coarticulation; these are approximate visemes, not phoneme labels.
  let weights=0,opening=0,widening=0,rounding=0;
  const t=voice.currentTime+.035;
  for(let i=0;i<a.characters.length;i++){
   const start=a.character_start_times_seconds[i],end=a.character_end_times_seconds[i];
   if(t<start-.065||t>end+.065)continue;
   const weight=Math.max(0,Math.min(1,(t-start+.065)/.065,(end+.065-t)/.065));
   const c=a.characters[i].toLowerCase();let o=.48,w=1,r=0;
   if('mbp'.includes(c)){o=.015;w=.91;}
   else if(/\s|[.,!?;:]/.test(c)){o=0;w=.96;}
   else if('aà'.includes(c)){o=1;w=1.08;}
   else if('oòuù'.includes(c)){o=.8;w=.66;r=1;}
   else if('eèéiì'.includes(c)){o=.48;w=1.2;}
   else if('fv'.includes(c)){o=.22;w=1.08;}
   weights+=weight;opening+=o*weight;widening+=w*weight;rounding+=r*weight;
  }
  if(weights){open=.008+.26*(opening/weights)*Math.min(1,energy*2.3);width=widening/weights;round=rounding/weights;}
 }
}
mouthOpen=smooth(mouthOpen,open,dt,20);mouthWidth=smooth(mouthWidth,width,dt,16);mouthRound=smooth(mouthRound,round,dt,14);mouthSmile=smooth(mouthSmile,smile,dt,10);
shapeMouth(mouthOpen,mouthWidth,mouthRound,mouthSmile);
}

controls.update();renderer.render(scene,camera);}
function resize(){const r=stage.getBoundingClientRect();renderer.setSize(r.width,r.height-110,false);camera.aspect=r.width/(r.height-110);camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(stage);resize();render();document.querySelector('#health').textContent='3D reale · arti articolati · voce italiana sintetica';
