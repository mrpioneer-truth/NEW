'use strict';
window.G = window.G || {};
// 저해상도 WebGL 렌더러: 장면을 작은 프레임버퍼에 그린 뒤 DSLR 뷰파인더 후처리로 확대한다.
(function (G) {
  const STRIDE = 36; // pos3 + normal3 + color3 (float32)
  const DEFAULT_LOW_H = 180;
  const NEAR = 0.05;
  const FAR = 120;
  const M = new Float32Array(16);
  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  const SCENE_VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;
uniform mat4 uProj, uView, uModel;
varying vec3 vCol, vNor, vW;
void main(){
  vec4 w = uModel * vec4(aPos, 1.);
  vW = w.xyz; vCol = aCol; vNor = (uModel * vec4(aNor, 0.)).xyz;
  gl_Position = uProj * uView * w;
}`;

  const SCENE_FS = `
precision mediump float;
varying vec3 vCol, vNor, vW;
uniform vec3 uTint, uFogCol, uEye, uLight;
uniform float uEmit, uGrid, uTexOn, uAmb, uLightOn, uFogDist, uFlash;
uniform sampler2D uTex;
void main(){
  vec3 base = vCol * uTint;
  if (uTexOn > .5) {
    vec4 t = texture2D(uTex, vCol.xy);
    float l = dot(t.rgb, vec3(.299, .587, .114));
    if (l > .72) discard;
    base = uTint * (1. - l);
  }
  vec3 n = normalize(vNor);
  float sun = max(dot(n, vec3(.38, .8, .46)), 0.) * .42;
  vec3 L = uLight - vW; float ld = length(L);
  float fall = clamp(1. - ld / 11., 0., 1.);
  float pl = uLightOn * fall * (.4 + .6 * max(dot(n, L / max(ld, .001)), 0.));
  vec3 c = base * (uAmb + sun + pl + uFlash * fall);
  if (uGrid > 0.) { vec2 g = abs(fract(vW.xz) - .5); c *= 1. - step(.45, max(g.x, g.y)) * .32 * uGrid; }
  c = mix(c, base * 1.25, uEmit);
  float f = clamp(length(vW - uEye) / uFogDist, 0., 1.);
  gl_FragColor = vec4(mix(c, uFogCol, f * f), 1.);
}`;

  const POST_VS = `
attribute vec3 aPos; varying vec2 vUV;
void main(){ vUV = aPos.xy * .5 + .5; gl_Position = vec4(aPos.xy, 0., 1.); }`;

  // 색수차, 센서 노이즈, 계조 감소, 비네팅, 글리치 띠, LCD 줄무늬
  const POST_FS = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uTime, uHurt, uMirror, uMono, uShift;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUV;
  if (uMirror > .5) uv.x = 1. - uv.x;
  vec2 c = uv - .5;
  float r2 = dot(c, c);
  uv = .5 + c * (1. - .08 * r2);
  float tf = floor(uTime * 24.);
  float band = floor(uv.y * 48.);
  float g = step(.55, hash(vec2(band, tf))) * uShift;
  uv.x += (hash(vec2(tf, band)) - .5) * .1 * g;
  vec2 px = (floor(uv * uRes) + .5) / uRes;
  float ab = (1.2 + 5. * r2 + 8. * uShift) / uRes.x;
  vec3 col = vec3(texture2D(uScene, px + vec2(ab, 0.)).r, texture2D(uScene, px).g, texture2D(uScene, px - vec2(ab, 0.)).b);
  col += (hash(floor(uv * uRes) + tf * 1.37) - .5) * .075;
  col = pow(max(col, 0.), vec3(.92)) * vec3(1.05, 1., .92);
  float l = dot(col, vec3(.299, .587, .114));
  col = mix(col, vec3(l) * vec3(1.08, 1., .86), uMono);
  col = floor(col * 28.) / 28.;
  col *= 1. - r2 * 1.25;
  col = mix(col, vec3(.75, .04, .03), clamp(uHurt, 0., 1.) * (.25 + r2 * 2.2));
  col *= .94 + .06 * step(.5, fract(gl_FragCoord.y * .5));
  gl_FragColor = vec4(col, 1.);
}`;

  // 단위 상자의 여섯 면. 면마다 고정 음영을 구워 넣어 조명이 약해도 형태가 읽히게 한다.
  const FACES = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], 0.78],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], 0.78],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], 1],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 0.5],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], 0.88],
    [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], 0.88],
  ];
  const QUAD_ORDER = [0, 1, 2, 0, 2, 3];

  function pushBox(out, x, y, z, w, h, d, col) {
    for (const [n, q, shade] of FACES) {
      for (const i of QUAD_ORDER) {
        const c = q[i];
        out.push(x + c[0] * w, y + c[1] * h, z + c[2] * d, n[0], n[1], n[2], col[0] * shade, col[1] * shade, col[2] * shade);
      }
    }
    return out;
  }

  // 이동·Y축 회전(yaw)·X축 기울기(pitch, +면 위를 향함)·크기. 로컬 +z가 전방.
  function trs(x, y, z, yaw, pitch, sx, sy, sz) {
    const cy = Math.cos(yaw), syw = Math.sin(yaw), cx = Math.cos(-pitch), sxp = Math.sin(-pitch);
    M[0] = cy * sx; M[1] = 0; M[2] = -syw * sx; M[3] = 0;
    M[4] = syw * sxp * sy; M[5] = cx * sy; M[6] = cy * sxp * sy; M[7] = 0;
    M[8] = syw * cx * sz; M[9] = -sxp * sz; M[10] = cy * cx * sz; M[11] = 0;
    M[12] = x; M[13] = y; M[14] = z; M[15] = 1;
    return M;
  }

  function perspective(fov, aspect) {
    const t = 1 / Math.tan(fov / 2), nf = 1 / (NEAR - FAR);
    return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (FAR + NEAR) * nf, -1, 0, 0, 2 * FAR * NEAR * nf, 0]);
  }

  function lookAt(e, c) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    let xx = zz, xz = -zx; // up(0,1,0) × z
    const xy = 0;
    const xl = Math.hypot(xx, xz) || 1; xx /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
    ]);
  }

  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('셰이더 오류: ' + gl.getShaderInfoLog(s));
    return s;
  }

  function makeProgram(gl, vs, fs, names) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    ['aPos', 'aNor', 'aCol'].forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('셰이더 링크 오류: ' + gl.getProgramInfoLog(p));
    const u = {};
    names.forEach((n) => { u[n] = gl.getUniformLocation(p, n); });
    return { p, u };
  }

  const gfx = {
    lowH: DEFAULT_LOW_H,
    pushBox,
    trs,

    init(canvas) {
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
      if (!gl) throw new Error('이 브라우저에서 WebGL을 사용할 수 없습니다.');
      this.gl = gl;
      this.canvas = canvas;
      this.scene = makeProgram(gl, SCENE_VS, SCENE_FS, ['uProj', 'uView', 'uModel', 'uTint', 'uFogCol', 'uEye', 'uLight', 'uEmit', 'uGrid', 'uTexOn', 'uAmb', 'uLightOn', 'uFogDist', 'uFlash', 'uTex']);
      this.post = makeProgram(gl, POST_VS, POST_FS, ['uScene', 'uRes', 'uTime', 'uHurt', 'uMirror', 'uMono', 'uShift']);
      this.cubeMesh = this.mesh(pushBox([], -0.5, -0.5, -0.5, 1, 1, 1, [1, 1, 1]));
      // 스프라이트 사각형: 색 슬롯에 UV를 넣는다 (아래 가장자리가 y=0)
      this.quadMesh = this.mesh([
        -0.5, 0, 0, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 0, 0, 1, 1, 1, 0, 0.5, 1, 0, 0, 0, 1, 1, 0, 0,
        -0.5, 0, 0, 0, 0, 1, 0, 1, 0, 0.5, 1, 0, 0, 0, 1, 1, 0, 0, -0.5, 1, 0, 0, 0, 1, 0, 0, 0,
      ]);
      this.tri = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
      this.resize();
      window.addEventListener('resize', () => this.resize());
    },

    mesh(arr) {
      const gl = this.gl, buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      return { buf, count: arr.length / 9 };
    },

    setStatic(arr) {
      if (this.staticMesh) this.gl.deleteBuffer(this.staticMesh.buf);
      this.staticMesh = this.mesh(arr);
    },

    setLowRes(h) {
      if (this.lowH === h) return;
      this.lowH = h;
      this.resize();
    },

    resize() {
      const gl = this.gl, c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      c.width = Math.round(innerWidth * dpr);
      c.height = Math.round(innerHeight * dpr);
      this.cssW = innerWidth;
      this.cssH = innerHeight;
      this.aspect = innerWidth / Math.max(1, innerHeight);
      this.lowW = Math.max(64, Math.round(this.lowH * this.aspect));
      if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fboTex); gl.deleteRenderbuffer(this.rb); }
      this.fboTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.lowW, this.lowH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.lowW, this.lowH);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    loadTexture(src) {
      const img = new Image();
      img.onload = () => {
        const gl = this.gl;
        this.tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.activeTexture(gl.TEXTURE0);
      };
      img.onerror = () => console.warn('방문자 이미지를 불러오지 못했습니다. 상자 형상으로 대체합니다.');
      img.src = src;
    },

    begin(cam, env) {
      const gl = this.gl, u = this.scene.u;
      this.proj = perspective(cam.fov * Math.PI / 180, this.aspect);
      this.view = lookAt(cam.eye, cam.target);
      this.vp = mul(this.proj, this.view);
      this.eye = cam.eye;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.lowW, this.lowH);
      gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.scene.p);
      gl.uniformMatrix4fv(u.uProj, false, this.proj);
      gl.uniformMatrix4fv(u.uView, false, this.view);
      gl.uniform3fv(u.uFogCol, env.fog);
      gl.uniform1f(u.uFogDist, env.fogDist);
      gl.uniform3fv(u.uEye, cam.eye);
      gl.uniform1f(u.uAmb, env.amb);
      gl.uniform3fv(u.uLight, env.light);
      gl.uniform1f(u.uLightOn, env.lightOn);
      gl.uniform1f(u.uFlash, env.flash);
      gl.uniform1i(u.uTex, 1);
      for (let i = 0; i < 3; i++) gl.enableVertexAttribArray(i);
      this.bound = null;
    },

    draw(mesh, m, r, g, b, emit, grid, texOn) {
      const gl = this.gl, u = this.scene.u;
      if (this.bound !== mesh) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
        gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE, 24);
        this.bound = mesh;
      }
      gl.uniformMatrix4fv(u.uModel, false, m);
      gl.uniform3f(u.uTint, r, g, b);
      gl.uniform1f(u.uEmit, emit || 0);
      gl.uniform1f(u.uGrid, grid || 0);
      gl.uniform1f(u.uTexOn, texOn || 0);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    },

    cube(m, r, g, b, emit, grid) { this.draw(this.cubeMesh, m, r, g, b, emit, grid, 0); },

    drawStatic() { if (this.staticMesh) this.draw(this.staticMesh, IDENTITY, 1, 1, 1, 0, 0, 0); },

    // 카메라를 향해 서는 방문자 형상. 텍스처가 아직 없으면 false.
    sprite(x, y, z, w, h, r, g, b) {
      if (!this.tex) return false;
      const yaw = Math.atan2(this.eye[0] - x, this.eye[2] - z);
      this.draw(this.quadMesh, trs(x, y, z, yaw, 0, w, h, 1), r, g, b, 1, 0, 1);
      return true;
    },

    end(post) {
      const gl = this.gl, u = this.post.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.post.p);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      this.bound = null;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.uniform1i(u.uScene, 0);
      gl.uniform2f(u.uRes, this.lowW, this.lowH);
      gl.uniform1f(u.uTime, post.time);
      gl.uniform1f(u.uHurt, post.hurt);
      gl.uniform1f(u.uMirror, post.mirror);
      gl.uniform1f(u.uMono, post.mono);
      gl.uniform1f(u.uShift, post.shift);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    // 월드 좌표 → CSS 화면 좌표. 카메라 뒤쪽이면 null.
    project(x, y, z) {
      const m = this.vp;
      if (!m) return null;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w < 0.1) return null;
      const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      if (cx < -1.2 || cx > 1.2 || cy < -1.2 || cy > 1.2) return null;
      return [(cx * 0.5 + 0.5) * this.cssW, (0.5 - cy * 0.5) * this.cssH, w];
    },
  };

  G.gfx = gfx;
})(window.G);
