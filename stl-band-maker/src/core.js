/* RingCore: pure geometry + file writers. No DOM. Units: millimetres. */
const RingCore = (() => {
  // AU/UK letter sizes per BS 6820: size C = 40.0 mm circumference, 1.25 mm per full size.
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const SIZES = [];
  for (let i = 0; i < 26; i++) {
    const circ = 40 + (i - 2) * 1.25;
    SIZES.push({ label: LETTERS[i], key: LETTERS[i], circ });
    if (i < 25) SIZES.push({ label: LETTERS[i] + '½', key: LETTERS[i] + '-half', circ: circ + 0.625 });
  }

  // Dome heights as a fraction of thickness (outside surface, inside surface).
  const PROFILES = {
    flat:      { name: 'Flat',       out: 0,    in: 0 },
    dshape:    { name: 'D-shape',    out: 0.55, in: 0 },
    court:     { name: 'Court',      out: 0.4,  in: 0.2 },
    flatcourt: { name: 'Flat court', out: 0,    in: 0.3 },
  };

  // Offset of a circular arc with sagitta h across chord W, at distance z from centre.
  function arc(h, W, z) {
    if (h <= 1e-9) return 0;
    const c = W / 2;
    const rho = (c * c + h * h) / (2 * h);
    return h - (Math.sqrt(Math.max(0, rho * rho - z * z)) - (rho - h));
  }

  // Cross-section in (r, z). Loop is counter-clockwise with r as x and z as y:
  // inner surface runs z: +W/2 -> -W/2, outer surface runs z: -W/2 -> +W/2.
  function profile(p) {
    const R = p.D / 2, W = p.W, T = p.T;
    const pr = PROFILES[p.type] || PROFILES.court;
    let hOut = pr.out * T, hIn = pr.in * T;
    const maxH = (W / 2) * 0.98;
    hOut = Math.min(hOut, maxH);
    hIn = Math.min(hIn, maxH);
    const minEdge = 0.15;
    if (hOut + hIn > T - minEdge && hOut + hIn > 0) {
      const k = Math.max(0, T - minEdge) / (hOut + hIn);
      hOut *= k; hIn *= k;
    }
    const M = p.samples || 32;
    const run = (h, sign, base, up) => {
      const n = h > 0 ? M : 1, pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const z = up ? -W / 2 + t * W : W / 2 - t * W;
        pts.push([base + sign * arc(h, W, z), z]);
      }
      return pts;
    };
    const inner = run(hIn, +1, R, false);
    const outer = run(hOut, -1, R + T, true);
    return { inner, outer, hIn, hOut, edge: T - hIn - hOut, R, W, T };
  }

  // Quad (a,b,c,d) -> triangles. With the CCW profile above, (a,b,c),(a,c,d) faces outward.
  function pushQuad(out, k, a, b, c, d) {
    out[k] = a; out[k + 1] = b; out[k + 2] = c;
    out[k + 3] = a; out[k + 4] = c; out[k + 5] = d;
    return k + 6;
  }

  function signedVolume(pos, idx) {
    let v = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
      const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }

  // Watertight mesh for STL: one closed profile loop revolved N times, sitting on z = 0.
  function buildMesh(p) {
    const prof = profile(p);
    const loop = prof.inner.concat(prof.outer);
    const N = p.segments || 128, P = loop.length, zOff = prof.W / 2;
    const positions = new Float32Array(N * P * 3);
    for (let j = 0; j < N; j++) {
      const th = (2 * Math.PI * j) / N, c = Math.cos(th), s = Math.sin(th);
      for (let i = 0; i < P; i++) {
        const [r, z] = loop[i], o = (j * P + i) * 3;
        positions[o] = r * c; positions[o + 1] = r * s; positions[o + 2] = z + zOff;
      }
    }
    const indices = new Uint32Array(N * P * 6);
    let k = 0;
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      for (let i = 0; i < P; i++) {
        const i2 = (i + 1) % P;
        k = pushQuad(indices, k, j * P + i, j2 * P + i, j2 * P + i2, j * P + i2);
      }
    }
    let volume = signedVolume(positions, indices), flipped = false;
    if (volume < 0) { // safety net; should never trigger
      for (let t = 0; t < indices.length; t += 3) { const x = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = x; }
      volume = -volume; flipped = true;
    }
    return { positions, indices, volume, flipped, prof, triangles: indices.length / 3 };
  }

  // Display mesh with smooth normals per surface and sharp creases at the band edges.
  function buildDisplay(p) {
    const prof = profile(p);
    const N = p.segments || 128, zOff = prof.W / 2;
    const inner = prof.inner, outer = prof.outer;
    const runs = [
      inner,
      [inner[inner.length - 1], outer[0]],
      outer,
      [outer[outer.length - 1], inner[0]],
    ];
    const pos = [], nor = [], idx = [];
    for (const run of runs) {
      const n = run.length, base = pos.length / 3;
      const n2 = run.map((_, i) => {
        let nx = 0, nz = 0;
        if (i > 0) { const dx = run[i][0] - run[i - 1][0], dz = run[i][1] - run[i - 1][1]; const l = Math.hypot(dx, dz) || 1; nx += dz / l; nz += -dx / l; }
        if (i < n - 1) { const dx = run[i + 1][0] - run[i][0], dz = run[i + 1][1] - run[i][1]; const l = Math.hypot(dx, dz) || 1; nx += dz / l; nz += -dx / l; }
        const l = Math.hypot(nx, nz) || 1;
        return [nx / l, nz / l];
      });
      for (let j = 0; j < N; j++) {
        const th = (2 * Math.PI * j) / N, c = Math.cos(th), s = Math.sin(th);
        for (let i = 0; i < n; i++) {
          pos.push(run[i][0] * c, run[i][0] * s, run[i][1] + zOff);
          nor.push(n2[i][0] * c, n2[i][0] * s, n2[i][1]);
        }
      }
      const tmp = new Array(6);
      for (let j = 0; j < N; j++) {
        const j2 = (j + 1) % N;
        for (let i = 0; i < n - 1; i++) {
          pushQuad(tmp, 0, base + j * n + i, base + j2 * n + i, base + j2 * n + i + 1, base + j * n + i + 1);
          idx.push(...tmp);
        }
      }
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), prof };
  }

  function facetNormal(pos, a, b, c) {
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  // Binary STL. The 80-byte header must not begin with "solid" or some readers treat it as ASCII.
  function toBinarySTL(mesh, header) {
    const { positions: pos, indices: idx } = mesh;
    const nT = idx.length / 3;
    const buf = new ArrayBuffer(84 + 50 * nT);
    const dv = new DataView(buf);
    const h = (header || 'Binary STL, units: mm').slice(0, 80);
    for (let i = 0; i < h.length; i++) dv.setUint8(i, h.charCodeAt(i) & 0x7f);
    dv.setUint32(80, nT, true);
    let o = 84;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const n = facetNormal(pos, a, b, c);
      dv.setFloat32(o, n[0], true); dv.setFloat32(o + 4, n[1], true); dv.setFloat32(o + 8, n[2], true);
      o += 12;
      for (const v of [a, b, c]) {
        dv.setFloat32(o, pos[v], true); dv.setFloat32(o + 4, pos[v + 1], true); dv.setFloat32(o + 8, pos[v + 2], true);
        o += 12;
      }
      dv.setUint16(o, 0, true);
      o += 2;
    }
    return new Uint8Array(buf);
  }

  function toAsciiSTL(mesh, name) {
    const { positions: pos, indices: idx } = mesh;
    const f = (x) => x.toExponential(6);
    const nm = (name || 'ring').replace(/\s+/g, '_');
    const out = ['solid ' + nm];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const n = facetNormal(pos, a, b, c);
      out.push(`  facet normal ${f(n[0])} ${f(n[1])} ${f(n[2])}`, '    outer loop');
      for (const v of [a, b, c]) out.push(`      vertex ${f(pos[v])} ${f(pos[v + 1])} ${f(pos[v + 2])}`);
      out.push('    endloop', '  endfacet');
    }
    out.push('endsolid ' + nm, '');
    return new TextEncoder().encode(out.join('\n'));
  }

  // Minimal single-file ZIP (stored, no compression).
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipOne(name, data, date) {
    const d = date || new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data), size = data.length, nl = nameBytes.length;
    const local = 30 + nl, central = 46 + nl;
    const out = new Uint8Array(local + size + central + 22);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, time, true); dv.setUint16(12, day, true); dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, nl, true); dv.setUint16(28, 0, true);
    out.set(nameBytes, 30); out.set(data, local);
    let o = local + size;
    dv.setUint32(o, 0x02014b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 20, true); dv.setUint16(o + 8, 0, true);
    dv.setUint16(o + 10, 0, true); dv.setUint16(o + 12, time, true); dv.setUint16(o + 14, day, true); dv.setUint32(o + 16, crc, true);
    dv.setUint32(o + 20, size, true); dv.setUint32(o + 24, size, true); dv.setUint16(o + 28, nl, true);
    dv.setUint16(o + 30, 0, true); dv.setUint16(o + 32, 0, true); dv.setUint16(o + 34, 0, true); dv.setUint16(o + 36, 0, true);
    dv.setUint32(o + 38, 0, true); dv.setUint32(o + 42, 0, true); out.set(nameBytes, o + 46);
    o += central;
    dv.setUint32(o, 0x06054b50, true); dv.setUint16(o + 4, 0, true); dv.setUint16(o + 6, 0, true);
    dv.setUint16(o + 8, 1, true); dv.setUint16(o + 10, 1, true); dv.setUint32(o + 12, central, true);
    dv.setUint32(o + 16, local + size, true); dv.setUint16(o + 20, 0, true);
    return out;
  }

  return { SIZES, PROFILES, profile, buildMesh, buildDisplay, toBinarySTL, toAsciiSTL, zipOne, crc32, signedVolume };
})();
if (typeof module !== 'undefined') module.exports = RingCore;
