// Geometry and file-format checks for src/core.js. No dependencies.
//   node test/test-core.js            run checks
//   node test/test-core.js out/       also write sample STL and ZIP files to out/
const fs = require('fs');
const path = require('path');
const C = require('../src/core.js');

const outDir = process.argv[2];
if (outDir) fs.mkdirSync(outDir, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

// Ring sizes (BS 6820: size C = 40.0 mm circumference, 1.25 mm per full size)
const sizeN = C.SIZES.find((s) => s.key === 'N');
const sizeC = C.SIZES.find((s) => s.key === 'C');
ok(Math.abs(sizeC.circ - 40) < 1e-9, `size C is 40.00 mm around (got ${sizeC.circ})`);
ok(C.SIZES.length === 51, `51 sizes A to Z including halves (got ${C.SIZES.length})`);

for (const type of Object.keys(C.PROFILES)) {
  for (const segments of [64, 128]) {
    const p = { D: sizeN.circ / Math.PI, W: 4, T: 1.8, type, segments, samples: 32 };
    const m = C.buildMesh(p);
    const vol = C.signedVolume(m.positions, m.indices);
    ok(!m.flipped && vol > 0, `${type}/${segments}: outward winding, volume ${vol.toFixed(2)} mm3, ${m.triangles} triangles`);

    // Closed 2-manifold: every directed edge appears once, and its reverse appears once.
    const edges = new Map();
    const I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const k = I[t + e] + ',' + I[t + ((e + 1) % 3)];
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
    let bad = 0;
    for (const [k, n] of edges) {
      const [a, b] = k.split(',');
      if (n !== 1 || edges.get(b + ',' + a) !== 1) bad++;
    }
    ok(bad === 0, `${type}/${segments}: watertight, consistent winding`);

    // Flat band volume must equal the exact volume of the polygonal prism.
    if (type === 'flat') {
      const R = p.D / 2;
      const exact = p.W * (segments / 2) * Math.sin((2 * Math.PI) / segments) * ((R + p.T) ** 2 - R ** 2);
      ok(Math.abs(exact - m.volume) / exact < 1e-5, `flat/${segments}: volume ${m.volume.toFixed(4)} matches exact ${exact.toFixed(4)}`);
    }

    // Preview mesh: smooth normals agree with triangle winding.
    const d = C.buildDisplay(p);
    let disagree = 0;
    const P = d.positions, Nn = d.normals;
    for (let t = 0; t < d.indices.length; t += 3) {
      const a = d.indices[t] * 3, b = d.indices[t + 1] * 3, c = d.indices[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const nx = Nn[a] + Nn[b] + Nn[c], ny = Nn[a + 1] + Nn[b + 1] + Nn[c + 1], nz = Nn[a + 2] + Nn[b + 2] + Nn[c + 2];
      if (fx * nx + fy * ny + fz * nz <= 0) disagree++;
    }
    ok(disagree === 0, `${type}/${segments}: preview normals agree with winding`);

    if (segments === 128) {
      const bin = C.toBinarySTL(m, 'Ring band test, units: mm');
      ok(bin.length === 84 + 50 * m.triangles, `${type}: binary STL is ${bin.length} bytes (84 + 50 per triangle)`);
      ok(new DataView(bin.buffer).getUint32(80, true) === m.triangles, `${type}: binary STL triangle count`);
      ok(String.fromCharCode(...bin.slice(0, 5)) !== 'solid', `${type}: binary header does not start with "solid"`);
      const asc = new TextDecoder().decode(C.toAsciiSTL(m, `ring ${type}`));
      ok(asc.startsWith('solid ') && asc.trimEnd().endsWith(`endsolid ring_${type}`), `${type}: ASCII STL framing`);
      ok((asc.match(/facet normal/g) || []).length === m.triangles, `${type}: ASCII STL facet count`);
      if (outDir) {
        fs.writeFileSync(path.join(outDir, `${type}.stl`), bin);
        fs.writeFileSync(path.join(outDir, `${type}_ascii.stl`), asc);
        if (type === 'court') fs.writeFileSync(path.join(outDir, 'court.zip'), C.zipOne('ring-N-court.stl', bin));
      }
    }
  }
}

ok(C.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'CRC-32 check value');
const zip = C.zipOne('a.stl', new Uint8Array([1, 2, 3]));
const zdv = new DataView(zip.buffer);
ok(zdv.getUint32(0, true) === 0x04034b50 && zdv.getUint32(zip.length - 22, true) === 0x06054b50, 'ZIP local header and end record');

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
