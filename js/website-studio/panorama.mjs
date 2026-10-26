/** Small original equirectangular panorama viewer. Explicit entry, drag and
 * keyboard navigation; no camera/motion permission and no third-party library.
 */
export function panorama(canvas,url){
 const gl=canvas.getContext('webgl',{alpha:false,antialias:false});if(!gl)throw Error('360 viewing is unavailable on this device');
 const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('360 graphics unavailable');return s;};
 const vs=shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p;gl_Position=vec4(p,0.,1.);}');
 const fs=shader(gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform float yaw;uniform float pitch;uniform float aspect;void main(){vec3 d=normalize(vec3(uv.x*aspect,uv.y,-1.2));float c=cos(pitch),s=sin(pitch);d=vec3(d.x,c*d.y-s*d.z,s*d.y+c*d.z);c=cos(yaw);s=sin(yaw);d=vec3(c*d.x+s*d.z,d.y,-s*d.x+c*d.z);vec2 t=vec2(atan(d.x,-d.z)/6.2831853+.5,.5-asin(clamp(d.y,-1.,1.))/3.14159265);gl_FragColor=texture2D(tex,t);}');
 const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('360 graphics unavailable');gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
 const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 let yaw=0,pitch=0,drag=null,ready=false,dead=false;const image=new Image();image.crossOrigin='anonymous';
 const draw=()=>{if(dead||!ready)return;canvas.width=Math.min(1536,canvas.clientWidth*1.5);canvas.height=Math.min(1024,canvas.clientHeight*1.5);gl.viewport(0,0,canvas.width,canvas.height);gl.uniform1f(gl.getUniformLocation(program,'yaw'),yaw);gl.uniform1f(gl.getUniformLocation(program,'pitch'),pitch);gl.uniform1f(gl.getUniformLocation(program,'aspect'),canvas.width/canvas.height);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);};
 image.onload=()=>{if(dead)return;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);ready=true;draw();};image.onerror=()=>canvas.dispatchEvent(new CustomEvent('panorama-error'));image.src=url;
 const down=e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
 const move=e=>{if(!drag)return;yaw-=(e.clientX-drag.x)*.006;pitch=Math.max(-1.4,Math.min(1.4,pitch+(e.clientY-drag.y)*.006));drag={x:e.clientX,y:e.clientY};draw();};
 const up=()=>{drag=null;};const key=e=>{const keys={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]};if(!keys[e.key])return;e.preventDefault();yaw+=keys[e.key][0];pitch=Math.max(-1.4,Math.min(1.4,pitch+keys[e.key][1]));draw();};
 canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('keydown',key);window.addEventListener('resize',draw);
 return ()=>{if(dead)return;dead=true;image.onload=null;image.onerror=null;canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('keydown',key);window.removeEventListener('resize',draw);gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext();};
}
