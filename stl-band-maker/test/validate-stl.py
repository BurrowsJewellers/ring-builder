"""Independent check of STL files with trimesh (a separate STL library).

    pip install trimesh numpy
    node test/test-core.js out/
    python3 test/validate-stl.py out/*.stl
"""
import sys
import trimesh

failed = 0
for path in sys.argv[1:]:
    m = trimesh.load(path, force="mesh")
    good = m.is_watertight and m.is_winding_consistent and m.volume > 0
    failed += not good
    print(f"{'PASS' if good else 'FAIL'} {path}: watertight={m.is_watertight} "
          f"winding={m.is_winding_consistent} volume={m.volume:.2f} mm3 triangles={len(m.faces)}")
sys.exit(1 if failed else 0)
