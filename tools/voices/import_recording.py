#!/usr/bin/env python3
"""Swap a real voice recording (any format a phone makes: m4a, mp3, wav, ogg...) into the game.

  python3 tools/voices/import_recording.py <file> <group> <who> "<the words>" [--pitch N]

group: the moment it's for (a group in lines.json such as hooked, or a new name for a custom line;
       new groups need a hook in js/voicelines.js). who: the pirate saying it (Hawkins, Finn, Mags,
       Bones, Patch, enemyA/B/C); the sound comes from them in the game.
--pitch: semitones to shift (default: recordPitch for that pirate in lines.json; 0 keeps it as recorded).
The clip is trimmed of silence, cleaned up, levelled and saved as sounds/voice/<group>_rec<N>.ogg.
Once a group has a recording, the generated lines for it are no longer used.
"""
import argparse, os, subprocess
from voicelib import LINES, RECORDED, OUT, load, save, write_list

ap = argparse.ArgumentParser()
ap.add_argument('file'); ap.add_argument('group'); ap.add_argument('who'); ap.add_argument('text')
ap.add_argument('--pitch', type=float, default=None)
ap.add_argument('--replace', action='store_true', help='replace the existing recordings for this group')
a = ap.parse_args()

data, rec = load(LINES, {}), load(RECORDED, {})
pitch = a.pitch if a.pitch is not None else data.get('recordPitch', {}).get(a.who, 0)
if a.replace:
    for cid in [c for c, r in rec.items() if r['group'] == a.group]:
        rec.pop(cid); p = os.path.join(OUT, cid + '.ogg')
        if os.path.exists(p): os.remove(p)
n = 1
while f'{a.group}_rec{n}' in rec: n += 1
cid = f'{a.group}_rec{n}'

trim = 'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.08'
af = ['highpass=f=80', 'afftdn=nf=-30',                                # rumble and phone hiss
      trim, 'areverse', trim, 'areverse',                             # cut silence at both ends
      'acompressor=threshold=-20dB:ratio=3:attack=5:release=120',     # even out loud and soft words
      'loudnorm=I=-16:TP=-1.5:LRA=11', 'apad=pad_dur=0.05']
if pitch: af.insert(0, f'rubberband=pitch={2 ** (pitch / 12):.4f}')
os.makedirs(OUT, exist_ok=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', a.file, '-vn', '-af', ','.join(af), '-ac', '1', '-ar', '48000',
                '-c:a', 'libopus', '-b:a', '40k', os.path.join(OUT, cid + '.ogg')], check=True)
rec[cid] = dict(group=a.group, who=a.who, text=a.text, pitch=pitch)
save(RECORDED, rec); write_list()
dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', os.path.join(OUT, cid + '.ogg')], capture_output=True, text=True).stdout.strip()
print(f'{cid}: {float(dur):.2f} s, pitch {pitch:+g}, {a.who}: "{a.text}"')
