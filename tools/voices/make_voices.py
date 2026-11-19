#!/usr/bin/env python3
"""Turn tools/voices/lines.json into pirate voice clips (sounds/voice/*.ogg) and js/voicelist.js.

Uses the free, offline Kokoro TTS model (pip install kokoro-onnx soundfile) and ffmpeg
(with rubberband) to lower the pitch and roughen the voice.
Model files: kokoro-v1.0.onnx and voices-v1.0.bin from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
Usage: python3 tools/voices/make_voices.py <folder with the model files>
"""
import json, os, re, subprocess, sys, tempfile
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
models = sys.argv[1] if len(sys.argv) > 1 else '.'
k = Kokoro(os.path.join(models, 'kokoro-v1.0.onnx'), os.path.join(models, 'voices-v1.0.bin'))
data = json.load(open(os.path.join(ROOT, 'tools/voices/lines.json')))
out_dir = os.path.join(ROOT, 'sounds/voice'); os.makedirs(out_dir, exist_ok=True)
for f in os.listdir(out_dir):
    if f.endswith('.ogg'): os.remove(os.path.join(out_dir, f))

ARR = 'ˈɑːɹ'  # a growled, rolled pirate "Arr"

def phonemes(text, lang):
    # Phonemize around each "Arr" so it always comes out as a proper pirate growl.
    parts = re.split(r"\b(Arr)\b", text)
    out = []
    for p in parts:
        if p == 'Arr': out.append(ARR)
        elif p.strip(): out.append(k.tokenizer.phonemize(p, lang))
        elif p: out.append(' ')
    return re.sub(r'\s+', ' ', ''.join(out)).strip()

def make(text, sp, path):
    lang = 'en-us' if sp['voice'].startswith('a') else 'en-gb'
    samples, sr = k.create(phonemes(text, lang), voice=sp['voice'], speed=sp['speed'], lang=lang, is_phonemes=True)
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        sf.write(tmp.name, samples, sr)
        g = sp['grit']
        af = ','.join([
            f"rubberband=pitch={2 ** (sp['pitch'] / 12):.4f}",          # deeper voice
            'highpass=f=90', 'equalizer=f=220:t=q:w=1:g=3',              # chestier
            f'volume={1 + g * 1.5:.2f}', 'asoftclip=type=tanh', f'volume={1 / (1 + g * 0.8):.2f}',  # gravel
            'lowpass=f=7000', 'silenceremove=start_periods=1:start_threshold=-45dB',
            'areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
            'loudnorm=I=-16:TP=-1.5:LRA=11', 'apad=pad_dur=0.05',
        ])
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp.name, '-af', af, '-ac', '1', '-ar', '24000',
                        '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', path], check=True)

speakers = data['speakers']
listing = {}
for key, grp in data['groups'].items():
    clips = []
    for i, text in enumerate(grp['lines']):
        who = grp['by'][i % len(grp['by'])]
        cid = f'{key}{i + 1}'
        make(text, speakers[who], os.path.join(out_dir, cid + '.ogg'))
        clips.append({'id': cid, 'who': who, 'text': text})
        print(cid, who, text)
    listing[key] = clips

with open(os.path.join(ROOT, 'js/voicelist.js'), 'w') as f:
    f.write('// MADE BY tools/voices/make_voices.py from tools/voices/lines.json. Edit those, not this.\n')
    f.write('// Each clip is sounds/voice/<id>.ogg; "who" is the pirate whose voice it is.\n')
    f.write('export const VOICE_LINES = ' + json.dumps(listing, indent=1, ensure_ascii=False) + ';\n')
