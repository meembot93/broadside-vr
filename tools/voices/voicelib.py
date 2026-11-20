"""Shared bits for the voice tools: reading lines.json and writing js/voicelist.js."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LINES = os.path.join(ROOT, 'tools/voices/lines.json')
RECORDED = os.path.join(ROOT, 'tools/voices/recorded.json')
OUT = os.path.join(ROOT, 'sounds/voice')

def load(path, default):
    return json.load(open(path)) if os.path.exists(path) else default

def save(path, data):
    with open(path, 'w') as f: json.dump(data, f, indent=2, ensure_ascii=False); f.write('\n')

def write_list():
    """List every clip per group. A group that has Meem's own recordings uses only those."""
    data, rec = load(LINES, {}), load(RECORDED, {})
    listing = {}
    for key, grp in data['groups'].items():
        mine = [dict(id=cid, who=r['who'], text=r['text'], recorded=True) for cid, r in rec.items() if r['group'] == key]
        if mine: listing[key] = mine; continue
        if not data.get('useGenerated', True): continue  # Meem's call: only real recordings
        listing[key] = [dict(id=f'{key}{i + 1}', who=grp['by'][i % len(grp['by'])], text=t) for i, t in enumerate(grp['lines'])]
    for cid, r in rec.items():  # recordings for moments that have no generated lines (custom ones)
        if r['group'] not in data['groups']: listing.setdefault(r['group'], []).append(dict(id=cid, who=r['who'], text=r['text'], recorded=True))
    with open(os.path.join(ROOT, 'js/voicelist.js'), 'w') as f:
        f.write('// MADE BY tools/voices/*.py from tools/voices/lines.json and recorded.json. Edit those, not this.\n')
        f.write('// Each clip is sounds/voice/<id>.ogg; "who" is the pirate whose voice it is;\n')
        f.write('// "recorded" clips are real voice recordings and replace the generated ones in their group.\n')
        f.write('export const VOICE_LINES = ' + json.dumps(listing, indent=1, ensure_ascii=False) + ';\n')
