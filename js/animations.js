/* ------------------------------------------------------------------
   animations.js: small 3D scenes that show what a stat means (a home
   run clearing the fence, a runner stealing second, ...), drawn with
   Three.js. Put <div data-anim="hr"></div> where a scene should appear.
   Each scene is a function of time, so it plays once when scrolled into
   view and again on "Replay". With reduced motion turned on, or if WebGL
   is unavailable, the scene shows its final picture or just its caption.
   Units: 1 unit = 10 feet. Home plate is the origin, center field is -z,
   first base is +x.
------------------------------------------------------------------- */
(function () {
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const NAVY = 0x0b2545, RED = 0xc8102e, GOLD = 0xffd23f;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));              // progress of t between a and b, 0..1
  const ease = (x) => x * x * (3 - 2 * x);
  const lerp = (a, b, x) => a + (b - a) * x;
  const PI = Math.PI;

  let threePromise = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (!threePromise) threePromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = THREE_URL; s.onload = () => res(window.THREE); s.onerror = () => rej(new Error("Three.js did not load"));
      document.head.appendChild(s);
    });
    return threePromise;
  }

  /* ---------- the ballpark ---------- */
  function stripes(T) {                                           // mowing stripes for the grass
    const c = document.createElement("canvas"); c.width = 8; c.height = 128;
    const g = c.getContext("2d");
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#4f9d5d" : "#58a966"; g.fillRect(0, i * 16, 8, 16); }
    const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(1, 24);
    return tex;
  }
  function crowd(T) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const g = c.getContext("2d"); g.fillStyle = "#1d2f57"; g.fillRect(0, 0, 128, 64);
    const cols = ["#e5ecf7", "#c8102e", "#8aa3cc", "#ffd23f", "#ffffff"];
    for (let i = 0; i < 420; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect((i * 37) % 128, (i * 53 + (i >> 3) * 7) % 64, 5, 5); }
    const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(12, 2);
    return tex;
  }

  function park(T, scene) {
    const lam = (color, extra) => new T.MeshLambertMaterial(Object.assign({ color }, extra || {}));
    scene.background = new T.Color(0x9fd0f5);
    scene.fog = new T.Fog(0x9fd0f5, 80, 210);
    scene.add(new T.HemisphereLight(0xffffff, 0x3f7d4a, 0.5));
    const sun = new T.DirectionalLight(0xffffff, 0.62);
    sun.position.set(14, 32, 14); sun.target.position.set(0, 0, -8); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
    scene.add(sun, sun.target);

    const flat = (geo, mat, x, y, z, rotZ) => { const m = new T.Mesh(geo, mat); m.rotation.set(-PI / 2, 0, rotZ || 0); m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
    flat(new T.PlaneGeometry(420, 420), new T.MeshLambertMaterial({ map: stripes(T) }), 0, 0, -60);
    flat(new T.CircleGeometry(9.8, 48), lam(0xc9a173), 0, 0.01, -6.1);                        // infield dirt
    flat(new T.PlaneGeometry(8.3, 8.3), lam(0x55a563), 0, 0.02, -6.36, PI / 4);               // infield grass
    flat(new T.CircleGeometry(1.5, 24), lam(0xc9a173), 0, 0.03, -6.1);                        // mound dirt
    const mound = new T.Mesh(new T.CylinderGeometry(0.9, 1.2, 0.22, 24), lam(0xc9a173)); mound.position.set(0, 0.11, -6.1); mound.receiveShadow = true; scene.add(mound);
    flat(new T.CircleGeometry(0.34, 5), lam(0xffffff), 0, 0.05, 0, PI);                       // home plate
    for (const [x, z] of [[6.36, -6.36], [0, -12.73], [-6.36, -6.36]]) {                       // bases
      const b = new T.Mesh(new T.BoxGeometry(0.42, 0.08, 0.42), lam(0xffffff)); b.position.set(x, 0.05, z); b.rotation.y = PI / 4; b.castShadow = true; scene.add(b);
    }
    for (const s of [1, -1]) {                                                                 // foul lines
      const l = new T.Mesh(new T.BoxGeometry(0.12, 0.02, 44), lam(0xffffff)); l.position.set(s * 15.56, 0.03, -15.56); l.rotation.y = -s * PI / 4; scene.add(l);
    }
    const R = 38, a0 = PI - 0.9, span = 1.8;                                                   // outfield wall, stands
    const wall = new T.Mesh(new T.CylinderGeometry(R, R, 1.2, 64, 1, true, a0, span), lam(NAVY, { side: T.DoubleSide })); wall.position.y = 0.6; wall.receiveShadow = true; scene.add(wall);
    const cap = new T.Mesh(new T.CylinderGeometry(R, R, 0.1, 64, 1, true, a0, span), lam(GOLD, { side: T.DoubleSide })); cap.position.y = 1.22; scene.add(cap);
    const stands = new T.Mesh(new T.CylinderGeometry(R + 9, R + 0.4, 8, 64, 1, true, a0 - 0.15, span + 0.3), new T.MeshLambertMaterial({ map: crowd(T), side: T.DoubleSide }));
    stands.position.y = 4.1; scene.add(stands);
  }

  /* ---------- people and props ---------- */
  function mesh(T, geo, color, shadow) { const m = new T.Mesh(geo, new T.MeshLambertMaterial({ color })); if (shadow !== false) m.castShadow = true; return m; }
  function person(T, o) {
    const g = new T.Group(); g.rotation.order = "YXZ";
    const skin = 0xf1c9a0, cyl = (a, b, h, c) => mesh(T, new T.CylinderGeometry(a, b, h, 10), c);
    const limb = (x, y, len, r, c) => { const p = new T.Group(); p.position.set(x, y, 0); const m = cyl(r, r * 0.9, len, c); m.position.y = -len / 2; p.add(m); g.add(p); return p; };
    g.legL = limb(-0.07, 0.42, 0.42, 0.065, o.pants); g.legR = limb(0.07, 0.42, 0.42, 0.065, o.pants);
    const torso = cyl(0.14, 0.12, 0.38, o.shirt); torso.position.y = 0.61; g.add(torso);
    g.armL = limb(-0.19, 0.78, 0.36, 0.045, o.shirt); g.armR = limb(0.19, 0.78, 0.36, 0.045, o.shirt);
    const head = mesh(T, new T.SphereGeometry(0.1, 14, 12), skin); head.position.y = 0.95; g.add(head);
    const cap = mesh(T, new T.SphereGeometry(0.108, 14, 8, 0, 2 * PI, 0, PI / 2), o.cap || o.shirt); cap.position.y = 0.97; g.add(cap);
    const brim = mesh(T, new T.BoxGeometry(0.16, 0.015, 0.1), o.cap || o.shirt); brim.position.set(0, 0.975, 0.11); g.add(brim);
    if (o.scale) g.scale.setScalar(o.scale);
    return g;
  }
  function ballMesh(T, r) {
    const g = new T.Group();
    g.add(mesh(T, new T.SphereGeometry(r || 0.1, 16, 12), 0xffffff));
    const seam = mesh(T, new T.TorusGeometry((r || 0.1) * 0.98, (r || 0.1) * 0.08, 6, 20), RED, false); g.add(seam);
    const seam2 = seam.clone(); seam2.rotation.y = PI / 2; g.add(seam2);
    return g;
  }
  function batMesh(T) {                                    // pivot is the handle; swing with .rotation.y, raise with .tilt.rotation.z
    const g = new T.Group(), tilt = new T.Group();
    const geo = new T.CylinderGeometry(0.04, 0.022, 0.95, 10); geo.rotateZ(-PI / 2); geo.translate(0.47, 0, 0);
    tilt.add(mesh(T, geo, 0xb98a52)); g.add(tilt); g.tilt = tilt;
    return g;
  }
  function run(p, ms, speed) {                             // leg and arm swing for running
    const s = Math.sin(ms / (speed || 85));
    p.legL.rotation.x = s * 0.9; p.legR.rotation.x = -s * 0.9; p.armL.rotation.x = -s * 0.9; p.armR.rotation.x = s * 0.9;
  }
  const faceDir = (p, dx, dz) => { p.rotation.y = Math.atan2(dx, dz); };

  /* ---------- scenes: build(T, scene, camera, ui) -> { dur, frame(ms), final() } ---------- */
  const SCENES = {};
  const V = (T, x, y, z) => new T.Vector3(x, y, z);

  SCENES.hr = {
    title: "A home run", voice: true,
    caption: "The batter connects, the ball clears the outfield fence in fair territory, and that is one home run. The home run rate on this page is home runs divided by plate appearances.",
    build(T, scene, cam, ui) {
      park(T, scene);
      const batter = person(T, { shirt: RED, pants: 0xffffff }); batter.position.set(-0.85, 0, 0.05); scene.add(batter);
      const bat = batMesh(T); bat.position.set(-0.66, 0.74, 0.05); scene.add(bat);
      const pitcher = person(T, { shirt: NAVY, pants: 0xdddddd }); pitcher.position.set(0, 0.22, -6.1); scene.add(pitcher);
      const ball = ballMesh(T, 0.13); scene.add(ball);
      const trail = Array.from({ length: 16 }, (_, i) => { const m = new T.Mesh(new T.SphereGeometry(0.08 * (1 - i / 22), 8, 6), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true })); scene.add(m); return m; });
      const N = 70, pts = new Float32Array(N * 3);
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.BufferAttribute(pts, 3));
      const sparks = new T.Points(geo, new T.PointsMaterial({ color: GOLD, size: 0.55, transparent: true })); sparks.frustumCulled = false; scene.add(sparks);
      const CONTACT = 472, FLIGHT = 2500, HOLD = [0.05, 0.82, 0], LAND = [2.4, 2.9, -41.5];
      const flight = (u) => V(T, lerp(HOLD[0], LAND[0], u), 0.82 + 4 * 12.5 * u * (1 - u) + (LAND[1] - 0.82) * u, lerp(HOLD[2], LAND[2], u));
      const camStart = V(T, 2.9, 1.5, 3.7), camHigh = V(T, 9, 21, 12), lookStart = V(T, -0.1, 0.9, -1.6), lookAt = new T.Vector3();
      return {
        dur: 5200,
        cues: [{ at: 2750, say: "Home run!", clip: "home-run" }],
        frame(ms) {
          const sw = ease(seg(ms, 300, 640));
          bat.rotation.y = lerp(-1.45, 1.6, sw); bat.tilt.rotation.z = lerp(0.9, 0.05, seg(ms, 300, 520));
          batter.rotation.y = PI / 2 + lerp(0.55, -0.75, sw);
          let bp;
          if (ms < CONTACT) bp = V(T, 0, 0, 0).lerpVectors(V(T, 0.05, 1.3, -6.2), V(T, HOLD[0], HOLD[1], HOLD[2]), seg(ms, 0, CONTACT));
          else bp = flight(clamp((ms - CONTACT) / FLIGHT));
          ball.position.copy(bp); ball.rotation.x = ms / 90; ball.rotation.z = ms / 130;
          trail.forEach((m, i) => {
            const u = clamp((ms - CONTACT) / FLIGHT - (i + 1) * 0.022);
            if (ms < CONTACT || u <= 0) { m.visible = false; return; }
            m.visible = true; m.position.copy(flight(u)); m.material.opacity = (1 - i / 16) * 0.55;
          });
          const k = ease(seg(ms, 520, 1700));
          cam.position.lerpVectors(camStart, camHigh, k);
          lookAt.lerpVectors(lookStart, bp, k); cam.lookAt(lookAt);
          const big = 1 + 4 * k; ball.scale.setScalar(big); trail.forEach((m) => m.scale.setScalar(big));
          const b = seg(ms, 3000, 4300);
          const p = geo.attributes.position;
          for (let i = 0; i < N; i++) {
            const a = (i / N) * PI * 2, sp = 2 + (i % 5) * 1.3;
            p.setXYZ(i, LAND[0] + Math.cos(a) * sp * b * 2, 6 + Math.sin(a * 3) * sp * b - 6 * b * b, LAND[2] + 2 + Math.sin(a) * sp * b);
          }
          p.needsUpdate = true; sparks.visible = b > 0; sparks.material.opacity = 1 - b;
          ui.big("HOME RUN!", seg(ms, 2800, 3200));
          ui.hud(ms > 2800 ? "+1 HR" : "");
        },
        final() { this.frame(4400); }
      };
    }
  };

  SCENES.so = {
    title: "A strikeout", voice: true,
    caption: "Three strikes and the batter is out. This is the catcher's view with the strike zone drawn in. Each dot marks where a pitch crossed the plate: red for a strike, blue for a ball. Here the count runs to 3 balls and 2 strikes before the sixth pitch is swung at and missed. The strikeout rate is strikeouts divided by plate appearances.",
    build(T, scene, cam, ui) {
      park(T, scene);
      const batter = person(T, { shirt: RED, pants: 0xffffff }); batter.position.set(-0.85, 0, 0.05); batter.rotation.y = PI / 2; scene.add(batter);
      const bat = batMesh(T); bat.position.set(-0.66, 0.74, 0.05); scene.add(bat);
      // The camera is the catcher's eyes, so no catcher body: just the mitt at the bottom of the picture.
      const ZX = 0.3, ZB = 0.42, ZT = 0.95;                                   // strike zone: plate width, knees to chest
      const zone = new T.Group(); scene.add(zone);
      const lineMat = new T.LineBasicMaterial({ color: 0xffffff });
      const pts = [];
      const L = (x1, y1, x2, y2) => pts.push(new T.Vector3(x1, y1, 0), new T.Vector3(x2, y2, 0));
      L(-ZX, ZB, ZX, ZB); L(ZX, ZB, ZX, ZT); L(ZX, ZT, -ZX, ZT); L(-ZX, ZT, -ZX, ZB);
      for (const f of [1 / 3, 2 / 3]) { L(-ZX + 2 * ZX * f, ZB, -ZX + 2 * ZX * f, ZT); L(-ZX, ZB + (ZT - ZB) * f, ZX, ZB + (ZT - ZB) * f); }
      zone.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), lineMat));
      const glass = new T.Mesh(new T.PlaneGeometry(2 * ZX, ZT - ZB), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, depthWrite: false, side: T.DoubleSide }));
      glass.position.y = (ZB + ZT) / 2; zone.add(glass);
      const mitt = mesh(T, new T.SphereGeometry(0.17, 12, 10), 0x7a4b22); scene.add(mitt);
      const pitcher = person(T, { shirt: NAVY, pants: 0xdddddd }); pitcher.position.set(0, 0.22, -6.1); scene.add(pitcher);
      const ball = ballMesh(T, 0.1); scene.add(ball);

      // Where each pitch crosses the plate (x, y), what the umpire calls it, and when the batter swings (ms into the pitch).
      const PITCHES = [
        { x: 0.55, y: 1.1, call: "BALL" },                     // high and outside
        { x: 0.0, y: 0.8, call: "STRIKE" },                      // taken down the middle
        { x: -0.45, y: 0.25, call: "BALL" },                     // low and inside
        { x: 0.12, y: 0.3, call: "STRIKE", swing: 900 },         // chases a low pitch
        { x: -0.12, y: 1.2, call: "BALL" },                      // above the zone: 3-2
        { x: -0.08, y: 0.7, call: "STRIKE", swing: 1040 },       // swings late through one in the zone
      ];
      const PERIOD = 1300, CROSS = 940, UK = 0.8369, UX = 0.887;   // ball crosses the plate at CROSS ms into a pitch
      PITCHES.forEach((p) => { p.end = new T.Vector3(0.1 + (p.x - 0.1) / UX, 1.45 + (p.y - 1.45) / UK, 0.75); });
      const rest = new T.Vector3(0.22, -0.05, 0.9);
      const dots = PITCHES.map((p) => {
        const d = new T.Mesh(new T.CircleGeometry(0.055, 20), new T.MeshBasicMaterial({ color: p.call === "STRIKE" ? 0xe5243b : 0x2f9bff }));
        d.position.set(p.x, p.y, 0.03); d.visible = false; scene.add(d); return d;
      });
      return {
        dur: PITCHES.length * PERIOD + 1500,
        cues: PITCHES.map((p, i) => ({ at: i * PERIOD + CROSS + 60, say: i === PITCHES.length - 1 ? "Strike three!|You're out!" : p.call === "STRIKE" ? "Strike!" : "Ball!",
          clip: i === PITCHES.length - 1 ? "strike-three" : p.call === "STRIKE" ? "strike" : "ball" })),
        frame(ms) {
          const n = Math.min(PITCHES.length - 1, Math.floor(ms / PERIOD)), local = ms - n * PERIOD, P = PITCHES[n];
          pitcher.armR.rotation.x = lerp(0.35 * PI, 1.55 * PI, ease(seg(local, 0, 470))) + (local > 520 ? lerp(0, 0.45 * PI, seg(local, 520, 1000)) : 0);
          pitcher.rotation.x = lerp(0, 0.25, seg(local, 300, 520)) - lerp(0, 0.25, seg(local, 520, 900));
          const u = seg(local, 450, 1000);
          ball.visible = local >= 450 && local < 1250;
          ball.position.set(lerp(0.1, P.end.x, u), lerp(1.45, P.end.y, u * u * 0.5 + u * 0.5), lerp(-5.9, P.end.z, u));
          ball.rotation.z = ms / 40;
          mitt.position.lerpVectors(rest, P.end, ease(seg(local, 250, 1000)));
          let th = -1.45, tilt = 0.9, twist = 0;
          if (P.swing) {
            const c = P.swing, s = seg(local, c - 170, c + 170);
            th = lerp(-1.45, 1.6, ease(s)); if (local > 1190) th = lerp(1.6, -1.45, seg(local, 1190, 1290));
            tilt = lerp(0.9, 0.05, seg(local, c - 170, c - 40)); twist = lerp(0.5, -0.7, ease(s));
          }
          bat.rotation.y = th; bat.tilt.rotation.z = tilt; batter.rotation.y = PI / 2 + twist;
          cam.position.set(0.05 + Math.sin(ms / 2600) * 0.05, 1.3, 2.3); cam.lookAt(0, 0.62, -5);

          let balls = 0, strikes = 0;
          PITCHES.forEach((p, i) => {
            const t = ms - (i * PERIOD + CROSS);
            if (t >= 0) { if (p.call === "STRIKE") strikes++; else balls++; }
            dots[i].visible = t >= 0; dots[i].scale.setScalar(t >= 0 ? lerp(2.4, 1, ease(seg(t, 0, 220))) : 1);
          });
          const t = local - CROSS, pulse = t >= 0 ? seg(t, 0, 60) * (1 - seg(t, 230, 380)) : 0;
          const flash = t >= 0 ? 1 - seg(t, 0, 560) : 0;                   // the zone lights up gold as the pitch crosses it
          lineMat.color.setRGB(1, lerp(1, 0.82, flash), lerp(1, 0.25, flash)); glass.material.opacity = 0.14 + 0.3 * flash;
          const done = ms >= (PITCHES.length - 1) * PERIOD + CROSS + 450;
          ui.big(done ? "STRIKEOUT!" : P.call, done ? seg(ms, (PITCHES.length - 1) * PERIOD + CROSS + 450, (PITCHES.length - 1) * PERIOD + CROSS + 800) : pulse);
          const dot = (c, on, tot) => Array.from({ length: tot }, (_, k) => `<span style="color:${c};opacity:${k < on ? 1 : 0.3}">●</span>`).join("");
          ui.hud(`BALLS ${dot("#2f9bff", balls, 4)} &nbsp; STRIKES ${dot("#e5243b", strikes, 3)}`);
        },
        final() { this.frame(PITCHES.length * PERIOD + 1200); }
      };
    }
  };

  function diamondScene(T, scene, cam, ui, o) {
    park(T, scene);
    const runner = person(T, { shirt: RED, pants: 0xffffff }); scene.add(runner);
    const ball = ballMesh(T, 0.11); scene.add(ball);
    for (const f of o.fielders) { const p = person(T, { shirt: NAVY, pants: 0xdddddd }); p.position.set(f[0], 0, f[1]); faceDir(p, f[2], f[3]); scene.add(p); }
    return { runner, ball };
  }

  SCENES.sb = {
    title: "A stolen base", voice: true,
    caption: "The runner breaks for second as the pitch is thrown and slides in before the catcher's throw arrives. A steal is counted each time a runner takes the next base without a hit, walk or error.",
    build(T, scene, cam, ui) {
      const { runner, ball } = diamondScene(T, scene, cam, ui, { fielders: [[-0.7, -11.7, 0.3, 1]] });
      const catcher = person(T, { shirt: 0x2a5aa0, pants: 0x2a5aa0 }); catcher.position.set(0, 0, 1.1); catcher.rotation.y = PI; scene.add(catcher);
      const glove = mesh(T, new T.SphereGeometry(0.16, 12, 10), 0x7a4b22); scene.add(glove);
      const A = V(T, 5.7, 0, -6.9), B = V(T, 0.1, 0, -12.5), dir = B.clone().sub(A);
      const throwFrom = V(T, 0.2, 1.0, 0.9), throwTo = V(T, -0.35, 0.55, -12.2);
      return {
        dur: 4200,
        cues: [{ at: 2000, say: "Safe!", clip: "safe" }],
        frame(ms) {
          const r = ease(seg(ms, 600, 1750)), slide = ease(seg(ms, 1450, 1750));
          runner.position.copy(A).addScaledVector(dir, r); faceDir(runner, dir.x, dir.z);
          runner.rotation.x = -PI / 2 * slide * 0.92; runner.position.y = 0.1 * slide;
          if (ms < 600 || slide > 0) { runner.legL.rotation.x = runner.legR.rotation.x = runner.armL.rotation.x = runner.armR.rotation.x = 0; } else run(runner, ms);
          const t = seg(ms, 750, 2000);
          ball.visible = ms >= 750;
          ball.position.lerpVectors(throwFrom, throwTo, t); ball.position.y += Math.sin(t * PI) * 1.4; ball.rotation.x = ms / 60;
          glove.position.set(-0.55, 0.75, -11.9); if (ms >= 2000) glove.position.set(0.05, 0.25, -12.4);
          cam.position.set(-4.4 + Math.sin(ms / 2800) * 0.5, 5.4, -0.8); cam.lookAt(2.2, 0, -9.6);
          ui.big("SAFE!", seg(ms, 2000, 2300)); ui.hud(ms > 2300 ? "+1 SB" : "");
        },
        final() { this.frame(3400); }
      };
    }
  };

  SCENES.triple = {
    title: "A triple", voice: true,
    caption: "The ball falls in the gap, and the batter keeps running past first and second and slides into third before the relay. A triple is a hit worth three bases, the rarest of the extra-base hits.",
    build(T, scene, cam, ui) {
      const { runner, ball } = diamondScene(T, scene, cam, ui, { fielders: [[-6.0, -6.9, 1, 0], [6.0, -6.8, -1, 0], [0.3, -12.0, 0, 1]] });
      const of = person(T, { shirt: NAVY, pants: 0xdddddd }); of.position.set(18, 0, -34); scene.add(of);
      const bases = [V(T, 0, 0, 0.2), V(T, 6.36, 0, -6.36), V(T, 0, 0, -12.73), V(T, -6.36, 0, -6.36)];
      const LEG = [[400, 1300], [1300, 2150], [2150, 3000]];
      const gap = V(T, 15, 0.15, -31), home = V(T, 0, 0.82, 0), third = V(T, -6.2, 0.7, -6.9);
      return {
        dur: 5000,
        cues: [{ at: 3000, say: "Safe!", clip: "safe" }],
        frame(ms) {
          let pos = bases[0], moving = ms >= 400 && ms < 3000;
          if (ms >= 3000) pos = bases[3].clone().add(V(T, -0.3, 0, 0.3));
          else if (ms >= 400) { const i = LEG.findIndex((l) => ms < l[1]), f = seg(ms, LEG[i][0], LEG[i][1]); pos = bases[i].clone().lerp(bases[i + 1], f); faceDir(runner, bases[i + 1].x - bases[i].x, bases[i + 1].z - bases[i].z); }
          runner.position.copy(pos);
          const slide = ease(seg(ms, 2750, 3000));
          runner.rotation.x = -PI / 2 * slide * 0.92; runner.position.y = 0.1 * slide;
          if (moving && slide === 0) run(runner, ms, 70); else { runner.legL.rotation.x = runner.legR.rotation.x = runner.armL.rotation.x = runner.armR.rotation.x = 0; }
          if (ms < 1400) { const t = seg(ms, 300, 1400); ball.position.lerpVectors(home, gap, t); ball.position.y += Math.sin(t * PI) * 5; }
          else if (ms < 1900) ball.position.copy(gap);
          else { const t = seg(ms, 1900, 3500); ball.position.lerpVectors(gap.clone().setY(1), third, t); ball.position.y += Math.sin(t * PI) * 7; }
          ball.visible = ms >= 300; ball.rotation.x = ms / 70;
          of.position.set(lerp(18, 15.4, ease(seg(ms, 600, 1500))), 0, lerp(-34, -31.4, ease(seg(ms, 600, 1500)))); faceDir(of, -1, 0.3);
          cam.position.set(Math.sin(ms / 3500) * 3, 10.5, 9.5); cam.lookAt(2, 0, -15);
          ui.big("TRIPLE!", seg(ms, 3000, 3300)); ui.hud(ms > 3300 ? "3 bases on one hit" : "");
        },
        final() { this.frame(4300); }
      };
    }
  };

  /* ---------- scoreboard scenes: 3D bars that grow one at a time ---------- */
  function label(T, str, color, size, w, h) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const g = c.getContext("2d"); g.font = `900 ${size}px "Big Shoulders Display", Arial Narrow, sans-serif`; g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(str, 64, 34);
    const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true })); s.scale.set(w, h, 1);
    return s;
  }
  function board(T, scene, cam, ui, cfg) {
    scene.background = new T.Color(NAVY); scene.fog = null;
    scene.add(new T.HemisphereLight(0xffffff, 0x1a2f55, 0.95));
    const sun = new T.DirectionalLight(0xffffff, 0.8); sun.position.set(-6, 12, 8); scene.add(sun);
    const n = cfg.cells.length, gap = 1.2, x0 = -((n - 1) * gap) / 2;
    const floor = new T.Mesh(new T.PlaneGeometry(240, 120), new T.MeshLambertMaterial({ color: 0x102a52 })); floor.rotation.x = -PI / 2; scene.add(floor);
    const items = cfg.cells.map((v, i) => {
      const x = x0 + i * gap;
      const tile = new T.Mesh(new T.BoxGeometry(1, 0.14, 1), new T.MeshLambertMaterial({ color: 0x2a5aa0 })); tile.position.set(x, 0.07, 0); scene.add(tile);
      const hgt = cfg.height(v);
      const bar = new T.Mesh(new T.BoxGeometry(0.78, 1, 0.78), new T.MeshLambertMaterial({ color: v ? cfg.color : 0x6b83a8 })); bar.position.x = x; scene.add(bar);
      const num = label(T, String(i + 1), "#cfe0f7", 46, 0.8, 0.4); num.position.set(x, 0.16, 0.85); scene.add(num);
      const mark = label(T, cfg.mark(v), v ? "#ffd23f" : "#9fb6d9", 60, 1.1, 0.55); scene.add(mark);
      return { bar, mark, v, hgt, x };
    });
    return {
      dur: n * cfg.step + 2000,
      frame(ms) {
        let shown = 0, sum = 0;
        items.forEach((it, i) => {
          const k = ease(seg(ms, i * cfg.step, i * cfg.step + 350));
          const h = Math.max(0.001, it.hgt * k);
          it.bar.scale.y = h; it.bar.position.y = 0.14 + h / 2;
          it.mark.position.set(it.x, 0.14 + h + 0.4, 0); it.mark.visible = k > 0.05;
          if (k > 0.5) { shown++; sum += it.v; }
        });
        cam.position.set(Math.sin(ms / 2600) * 2.4, 5.6, 11.5); cam.lookAt(0, 1.0, 0);
        ui.hud(cfg.heading);
        ui.formula(shown ? cfg.line(sum, shown) : "");
      },
      final() { this.frame(1e9); }
    };
  }

  SCENES.hit = {
    title: "Batting average",
    caption: "Batting average is hits divided by at-bats. In ten at-bats, three hits is a .300 average. Walks do not count as at-bats, which is why on-base percentage is a separate number.",
    build: (T, s, c, u) => board(T, s, c, u, {
      heading: "TEN AT-BATS", cells: [0, 1, 0, 0, 1, 0, 0, 0, 1, 0], step: 450, color: GOLD, height: (v) => (v ? 3 : 0.25), mark: (v) => (v ? "H" : "out"),
      line: (h, ab) => `${h} hits ÷ ${ab} at-bats = ${(h / ab).toFixed(3).replace(/^0/, "")}`,
    })
  };
  SCENES.k9 = {
    title: "Strikeouts per 9 innings",
    caption: "K/9 scales a pitcher's strikeouts to a full nine-inning game, so starters and relievers with different workloads can be compared. This pitcher struck out nine in nine innings.",
    build: (T, s, c, u) => board(T, s, c, u, {
      heading: "NINE INNINGS: STRIKEOUTS", cells: [1, 0, 2, 1, 1, 2, 0, 1, 1], step: 500, color: GOLD, height: (v) => v * 1.5 + 0.2, mark: (v) => (v ? "K".repeat(v) : "0"),
      line: (k, inn) => `${k} K in ${inn} IP → ${((k * 9) / inn).toFixed(1)} K/9`,
    })
  };
  SCENES.era = {
    title: "Earned run average",
    caption: "ERA is earned runs allowed per nine innings. Three earned runs in nine innings is a 3.00 ERA. Runs that score because of a fielding error are not charged to the pitcher.",
    build: (T, s, c, u) => board(T, s, c, u, {
      heading: "NINE INNINGS: EARNED RUNS", cells: [0, 0, 1, 0, 0, 2, 0, 0, 0], step: 500, color: RED, height: (v) => v * 1.7 + 0.2, mark: (v) => String(v),
      line: (er, inn) => `${er} ER in ${inn} IP → ${((er * 9) / inn).toFixed(2)} ERA`,
    })
  };

  /* ---------- the umpire's voice (only when the site's sound toggle is on) ---------- */
  const soundOn = () => !!(window.SiteSound && window.SiteSound.isEnabled && window.SiteSound.isEnabled());
  // Browsers only have the voices the device ships with, so rank them: newer "premium / natural" voices sound far less robotic
  // than the default, and a deep male voice suits an umpire. The viewer can override the choice with the picker on the card.
  const NOVELTY = /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|zarvox|albert|fred|junior|kathy|ralph|deranged|hysterical/i;
  function rankVoice(v) {
    let s = 0;
    if (!/^en/i.test(v.lang)) return -99;
    if (NOVELTY.test(v.name)) return -50;
    if (/premium|enhanced|natural|neural|siri|online/i.test(v.name)) s += 6;
    if (/daniel|aaron|evan|guy|davis|ryan|james|tom|david|mark|alex|arthur|oliver|gordon|male/i.test(v.name)) s += 3;
    if (/en[-_]US/i.test(v.lang)) s += 2;
    if (/google/i.test(v.name)) s += 1;
    return s;
  }
  const englishVoices = () => ("speechSynthesis" in window ? speechSynthesis.getVoices() : []).filter((v) => /^en/i.test(v.lang) && !NOVELTY.test(v.name));
  function pickVoice() {
    let saved = null; try { saved = localStorage.getItem("mlbUmpireVoice"); } catch (e) { /* private mode */ }
    const all = englishVoices();
    return all.find((v) => v.name === saved) || all.slice().sort((a, b) => rankVoice(b) - rankVoice(a))[0] || null;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function speakOne(text, loud) {
    return new Promise((res) => {
      const u = new SpeechSynthesisUtterance(text), v = pickVoice();
      if (v) u.voice = v;
      u.pitch = 0.82 + Math.random() * 0.12;          // a little different every call, like a person
      u.rate = (loud ? 1.12 : 1.02) + Math.random() * 0.08;
      u.volume = 1;
      u.onend = u.onerror = () => res();
      speechSynthesis.speak(u);
      setTimeout(res, 2500);                           // never hang if the browser drops the event
    });
  }
  // Recorded calls beat any synthesized voice: if audio/umpire-<clip>.mp3 (or .m4a/.wav/.ogg) exists it is played instead.
  const clipCache = {};
  function findClip(clip) {
    if (!clipCache[clip]) {
      const exts = ["mp3", "m4a", "wav", "ogg"];
      clipCache[clip] = (async () => {
        for (const e of exts) {
          const url = `audio/umpire-${clip}.${e}`;
          try { const r = await fetch(url, { method: "HEAD" }); if (r.ok) return url; } catch (err) { /* offline */ }
        }
        return null;
      })();
    }
    return clipCache[clip];
  }
  let current = null;
  async function playClip(clip) {
    const url = clip && (await findClip(clip));
    if (!url) return false;
    try {
      if (current) current.pause();
      current = new Audio(url); current.volume = 1;
      await current.play();
      return true;
    } catch (e) { return false; }
  }
  // `text` may hold several shouts separated by "|" ("Strike three!|You're out!"); they are spoken with a short beat between.
  async function say(text, clip) {
    if (!soundOn()) return;
    if (await playClip(clip)) return;
    if (!("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      const parts = text.split("|");
      for (let i = 0; i < parts.length; i++) { await speakOne(parts[i], true); if (i < parts.length - 1) await wait(220); }
    } catch (e) { /* speech is a bonus */ }
  }
  const SPEED = 0.72;                       // scene time per real time: below 1 slows every scene down

  /* ---------- the card: canvas, overlay text, replay ---------- */
  function mount(host) {
    const def = SCENES[host.dataset.anim];
    if (!def) return;
    host.classList.add("stat-anim");
    host.innerHTML = `<div class="anim-head"><span class="anim-title">Watch it: ${def.title}</span><button class="btn" type="button">↻ Replay</button></div>
      <div class="anim-stage"><canvas class="anim-canvas" role="img"></canvas><div class="anim-hud"></div><div class="anim-big"></div><div class="anim-formula"></div></div>
      <p class="anim-caption"></p>`;
    host.querySelector(".anim-caption").textContent = def.caption;
    if (def.voice) {
      const hint = document.createElement("p"); hint.className = "anim-hint";
      hint.textContent = "🔊 The umpire calls it out loud when sound is on (turn on \u201cClick sounds\u201d in the top bar).";
      const pick = document.createElement("select"); pick.className = "anim-voice"; pick.setAttribute("aria-label", "Umpire voice");
      const fill = () => {
        const cur = pickVoice();
        pick.innerHTML = englishVoices().map((v) => `<option value="${v.name.replace(/"/g, "&quot;")}"${cur && v.name === cur.name ? " selected" : ""}>${v.name}</option>`).join("");
        pick.hidden = !pick.options.length;
      };
      fill();
      if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", fill);
      pick.addEventListener("change", () => { try { localStorage.setItem("mlbUmpireVoice", pick.value); } catch (e) { /* ignore */ } say("Strike three!|You're out!", "strike-three"); });
      hint.append(" Voice: ", pick);
      host.insertBefore(hint, host.querySelector(".anim-stage").nextSibling);
    }
    const stage = host.querySelector(".anim-stage"), canvas = host.querySelector("canvas");
    canvas.setAttribute("aria-label", def.title + ": " + def.caption);
    const hud = host.querySelector(".anim-hud"), big = host.querySelector(".anim-big"), formula = host.querySelector(".anim-formula");
    let lastHud = null, lastBig = null, lastFormula = null;
    const ui = {
      hud(h) { if (h !== lastHud) { hud.innerHTML = h; lastHud = h; } },
      big(t, a) { big.textContent = t; big.style.opacity = a; big.style.transform = `translate(-50%,-50%) scale(${0.6 + 0.4 * a})`; },
      formula(t) { if (t !== lastFormula) { formula.textContent = t; formula.style.opacity = t ? 1 : 0; lastFormula = t; } },
    };

    let T, renderer, scene, cam, s, raf = 0, started = false;
    function render() { renderer.render(scene, cam); }
    function resize() {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!renderer || !w || !h) return;
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    function play() {
      cancelAnimationFrame(raf);
      if (!s) return;
      if (reduce) { s.final(); render(); return; }
      const t0 = performance.now();
      let prev = -1;
      const tick = (now) => {
        const ms = Math.max(0, (now - t0) * SPEED);
        s.frame(Math.min(ms, s.dur)); render();
        (s.cues || []).forEach((c) => { if (c.at > prev && c.at <= ms) say(c.say, c.clip); });
        prev = ms;
        if (ms < s.dur) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    function start() {
      if (started) return;
      started = true;
      loadThree().then((three) => {
        T = three;
        renderer = new T.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
        scene = new T.Scene(); cam = new T.PerspectiveCamera(42, 2, 0.1, 400);
        s = def.build(T, scene, cam, ui);
        resize(); if ("ResizeObserver" in window) new ResizeObserver(resize).observe(stage); else window.addEventListener("resize", resize);
        s.final(); render();
        host.seek = (ms) => { cancelAnimationFrame(raf); s.frame(ms); render(); };   // jump to a moment (used for testing)
        play();
      }).catch(() => { stage.hidden = true; });
    }
    host.querySelector("button").addEventListener("click", () => { if (started && s) play(); else start(); });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { threshold: 0.35 });
      io.observe(host);
    } else start();
  }

  document.querySelectorAll("[data-anim]").forEach(mount);
})();
