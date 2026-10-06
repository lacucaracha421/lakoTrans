"""Characterize abstention and the immutable atlas/fallback transport boundary."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fast', ROOT / 'src/main/runtime/font-chapter-c18/glyph-fast-verification.py')
fast = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fast)


class FastGlyphTests(unittest.TestCase):
    def test_blank_and_tall_fragment_abstain_before_inference(self):
        verifier = object.__new__(fast.GlyphVerifier)
        verifier.session = Mock()
        blank = Image.new('RGB', (128, 128), 'white')
        tall = blank.copy()
        draw = ImageDraw.Draw(tall)
        draw.rectangle((40, 5, 65, 45), fill='black')
        draw.rectangle((40, 75, 65, 120), fill='black')
        self.assertEqual(verifier.recognize(blank), ('', 0.))
        self.assertEqual(verifier.recognize(tall), ('', 0.))
        verifier.session.run.assert_not_called()

    def test_exact_high_confidence_single_character_only_and_source_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            regions = [{'id': i, 'regionId': str(i), 'bbox': [0, 0, 128, 128]} for i in range(1, 5)]
            manifest = {'dialogueRegions': regions, 'effectRegions': []}
            path = root / 'glyph-atlas-001-regions.json'
            original = json.dumps(manifest).encode()
            path.write_bytes(original)
            (root / 'alignment.json').write_text(json.dumps({'records': [{'lines': [{'glyphs': [
                {'verificationId': i, 'token': token} for i, token in enumerate(['字', '字', '字', '文字'], 1)
            ]}]}]}), 'utf-8')
            Image.new('RGB', (128, 128), 'white').save(root / 'atlas.png')
            item = {'regions': str(path), 'image': str(root / 'atlas.png'), 'output': str(root / 'out.json')}
            verifier = object.__new__(fast.GlyphVerifier)
            verifier.recognize = Mock(side_effect=[('字', .999), ('別', .999), ('字', .99), ('文字', .999)])
            result = verifier.prepare(item)
            self.assertEqual([x['region']['id'] for x in result['fastGlyphs']], [1])
            self.assertEqual([x['id'] for x in fast.read(result['regions'])['dialogueRegions']], [2, 3, 4])
            self.assertEqual(result['glyphOrder'], [1, 2, 3, 4])
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(item['regions'], str(path))

    def test_line_ocr_never_uses_accelerator_and_error_returns_original_input(self):
        verifier = object.__new__(fast.GlyphVerifier)
        verifier.recognize = Mock()
        item = {'regions': 'line-probe-regions.json', 'output': 'out.json'}
        self.assertIs(verifier.prepare(item), item)
        verifier.recognize.assert_not_called()
        verifier.prepare = Mock(side_effect=RuntimeError('inference failed'))
        self.assertIs(fast.prepare_or_fallback(verifier, item), item)


if __name__ == '__main__':
    unittest.main()
