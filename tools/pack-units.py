# Склеивает кадры анимаций юнитов в ленты (WebP) и пишет манифест.
# python3 tools/pack-units.py <папка_с_кадрами> <папка_вывода>
import json, os, subprocess, sys

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
man = json.load(open(os.path.join(src, 'units.json')))
out = {}
ORDER = ['idle', 'walk', 'shoot', 'hit', 'death']
for key, e in man.items():
    frames, clips = [], {}
    for clip in ORDER:
        names = e['anims'].get(clip, [])
        clips[clip] = [len(frames), len(names)]
        frames += [os.path.join(src, n + '.png') for n in names]
    if not frames:
        continue
    png = os.path.join(dst, f'{key}.png')
    subprocess.run(['magick', *frames, '+append', png], check=True)
    webp = os.path.join(dst, f'{key}.webp')
    subprocess.run(['cwebp', '-quiet', '-q', '84', '-alpha_q', '90', '-m', '6', png, '-o', webp], check=True)
    os.remove(png)
    f = e['frame']
    out[key] = {'w': f['w'], 'h': f['h'], 'ax': f['ax'], 'ay': f['ay'], 'px': e['px'], 'clips': clips}
json.dump({'ext': 'webp', 'units': out}, open(os.path.join(dst, 'manifest.json'), 'w'), indent=0)
print('packed', len(out))
