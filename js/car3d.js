// Up close (Heli, Road and Driver on the real map): each car as a 3D F1 car, drawn by three.js on the map's own canvas as a
// MapLibre custom layer, so cars and buildings hide each other properly. There's no free F1 model whose licence fits, so the
// car is built here, in metres from its middle (x forward, y up, z to the side), roughly a 2026 car: 5.5 m long, 1.9 m wide.
// The bodywork is lofted through cross-sections, the wings are real wing profiles, paint and carbon reflect a soft studio
// light, and each car shows its number and the colour of the tyres it's on. Parts of one material are merged into one shape.
const THREE = "https://cdn.jsdelivr.net/npm/three@0.160.0/+esm";
const ROOM = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm";   // (imports the same three)

export async function carLayer(ml) {
  const [T, { RoomEnvironment }] = await Promise.all([import(THREE), import(ROOM)]);
  const o = new T.Object3D(), parts = {};   // parts[material]: shapes, placed
  const keep = (g, mat) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    g = g.index ? g.toNonIndexed() : g; o.updateMatrix(); g.applyMatrix4(o.matrix); (parts[mat] ||= []).push(g);
  };
  const put = (g, mat, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1]) => {
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz); keep(g, mat);
  };
  const both = f => { f(1); f(-1); };   // each side
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  const shape = pts => new T.Shape(pts.map(p => new T.Vector2(...p)));
  const slab = (pts, depth, bevel = .02) => {   // an outline (x, y) made depth thick (along z, centred), edges rounded
    const g = new T.ExtrudeGeometry(shape(pts), { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
    return g.translate(0, 0, -depth / 2);
  };
  // a wing profile, chord long (leading edge at x = 0, trailing edge at -chord), cambered upwards at the back
  const wing = (chord, span, thick = .1, camber = .12) => {
    const at = (t, side) => { const c = camber * chord * (Math.sin(Math.PI * t) * .5 + t * t), h = thick * chord * (1.4 * Math.sqrt(t) - 1.3 * t - .1 * t * t) * 2.2;
      return [-t * chord, c + side * h / 2]; };
    const pts = []; for (let i = 0; i <= 12; i++) pts.push(at(i / 12, 1)); for (let i = 11; i >= 1; i--) pts.push(at(i / 12, -1));   // over the top, back under
    return slab(pts, span, 0);
  };
  // a smooth body through cross-sections [x, half width, bottom, top, squareness (2 round … 5 boxy), centre z]
  const loft = (st, n = 28) => {
    const pos = [], idx = [], ring = s => { for (let j = 0; j < n; j++) {
      const a = j / n * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), e = 2 / s[4];
      pos.push(s[0], (s[2] + s[3]) / 2 + (s[3] - s[2]) / 2 * Math.sign(sn) * Math.abs(sn) ** e, (s[5] || 0) + s[1] * Math.sign(c) * Math.abs(c) ** e);
    } };
    st.forEach(ring);   // stations from the back forwards
    for (let i = 0; i + 1 < st.length; i++) for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + (j + 1) % n, c = a + n, d = b + n;
      idx.push(a, c, b, c, d, b);
    }
    for (const [i, flip] of [[0, false], [st.length - 1, true]]) {   // close the ends
      const k = pos.length / 3, s = st[i]; pos.push(s[0], (s[2] + s[3]) / 2, s[5] || 0);
      for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + (j + 1) % n; flip ? idx.push(k, b, a) : idx.push(k, a, b); }
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  const tube = (pts, r, n) => new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p => new T.Vector3(...p))), n, r, 8);
  const rod = (mat, a, b, r = .016) => {   // a thin bar from a to b (wishbones)
    const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A);
    o.position.copy(A).add(B).multiplyScalar(.5); o.scale.set(1, 1, 1); o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize());
    keep(new T.CylinderGeometry(r, r, d.length(), 6), mat);
  };
  const across = Math.PI / 2;

  // the body: nose, chassis, cockpit, engine cover tapering to the back (painted), and the spine up to the airbox
  put(loft([[-2.3, .05, .3, .42, 2.5], [-2.05, .1, .24, .52, 2.6], [-1.6, .18, .18, .62, 2.8], [-1, .27, .13, .73, 3], [-.4, .36, .1, .8, 3.2],
            [-.05, .41, .1, .74, 3.4], [.3, .4, .1, .63, 3.6], [.75, .31, .11, .61, 3.2], [1.2, .23, .13, .55, 3], [1.7, .16, .15, .45, 2.8],
            [2.2, .11, .17, .37, 2.5], [2.62, .06, .2, .29, 2.4]]), "team");
  put(loft([[-1.9, .03, .6, .66, 2.4], [-1.3, .08, .66, .84, 2.6], [-.7, .13, .7, .97, 2.8], [-.25, .15, .7, 1.04, 3], [.04, .14, .7, .99, 3]]), "spine");
  for (const s of [1, -1])   // sidepods: an inlet at the front, undercut, tapering in to the back
    put(loft([[-1.55, .06, .17, .27, 2.4, s * .3], [-.95, .15, .13, .38, 3, s * .38], [-.3, .2, .12, .47, 3.4, s * .46], [.3, .21, .14, .52, 3.6, s * .53], [.62, .19, .17, .5, 3.6, s * .56]]), "team");
  for (const s of [1, -1]) put(box(.02, .26, .3), "carbon", [.635, .34, s * .56]);   // the inlets' dark mouths
  put(new T.CylinderGeometry(.21, .21, .02, 24), "carbon", [.1, .615, 0], [0, 0, 0], [1.75, 1, 1.05]);   // cockpit opening
  put(new T.SphereGeometry(.13, 22, 16), "helmet", [.02, .75, 0]);
  put(new T.SphereGeometry(.132, 22, 16, Math.PI - .9, 1.8, 1.05, .5), "visor", [.02, .75, 0]);   // the visor: a band round the front
  put(box(.03, .1, .14), "cam", [.045, .9, 0]);                                    // airbox intake
  put(box(.1, .035, .24), "cam", [-.25, 1.055, 0]);                                // T-camera
  put(slab([[-.5, .9], [-1.9, .64], [-1.9, .9], [-.9, 1]], .012, .004), "spine");      // fin
  put(tube([[-.08, .62, -.26], [-.04, .79, -.25], [.3, .82, -.16], [.47, .8, 0], [.3, .82, .16], [-.04, .79, .25], [-.08, .62, .26]], .03, 48), "team");   // halo
  put(tube([[.47, .8, 0], [.63, .72, 0], [.8, .55, 0]], .034, 12), "team");
  put(box(.05, .15, .28), "carbon", [.45, .6, 0], [0, 0, .5]);                          // steering wheel
  put(box(.012, .05, .09), "screen", [.475, .62, 0], [0, 0, .5]);                     // its display
  both(s => { put(new T.SphereGeometry(.07, 14, 10), "team", [.56, .68, s * .5], [0, 0, 0], [.7, .6, 1.3]); rod("carbon", [.5, .6, s * .3], [.56, .66, s * .45], .012); });   // mirrors
  // floor: wide under the sidepods, narrower at each end
  put(slab([[1.25, -.42], [.75, -.8], [-1.3, -.8], [-1.95, -.55], [-1.95, .55], [-1.3, .8], [.75, .8], [1.25, .42]], .03, .01), "carbon", [0, .07, 0], [across, 0, 0]);
  put(box(.55, .02, 1), "carbon", [-2.12, .19, 0], [0, 0, -.35]);                    // diffuser
  // front wing: a main plane and three flaps rising towards the back, endplates, all across the car
  put(wing(.34, 1.86, .09, .05), "carbon", [2.78, .07, 0]);
  [[2.5, .12, .2, .25], [2.34, .17, .16, .45], [2.22, .22, .13, .65]].forEach(([x, y, c, a]) => put(wing(c, 1.7, .1, .1), "team", [x, y, 0], [0, 0, -a]));
  both(s => put(slab([[2.8, .03], [2.8, .2], [2.6, .3], [2.15, .3], [2.15, .12]], .018, .006), "team", [0, 0, s * .95]));
  // rear wing: main plane and flap (the DRS gap between them), curved endplates, beam wing and pillar
  put(wing(.34, 1, .11, .12), "carbon", [-2.42, .8, 0]);
  put(wing(.2, 1, .1, .1), "team", [-2.66, .9, 0], [0, 0, -.55]);
  both(s => put(slab([[-2.3, .4], [-2.3, .96], [-2.45, 1.02], [-2.85, 1.02], [-2.85, .5], [-2.6, .4]], .02, .008), "team", [0, 0, s * .51]));
  put(wing(.22, .86, .1, .1), "carbon", [-2.36, .3, 0]);
  put(box(.1, .45, .025), "carbon", [-2.52, .58, 0]);
  put(box(.03, .07, .1), "light", [-2.78, .34, 0]);                                   // rain light
  // wheels: tyres with rounded shoulders, rims, hubs; the wheel covers' sidewall ring shows the compound (its own material)
  const tyre = w => {   // sidewall in from the rim, the rounded tread, the other sidewall
    const p = [new T.Vector2(.22, -w / 2)];
    for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + i / 16 * Math.PI; p.push(new T.Vector2(.31 + .05 * Math.cos(a), w / 2 * Math.sin(a))); }
    p.push(new T.Vector2(.22, w / 2)); return new T.LatheGeometry(p, 36);
  };
  for (const [x, w, z] of [[1.72, .3, .78], [-1.68, .4, .74]]) both(s => {
    put(tyre(w), "tyre", [x, .36, s * z], [across, 0, 0]);
    put(new T.CylinderGeometry(.25, .25, w - .02, 24), "rim", [x, .36, s * z], [across, 0, 0]);
    put(new T.CylinderGeometry(.06, .06, w + .02, 12), "carbon", [x, .36, s * z], [across, 0, 0]);
    put(new T.TorusGeometry(.29, .012, 6, 40), "ring", [x, .36, s * (z + w / 2 + .005)]);
    put(new T.CylinderGeometry(.13, .15, .2, 14), "carbon", [x, .36, s * (z - w / 2 - .1)], [across, 0, 0]);   // brake duct
  });
  both(s => {   // suspension
    for (const [a, b] of [[[1.6, .44, .25], [1.72, .42, .62]], [[1.85, .44, .25], [1.72, .42, .62]], [[1.55, .2, .2], [1.72, .28, .62]], [[1.9, .2, .2], [1.72, .28, .62]], [[1.72, .3, .58], [1.62, .5, .2]]])
      rod("carbon", [a[0], a[1], s * a[2]], [b[0], b[1], s * b[2]]);
    for (const [a, b] of [[[-1.5, .45, .3], [-1.68, .42, .52]], [[-1.85, .45, .3], [-1.68, .42, .52]], [[-1.5, .22, .3], [-1.68, .3, .52]], [[-1.85, .22, .3], [-1.68, .3, .52]]])
      rod("carbon", [a[0], a[1], s * a[2]], [b[0], b[1], s * b[2]]);
  });
  const merged = Object.fromEntries(Object.entries(parts).map(([k, list]) => {   // one shape per material: positions and normals
    const n = list.reduce((s, g) => s + g.attributes.position.count * 3, 0), pos = new Float32Array(n), nor = new Float32Array(n);
    let i = 0; for (const g of list) { pos.set(g.attributes.position.array, i); nor.set(g.attributes.normal.array, i); i += g.attributes.position.count * 3; }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("normal", new T.BufferAttribute(nor, 3)); return [k, g];
  }));
  const shadow = new T.CircleGeometry(1, 28).rotateX(-Math.PI / 2).scale(2.95, 1, 1.1);
  const plate = new T.PlaneGeometry(.36, .24);   // the race number, on each side of the engine cover

  const mats = {
    carbon: new T.MeshPhysicalMaterial({ color: 0x1a1b20, roughness: .45, metalness: 0, clearcoat: .7, clearcoatRoughness: .25 }),
    tyre: new T.MeshStandardMaterial({ color: 0x141416, roughness: .9 }),
    rim: new T.MeshStandardMaterial({ color: 0x2a2b30, roughness: .3, metalness: .9 }),
    helmet: new T.MeshPhysicalMaterial({ color: 0xf4f4f7, roughness: .2, clearcoat: 1 }),
    visor: new T.MeshStandardMaterial({ color: 0x0c0d10, roughness: .05, metalness: .9 }),
    screen: new T.MeshBasicMaterial({ color: 0x3fd0ff }),
    get cam() { return this.carbon; },
    light: new T.MeshBasicMaterial({ color: 0xff2030 }),
    shadow: new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .42, depthWrite: false })
  };
  const cache = {}, once = (k, f) => cache[k] ||= f();
  const paint = c => once("p" + c, () => new T.MeshPhysicalMaterial({ color: new T.Color(c), roughness: .38, metalness: 0, clearcoat: 1, clearcoatRoughness: .08 }));
  const ring = c => once("r" + c, () => new T.MeshStandardMaterial({ color: new T.Color(c || "#3a3b40"), roughness: .6 }));
  const number = (num, ink) => once("n" + num + ink, () => {   // the number in the car's ink colour on a clear plate
    const cv = document.createElement("canvas"); cv.width = 192; cv.height = 128;
    const x = cv.getContext("2d"); x.font = "italic 900 104px Inter, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = ink; x.fillText(String(num), 96, 70);
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return new T.MeshStandardMaterial({ map: t, transparent: true, roughness: .4, polygonOffset: true, polygonOffsetFactor: -2 });
  });

  const scene = new T.Scene(), camera = new T.Camera(), cars = new Map();
  camera.matrixAutoUpdate = camera.matrixWorldAutoUpdate = false;
  scene.add(new T.HemisphereLight(0xffffff, 0x50505a, 1.1));
  const sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.set(-40, 90, 30); scene.add(sun);
  function car(n, d) {
    let c = cars.get(n);
    if (!c) {
      c = { g: new T.Group(), driver: [], key: "" };
      for (const [k, g] of Object.entries(merged)) {
        const m = new T.Mesh(g, mats[k]); m.userData.k = k;
        c.g.add(m); if (["helmet", "visor", "spine", "cam"].includes(k)) c.driver.push(m);   // (what's behind the camera riding with it)
      }
      c.plates = [1, -1].map(s => { const p = new T.Mesh(plate); p.position.set(-1, .52, s * .278); p.rotation.y = s > 0 ? 0 : Math.PI; c.g.add(p); return p; });
      const sh = new T.Mesh(shadow, mats.shadow); sh.position.y = .012; sh.renderOrder = -1; c.g.add(sh);
      scene.add(c.g); cars.set(n, c);
    }
    const key = [d.colour, d.ink, d.num, d.tyre].join();
    if (c.key !== key) {
      c.key = key;
      for (const m of c.g.children) if (m.userData.k === "team" || m.userData.k === "spine") m.material = paint(d.colour); else if (m.userData.k === "ring") m.material = ring(d.tyre);
      for (const p of c.plates) p.material = number(d.num, d.ink);
    }
    return c;
  }

  let renderer = null, origin = null, at0 = null, per = 1;
  return {
    layer: {
      id: "cars3d", type: "custom", renderingMode: "3d",
      onAdd(map, gl) { if (!renderer) { renderer = new T.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true }); renderer.autoClear = false; } },
      render(gl, matrix) {
        if (!origin) return;
        renderer.resetState();
        if (!scene.environment) scene.environment = new T.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;   // the reflections (here: MapLibre restores its state after this layer)
        // MapLibre gives one matrix from the circuit's metres to the screen: split out where the camera is (the point that
        // matrix sends to infinity), so shine and reflections are worked out from the real viewpoint
        const all = new T.Matrix4().fromArray(matrix).multiply(origin), eye = new T.Vector4(0, 0, 1, 0).applyMatrix4(all.clone().invert());
        camera.matrixWorld.makeTranslation(eye.x / eye.w, eye.y / eye.w, eye.z / eye.w); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        camera.projectionMatrix.copy(all).multiply(camera.matrixWorld); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        renderer.render(scene, camera);
      }
    },
    // where the circuit's local metres start: x east, y north (as three.js x and -z), up as y
    origin([lng, lat]) {
      const mc = at0 = ml.MercatorCoordinate.fromLngLat([lng, lat], 0), s = per = mc.meterInMercatorCoordinateUnits();
      origin = new T.Matrix4().makeTranslation(mc.x, mc.y, mc.z).scale(new T.Vector3(s, -s, s)).multiply(new T.Matrix4().makeRotationX(Math.PI / 2));
    },
    // the cars to draw now, each { n, at ([lng, lat]), angle (its heading, anticlockwise from east), colour, ink (text
    // on that colour), num, tyre (its compound's colour), own }; own: the camera rides just behind its driver's head, so the driver, airbox and spine aren't drawn
    show(list) {
      const on = new Set();
      for (const d of list) {
        const c = car(d.n, d); on.add(d.n);
        const mc = ml.MercatorCoordinate.fromLngLat(d.at, 0);   // through MapLibre's own projection, so cars sit exactly where the camera and tags put them
        c.g.position.set((mc.x - at0.x) / per, 0, (mc.y - at0.y) / per); c.g.rotation.y = d.angle; c.g.visible = true;
        for (const m of c.driver) m.visible = !d.own;
      }
      for (const [n, c] of cars) if (!on.has(n)) c.g.visible = false;
    }
  };
}
