"""python3 make.py NAME [vox]  -> sculpt chars/NAME.py's LOOK, bake and rig -> out/NAME.glb"""
import sys, os, time, json, importlib, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
name = sys.argv[1]; vox = float(sys.argv[2]) if len(sys.argv) > 2 else 0.003
mod = importlib.import_module(name)
from pirate import pirate
S, J = pirate(mod.LOOK); S.vox = vox
t = time.time(); v, f, c = S.mesh(); print('sculpted', len(f), 'tris', round(time.time() - t), 's', flush=True)
from build import build
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
build(name, v, f, c, J, os.path.join(HERE, 'out', name + '.glb'), tris=getattr(mod, 'TRIS', 14000), head_from=1.5 * mod.LOOK.get('height', 1.0), head_keep=getattr(mod, 'HEAD_KEEP', 0.75), log=lambda m: print(m, flush=True))
