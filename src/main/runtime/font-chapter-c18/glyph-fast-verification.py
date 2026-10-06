"""Optional CPU glyph verifier; uncertain crops retain the original Hayai path.

Runs in the font worker's already verified native dependency environment. No
font dependencies are injected into Hayai children. Only aligned glyph atlases
are eligible; original line OCR and downstream shape gates remain authoritative.
"""
import hashlib
import json
from pathlib import Path
import sys
import unicodedata


FILES = {
    'manga_rec_v0.2.onnx': (21167540, 'de12c84c63e62c80339e882e675983d886670dcb6f0147e1ed041afd6fa81888'),
    'ppocrv6_dict.txt': (74947, 'b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d'),
}


def normalize(text):
    return ''.join(unicodedata.normalize('NFKC', text).split())


def read(path):
    return json.loads(Path(path).read_text('utf-8-sig'))


class GlyphVerifier:
    def __init__(self, assets):
        import onnxruntime as ort
        directory = Path(assets)
        for name, (size, digest) in FILES.items():
            path = directory / name
            if path.stat().st_size != size or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError('Glyph verifier asset bytes differ: ' + name)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(directory / 'manga_rec_v0.2.onnx'), options,
                                            providers=['CPUExecutionProvider'])
        self.vocab = ['blank'] + (directory / 'ppocrv6_dict.txt').read_text('utf-8').splitlines() + [' ']

    def recognize(self, image):
        import cv2
        import numpy as np
        from PIL import ImageOps
        ys, xs = np.where(np.asarray(image.convert('L')) < 180)
        if not len(xs):
            return '', 0.
        width, height = int(xs.max() - xs.min()) + 1, int(ys.max() - ys.min()) + 1
        # Confidence alone admits multi-glyph fragments. Narrow actual glyphs
        # also abstain here and are read normally by Hayai.
        if not .8 <= width / height <= 1.3:
            return '', 0.
        image = image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        side = max(image.size)
        image = ImageOps.pad(image, (side, side), color='white')
        image = ImageOps.expand(image, border=max(2, round(side * .12)), fill='white')
        pixels = np.asarray(image)[:, :, ::-1].copy()
        height, width = pixels.shape[:2]
        pixels = (cv2.resize(pixels, (max(16, round(48 * width / height)), 48)).astype(np.float32) / 255 - .5) / .5
        probabilities = self.session.run(None, {self.session.get_inputs()[0].name: pixels.transpose(2, 0, 1)[None]})[0][0]
        indices = probabilities.argmax(-1)
        keep = [i for i, value in enumerate(indices) if value and (i == 0 or value != indices[i - 1])]
        if not keep:
            return '', 0.
        text = ''.join(self.vocab[indices[i]] for i in keep)
        return text, float(np.mean([probabilities[i, indices[i]] for i in keep]))

    def prepare(self, item):
        region_path = Path(item['regions'])
        alignment = region_path.parent / 'alignment.json'
        if not region_path.name.startswith('glyph-atlas-') or not alignment.is_file():
            return item
        manifest = read(region_path)
        if manifest.get('effectRegions'):
            return item
        expected = {g['verificationId']: g['token'] for record in read(alignment)['records']
                    for line in record['lines'] for g in line['glyphs'] if 'verificationId' in g}
        from PIL import Image
        accepted, fallback, audit = [], [], []
        with Image.open(item['image']) as source:
            image = source.convert('RGB')
        for region in manifest['dialogueRegions']:
            target = normalize(expected.get(region['id'], ''))
            text, confidence = self.recognize(image.crop(tuple(region['bbox'])))
            ok = len(target) == 1 and normalize(text) == target and confidence >= .995
            audit.append({'id': region['id'], 'expected': target, 'text': text,
                          'confidence': confidence, 'accepted': ok})
            if ok:
                accepted.append({'region': region, 'text': text})
            else:
                fallback.append(region)
        audit_path = region_path.with_name(region_path.stem + '-fast-audit.json')
        audit_path.write_text(json.dumps({'rows': audit, 'accepted': len(accepted),
                                         'fallback': len(fallback)}, ensure_ascii=False), 'utf-8')
        if not accepted:
            return item
        reduced = region_path.with_name(region_path.stem + '-fast-fallback.json')
        reduced.write_text(json.dumps(dict(manifest, dialogueRegions=fallback)), 'utf-8')
        return dict(item, regions=str(reduced), fastGlyphs=accepted,
                    glyphOrder=[r['id'] for r in manifest['dialogueRegions']])


def create(assets):
    try:
        return GlyphVerifier(assets)
    except Exception as error:
        print(json.dumps({'phase': 'font_glyph_accelerator_unavailable', 'error': str(error)}),
              file=sys.stderr, flush=True)
        return None


def prepare_or_fallback(verifier, item):
    try:
        return verifier.prepare(item)
    except Exception as error:
        # This accelerator is optional. Never approve a partial result on error.
        print(json.dumps({'phase': 'font_glyph_accelerator_fallback', 'error': str(error),
                          'output': item['output']}), file=sys.stderr, flush=True)
        return item
