"""Create small static previews without modifying the source PNGs."""
from pathlib import Path
import sys
from PIL import Image

source, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
original_bytes = result_bytes = count = 0
for file in sorted(source.glob('*.png')):
    name = file.name.split('_tactic')[0]
    with Image.open(file) as image:
        image.load()
        if image.mode != 'RGB':
            background = Image.new('RGB', image.size, '#181c22')
            background.paste(image, mask=image.getchannel('A') if 'A' in image.getbands() else None)
            image = background
        for suffix, size, quality in [('', 640, 78), ('.thumb', 240, 72)]:
            preview = image.copy()
            preview.thumbnail((size, size), Image.Resampling.LANCZOS)
            target = output / f'{name}{suffix}.webp'
            preview.save(target, 'WEBP', quality=quality, method=6)
            result_bytes += target.stat().st_size
    original_bytes += file.stat().st_size
    count += 1
print(f'{count} maps: {original_bytes:,} original bytes -> {result_bytes:,} bytes (both sizes)')
