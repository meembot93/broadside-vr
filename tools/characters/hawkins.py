import sys, time, json, numpy as np
sys.path.insert(0, '/tmp/claude-0/s/chars')
from pirate import pirate
LOOK = dict(height=1.0, bulk=1.05, belly=0.35, skin=0xd29a74, eyes=0x4a6a8a, hair=0x9a9690, hair_style='ponytail',
            beard='full', beard_color=0xb8b4ac, hat='tricorn', hat_color=0x2a2a30, trim=0xc8a040,
            coat=0x24304a, cuffs=0x3a4a6a, shirt=0xe8dfc8, belt=0x3a2a1c, pants=0x5a4a38, boots=0x3a2618, nose=1.25)
def make(vox=0.003):
    S, J = pirate(LOOK); S.vox = vox
    t = time.time(); v, f, c = S.mesh(); print('mesh', len(f), 'tris', round(time.time() - t), 's')
    return v, f, c, J
if __name__ == '__main__':
    vox = float(sys.argv[1]) if len(sys.argv) > 1 else 0.003
    v, f, c, J = make(vox)
    np.savez('/tmp/claude-0/s/chars/hawkins.npz', v=v, f=f, c=c); json.dump(J, open('/tmp/claude-0/s/chars/hawkins.json', 'w'))
    # quick PLY for the browser preview
    with open('/home/claude/broadside-vr/.preview/hawkins.ply', 'wb') as fh:
        fh.write(f'ply\nformat binary_little_endian 1.0\nelement vertex {len(v)}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face {len(f)}\nproperty list uchar int vertex_indices\nend_header\n'.encode())
        vd = np.zeros(len(v), dtype=[('p', '<f4', 3), ('c', 'u1', 3)]); vd['p'] = v; vd['c'] = (c * 255).astype('u1'); fh.write(vd.tobytes())
        fd = np.zeros(len(f), dtype=[('n', 'u1'), ('i', '<i4', 3)]); fd['n'] = 3; fd['i'] = f; fh.write(fd.tobytes())
