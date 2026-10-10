const canvas=document.querySelector('#prismo');
canvas.width=1280;canvas.height=1280;
const audio=document.querySelector('#voice'),status=document.querySelector('#status');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const load=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});
const [original,closedEyes]=await Promise.all(['original.png','eyes-closed.png'].map(load));
const alignment=await fetch('./audio/alignment.json').then(r=>r.json());
// One continuous textured surface. No detached cutouts, overlapping patches or holes.
const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true});
if(!gl)throw new Error('WebGL unavailable for the continuous 2D animation');
const vertex=`
precision highp float;
attribute vec2 point;
varying vec2 uv;
uniform float wave;
uniform float openness;
uniform float width;
uniform float breathe;
void main(){
 uv=point/1280.0;
 vec2 p=point;
 // Anchor the shoulder and move progressively towards the fingers.
 float hand=smoothstep(966.0,1080.0,p.x)*(1.0-smoothstep(755.0,835.0,p.y));
 vec2 d=p-vec2(975.0,690.0);float a=wave*hand;
 p+=vec2(d.x*cos(a)-d.y*sin(a),d.x*sin(a)+d.y*cos(a))-d;
 // Preserve all pixels around the lips: both the mouth and nearby skin deform together.
 vec2 mouth=point-vec2(703.0,629.0);
 float edgeX=smoothstep(605.0,643.0,point.x)*(1.0-smoothstep(764.0,805.0,point.x));
 float edgeY=smoothstep(550.0,592.0,point.y)*(1.0-smoothstep(678.0,724.0,point.y));
 float influence=edgeX*edgeY;
 p.x+=mouth.x*(width-1.0)*influence;
 p.y+=mouth.y*(0.30+0.70*openness-1.0)*influence;
 p.y=1120.0+(p.y-1120.0)*(1.0+breathe*0.0025)+breathe*3.0;
 gl_Position=vec4(p.x/640.0-1.0,1.0-p.y/640.0,0.0,1.0);
}`;
const fragment=`
precision highp float;
varying vec2 uv;
uniform sampler2D original;
uniform sampler2D closed;
uniform float blink;
float eyeMask(vec2 center,vec2 radius){float d=length((uv*1280.0-center)/radius);return 1.0-smoothstep(0.82,1.0,d);}
void main(){
 vec4 base=texture2D(original,uv);
 float mask=max(eyeMask(vec2(530.0,592.0),vec2(100.0,112.0)),eyeMask(vec2(836.0,520.0),vec2(92.0,114.0)));
 gl_FragColor=mix(base,texture2D(closed,uv),mask*blink);
}`;
function shader(kind,source){const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const points=[],indices=[],n=160;
for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)points.push(x*1280/n,y*1280/n);
for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*(n+1)+x;indices.push(i,i+1,i+n+1,i+1,i+n+2,i+n+1);}
const vertices=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.STATIC_DRAW);
const attrib=gl.getAttribLocation(program,'point');gl.enableVertexAttribArray(attrib);gl.vertexAttribPointer(attrib,2,gl.FLOAT,false,0,0);
const triangles=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,triangles);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
[original,closedEyes].forEach((image,i)=>{const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.uniform1i(gl.getUniformLocation(program,i?'closed':'original'),i);});
const uniforms=Object.fromEntries(['wave','openness','width','breathe','blink'].map(name=>[name,gl.getUniformLocation(program,name)]));
gl.viewport(0,0,1280,1280);gl.clearColor(0,0,0,0);
const ease=v=>{v=Math.max(0,Math.min(1,v));return v*v*v*(v*(v*6-15)+10);};
let context,analyser,samples;
function setupAudio(){if(context)return;context=new AudioContext();const source=context.createMediaElementSource(audio);analyser=context.createAnalyser();analyser.fftSize=512;source.connect(analyser);analyser.connect(context.destination);samples=new Uint8Array(analyser.fftSize);}
let time=0,last=performance.now(),mode='idle',started=0,sequence=false,paused=false,blinkAt=2.2,manualBlink=-100,mouthAmount=1,mouthWidth=1,waveAmount=0;
const smooth=(a,b,dt,speed)=>a+(b-a)*(1-Math.exp(-speed*dt));
function setMode(next){mode=next;started=time;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===next)));status.textContent={idle:'Ciao, sono Prismo.',wave:'Ciao! Che bello vederti.',blink:'Un battito degli occhi.',talk:'Prismo parla in italiano…'}[next];}
function blink(t){return t<0||t>.34?0:t<.12?Math.sin(t/.12*Math.PI/2):t<.17?1:Math.cos((t-.17)/.17*Math.PI/2);}
function speechShape(){let energy=0;if(analyser){analyser.getByteTimeDomainData(samples);for(const sample of samples)energy+=((sample-128)/128)**2;energy=Math.min(1,Math.sqrt(energy/samples.length)*9);}
const a=alignment.alignment,t=audio.currentTime+.025;let total=0,open=0,width=0;
for(let i=0;i<a.characters.length;i++){const start=a.character_start_times_seconds[i],end=a.character_end_times_seconds[i];if(t<start-.05||t>end+.05)continue;const weight=Math.max(0,Math.min(1,(t-start+.05)/.05,(end+.05-t)/.05));const c=a.characters[i].toLowerCase();let o=.5,w=1;if('mbp'.includes(c)||/\s|[.,!?]/.test(c)){o=0;}else if('aà'.includes(c)){o=1;w=1.02;}else if('ouòù'.includes(c)){o=.82;w=.79;}else if('eièéì'.includes(c)){o=.5;w=1.06;}total+=weight;open+=weight*o;width+=weight*w;}
return total?{open:open/total*Math.min(1,energy*2),width:width/total}:{open:energy*.6,width:1};}
async function speak(){setMode('talk');setupAudio();await context.resume();audio.currentTime=0;try{await audio.play();}catch{setMode('idle');status.textContent='Premi Parla per avviare la voce.';}}
function stop(){audio.pause();audio.currentTime=0;sequence=false;paused=false;document.querySelector('#pause').textContent='Pausa';}
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{stop();if(b.dataset.mode==='talk')speak();else{setMode(b.dataset.mode);if(mode==='blink')manualBlink=time;}};
document.querySelector('#demo').onclick=async()=>{stop();setupAudio();await context.resume();sequence=true;setMode('idle');};
document.querySelector('#pause').onclick=()=>{paused=!paused;document.querySelector('#pause').textContent=paused?'Riprendi':'Pausa';if(paused)audio.pause();else if(mode==='talk')audio.play().catch(()=>{});};
audio.onended=()=>{setMode('idle');status.textContent='Decidi sempre tu.';};
function render(now){const dt=Math.min(.05,(now-last)/1000);last=now;if(!paused)time+=dt;
if(!paused&&sequence){if(mode==='idle'&&time-started>1.3)setMode('wave');else if(mode==='wave'&&time-started>3.5){setMode('blink');manualBlink=time;}else if(mode==='blink'&&time-started>.65){sequence=false;speak();}}
if(!paused&&time>blinkAt+.4)blinkAt=time+2.7+(Math.sin(time*4)+1)*.7;
const eyelid=Math.max(blink(time-manualBlink),reduced.matches?0:blink(time-blinkAt));
const waveT=time-started,wave=mode==='wave'?ease(waveT/.8)*ease((3.5-waveT)/.9)*Math.sin(waveT*5.8)*.10:0;
let target={open:1,width:1};if(mode==='talk')target=audio.paused?{open:mouthAmount,width:mouthWidth}:speechShape();
if(!paused){waveAmount=smooth(waveAmount,wave,dt,13);mouthAmount=smooth(mouthAmount,target.open,dt,20);mouthWidth=smooth(mouthWidth,target.width,dt,15);}
gl.clear(gl.COLOR_BUFFER_BIT);
gl.uniform1f(uniforms.wave,waveAmount);gl.uniform1f(uniforms.openness,mouthAmount);gl.uniform1f(uniforms.width,mouthWidth);gl.uniform1f(uniforms.blink,eyelid);gl.uniform1f(uniforms.breathe,reduced.matches?0:Math.sin(time*1.7));
gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);
requestAnimationFrame(render);}
requestAnimationFrame(render);document.querySelector('#ready').textContent='Originale preservato · animazione 2D · audio italiano';

document.addEventListener('visibilitychange',()=>{if(document.hidden){paused=true;audio.pause();document.querySelector('#pause').textContent='Riprendi';}});
