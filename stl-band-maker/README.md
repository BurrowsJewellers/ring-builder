# STL Band Maker

A browser page that generates a plain ring band and saves it as an STL file for 3D printing, casting or CAD. Everything runs in the browser: no server and no upload.

**To use it:** open `dist/ring-band-stl-maker.html` in Chrome, Edge, Safari or Firefox.

## What it does

- Ring size by AU/UK letter (A to Z, with half sizes) or by inside diameter in mm
- Four profiles: Flat, D-shape, Court and Flat court
- Width (1.5–12 mm) and thickness at centre (1–3.5 mm)
- Live 3D preview with yellow, rose and white metal colours
- To-scale cross-section, with a warning when the edges get thinner than 0.6 mm
- Estimated finished weight in sterling silver, 9ct, 18ct and Pt950
- Binary or ASCII STL at three levels of mesh detail

The STL is watertight with outward-facing normals, in millimetres. The band lies on the build plate (Z = 0) with its axis vertical.

## Layout

```
src/core.js        geometry, STL writers and a minimal ZIP writer (no DOM, runs in Node too)
src/page.html      page template; build.js inlines core.js into it
build.js           writes the files in dist/
dist/ring-band-stl-maker.html   standalone page, saves .stl directly
dist/claude-artifact.html       created by the build, not committed: the page without its <html>/<head> wrapper, for publishing as a Claude artifact
test/test-core.js  geometry and file-format checks (no dependencies)
test/validate-stl.py  optional independent check of the output with trimesh
```

## Build and test

Requires Node 18 or later.

```
npm run build      # rebuild dist/ after editing src/
npm test           # geometry and file-format checks
```

For the independent check:

```
pip install trimesh numpy
node test/test-core.js out/
python3 test/validate-stl.py out/*.stl
```

## Notes

- **Ring sizes** follow BS 6820: size C is 40.0 mm around, and each full size adds 1.25 mm (0.625 mm per half size). Some published tables put size A at 37.8 mm instead of 37.5 mm, about 0.1 mm difference in diameter. Use inside diameter mode when an exact figure matters.
- **Profiles** are circular arcs. Dome heights are set as a fraction of thickness in `PROFILES` in `src/core.js`.
- **Weights** come from the mesh volume and typical densities (sterling 10.36, 9ct yellow 11.3, 18ct yellow 15.5, Pt950/Ru 20.7 g/cm³). Check them against your casting house's figures; they are set in `METALS` in `src/page.html`.
- **3D preview** loads three.js r128 from cdnjs and jsDelivr, so it needs an internet connection. Generating and saving the STL works offline.
- **Inside Claude** the published artifact can't save `.stl` files directly, because that extension isn't on Claude's download allowlist. The page detects this and saves a `.zip` with the STL inside. The standalone page saves `.stl` directly.
