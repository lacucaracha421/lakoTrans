"""Run with the owned runtime dependencies or a Python with numpy/Pillow/OpenCV."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2] / 'src/main/runtime/font-chapter-c18'


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), 'utf-8')


class SourceRecovery(unittest.TestCase):
    def test_short_selection_without_pixel_cutoff_keeps_strict_evidence(self):
        refine = load('refine-line-supported-glyphs')
        items = [
            {'accepted': True, 'authority': 'strict_glyph_ocr'},
            {'accepted': False, 'authority': 'pending_context'},
        ]
        refine.corroborate(items, None)
        self.assertEqual([i['accepted'] for i in items], [True, False])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            chapter, aligned, verified, output = [root / name for name in ['chapter', 'aligned', 'verified', 'output']]
            image = Image.new('L', (30, 40), 255)
            ImageDraw.Draw(image).rectangle((10, 5, 15, 34), fill=0)
            image.save(root / 'source.png')
            write(chapter / 'ocr-baseline/baseline-report.json', {'pages': [{'pageId': 'P1', 'imagePath': str(root / 'source.png')}]})
            glyph = {'characterIndex': 0, 'bbox': [8, 3, 18, 37], 'token': 'あ', 'shapeDistance': 0.1}
            write(aligned / 'alignment.json', {'records': [{'key': 'P1/D1', 'sourceText': 'あ', 'direction': 'vertical', 'lines': [
                {'lineId': 1, 'text': 'あ', 'bbox': [8, 3, 18, 37], 'glyphs': [glyph]}]}]})
            write(verified / 'analysis.json', {'summary': {'cutoff': None, 'glyphs': 1}, 'blocks': [{'key': 'P1/D1'}],
                'verification': [{'key': 'P1/D1', 'lineId': 1, 'characterIndex': 0, 'accepted': True, 'actual': 'あ', 'ocrAgreement': True}]})
            refine.run(chapter, aligned, verified, output)
            result = json.loads((output / 'analysis.json').read_text('utf-8'))
            self.assertIsNone(result['summary']['cutoff'])
            self.assertEqual(result['summary']['strictGlyphs'], 1)
            self.assertEqual(result['summary']['contextSupportedGlyphs'], 0)
            self.assertEqual(result['groups'], [])
            self.assertEqual(result['blocks'][0]['glyphs'][0]['authority'], 'strict_glyph_ocr')

    def test_preserves_existing_evidence_and_rejects_mismatched_or_single_letter_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            chapter, aligned, verified, output = [root / name for name in ['chapter', 'aligned', 'verified', 'output']]
            old_glyph = {'character': 'あ', 'lineId': 1, 'characterIndex': 0,
                         'bbox': [0, 0, 10, 10], 'image': 'glyphs/old.png',
                         'glyphOcrAgreement': True}
            old = {'summary': {'glyphs': 1, 'strictGlyphs': 1, 'contextSupportedGlyphs': 0,
                               'removedStrictGlyphs': 0, 'cutoff': 0.123},
                   'blocks': [{'key': 'P1/D1', 'sourceText': 'あいう', 'glyphs': [old_glyph]},
                              {'key': 'P1/D2', 'sourceText': 'あいう', 'glyphs': []}],
                   'pairs': [], 'groups': []}
            write(chapter / 'line-supported/analysis.json', old)
            old_file = chapter / 'line-supported' / old_glyph['image']
            old_file.parent.mkdir()
            image = Image.new('L', (48, 48), 255)
            ImageDraw.Draw(image).rectangle((10, 8, 15, 39), fill=0)
            image.save(old_file)
            old_bytes = old_file.read_bytes()
            glyphs = [dict(old_glyph, image='glyphs/new-a.png'),
                      dict(old_glyph, character='い', bbox=[0, 12, 10, 22], image='glyphs/new-i.png'),
                      dict(old_glyph, character='え', lineId=2, bbox=[12, 0, 22, 10], image='glyphs/mismatch.png'),
                      dict(old_glyph, character='う', lineId=3, bbox=[24, 0, 34, 10], image='glyphs/single.png')]
            # A duplicate bbox must not inflate the matching evidence.
            glyphs.append(dict(glyphs[0]))
            write(verified / 'analysis.json', {'blocks': [
                {'key': 'P1/D1', 'glyphs': glyphs}, {'key': 'P1/D2', 'glyphs': glyphs}]})
            (verified / 'glyphs').mkdir()
            for glyph in glyphs:
                image.save(verified / glyph['image'])
            write(aligned / 'alignment.json', {'records': [{'key': 'P1/D2', 'lines': [
                {'lineId': 1, 'text': 'あい', 'bbox': [0, 0, 10, 22]},
                {'lineId': 2, 'text': 'えお', 'bbox': [12, 0, 22, 22]},
                {'lineId': 3, 'text': 'う', 'bbox': [24, 0, 34, 10]}]}]})
            load('recover-zero-glyph-evidence').run(chapter, aligned, verified, output)
            result = json.loads((output / 'analysis.json').read_text('utf-8'))
            self.assertEqual(result['blocks'][0]['glyphs'], [old_glyph])
            self.assertEqual((output / old_glyph['image']).read_bytes(), old_bytes)
            self.assertEqual([g['character'] for g in result['blocks'][1]['glyphs']], ['あ', 'い'])
            self.assertEqual(result['summary']['cutoff'], 0.123)
            self.assertEqual(result['summary']['strictGlyphs'], 3)
            self.assertEqual(result['summary']['glyphs'], 3)
            self.assertEqual(result['summary']['contextSupportedGlyphs'], 0)
            self.assertEqual(result['summary']['c23RecoveredBlocks'], 1)
            self.assertEqual(old_file.read_bytes(), old_bytes)

    def test_no_missing_regions_skips_extra_ocr(self):
        with tempfile.TemporaryDirectory() as directory:
            chapter = Path(directory)
            write(chapter / 'line-supported/analysis.json', {'blocks': [{'glyphs': [{}]}]})
            worker = load('worker')
            worker.hayai = lambda *_: self.fail('Unnecessary Hayai recovery call')
            self.assertEqual(worker.recover_source_evidence(chapter, None, None), chapter / 'line-supported')
            self.assertFalse((chapter / 'recovery').exists())


class RuntimeImageEfficiency(unittest.TestCase):
    def test_empty_verification_does_not_open_unrelated_pages(self):
        group = load('group-verified-glyphs')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write(root / 'chapter/ocr-baseline/baseline-report.json', {'pages': [
                {'pageId': 'unused', 'imagePath': str(root / 'does-not-exist.png')}]})
            write(root / 'aligned/alignment.json', {'records': []})
            write(root / 'aligned/batch.json', {'items': []})
            with patch.object(group.Image, 'open', side_effect=AssertionError('unrelated page decoded')):
                group.run(root / 'chapter', root / 'aligned', root / 'result')
            result = json.loads((root / 'result/analysis.json').read_text('utf-8'))
            self.assertEqual(result['blocks'], [])
            self.assertEqual(result['verification'], [])
            self.assertEqual(result['groups'], [])

    def test_cache_preserves_pixels_modes_and_closes_on_switch_and_failure(self):
        helper = load('analyze-matched-glyphs')
        with tempfile.TemporaryDirectory() as directory:
            paths = {str(i): Path(directory) / f'{i}.png' for i in range(2)}
            for i, path in enumerate(paths.values()):
                Image.new('RGB', (17, 23), (20 + i, 45, 90)).save(path)
            for mode in ('RGB', 'L', None):
                with self.assertRaisesRegex(RuntimeError, 'failure'):
                    with helper.PageImageCache(paths, mode) as cache:
                        first = cache['0']
                        self.assertIs(first, cache['0'])
                        with Image.open(paths['0']) as source:
                            expected = source.convert(mode) if mode else source.copy()
                        self.assertEqual(first.crop((2, 3, 13, 19)).tobytes(), expected.crop((2, 3, 13, 19)).tobytes())
                        second = cache['1']
                        with self.assertRaises(ValueError):
                            first.getpixel((0, 0))
                        raise RuntimeError('failure')
                with self.assertRaises(ValueError):
                    second.getpixel((0, 0))

    def test_production_probe_keeps_mapping_and_native_regions_without_overlays(self):
        probe = load('prepare-line-probe')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = Image.new('RGB', (80, 120), 'white')
            ImageDraw.Draw(image).rectangle((25, 15, 33, 95), fill='black')
            image.save(root / 'source.png')
            candidate = {'candidateId': 'D1', 'sourceText': 'あい', 'direction': 'vertical',
                         'bbox': {'x1': 10, 'y1': 5, 'x2': 60, 'y2': 110}, 'estimate': {'facePx': 12}}
            write(root / 'ocr-baseline/baseline-report.json', {'pages': [
                {'pageId': 'P1', 'imagePath': str(root / 'source.png'), 'candidates': [candidate]},
                {'pageId': 'P2', 'imagePath': str(root / 'missing.png'), 'candidates': [candidate]}]})
            with patch.object(probe.Image, 'open', wraps=probe.Image.open) as opened:
                probe.build(root, root / 'fast', only_keys={'P1/D1'}, dark_core=True, diagnostic_overlays=False)
                self.assertEqual(opened.call_count, 1)
            self.assertEqual(list((root / 'fast').glob('*-lines.png')), [])
            # The diagnostic default remains available; use the same valid source for P2.
            report = json.loads((root / 'ocr-baseline/baseline-report.json').read_text('utf-8'))
            report['pages'][1]['imagePath'] = str(root / 'source.png')
            write(root / 'ocr-baseline/baseline-report.json', report)
            probe.build(root, root / 'diagnostic', only_keys={'P1/D1'}, dark_core=True)
            fast = json.loads((root / 'fast/line-map.json').read_text('utf-8'))
            diagnostic = json.loads((root / 'diagnostic/line-map.json').read_text('utf-8'))
            self.assertEqual(fast['blocks'], diagnostic['blocks'])
            self.assertEqual(fast['policy'], diagnostic['policy'])
            self.assertTrue((root / 'diagnostic/P1-lines.png').exists())

    def test_short_extraction_decodes_each_page_once_even_for_interleaved_groups(self):
        palette = load('assign-coherent-source-palette')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pages = {}
            for pid in ('P1', 'P2'):
                path = root / (pid + '.png')
                image = Image.new('RGB', (60, 80), 'white')
                ImageDraw.Draw(image).rectangle((22, 10, 30, 65), fill='black')
                image.save(path)
                pages[pid] = {'imagePath': str(path)}
            keys = ['P1/D1', 'P2/D1', 'P1/D2']
            groups = [{'members': [key]} for key in keys]
            rows = {key: {'sourceText': 'あ'} for key in keys}
            candidates = {key: {'bbox': {'x1': 5, 'y1': 5, 'x2': 50, 'y2': 75}, 'direction': 'vertical'} for key in keys}
            expected = {}
            for key in keys:
                with Image.open(pages[key.split('/')[0]]['imagePath']) as image:
                    expected[key] = palette.glyph.extract_line(image, {'id': 0, 'bbox': [5, 5, 50, 75]}, 'あ', 'vertical')
            with patch.object(palette.glyph.Image, 'open', wraps=palette.glyph.Image.open) as opened:
                actual = palette.extract_short_group_glyphs(groups, rows, candidates, pages)
                self.assertEqual(opened.call_count, 2)
            for key in keys:
                self.assertEqual(len(actual[key]), len(expected[key]))
                for a, b in zip(actual[key], expected[key]):
                    self.assertEqual(a['character'], b['character'])
                    np.testing.assert_array_equal(a['tensor'], b['tensor'])


if __name__ == '__main__':
    unittest.main()
