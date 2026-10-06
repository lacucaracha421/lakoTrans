"""Exercise CPU transport against a fake model boundary in real child processes."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2] / 'src/main/runtime/font-chapter-c18'
spec = importlib.util.spec_from_file_location('hayai_pool', ROOT / 'hayai-pool.py')
pool_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pool_module)

FAKE_MODEL = '''
import json
import os
from pathlib import Path
import time

def load_runtime(args):
    assert args.device in ('cpu', 'gpu')
    Path(str(os.getpid()) + '.device').write_text(args.device)
    Path(str(os.getpid()) + '.loaded').write_text('once')
    print('model diagnostic on stdout')
    return (None, None, None, None)

def normalize_batch_item(item):
    return item

def release_gpu_memory():
    pass

def dialogue_hint(region, text, chunks):
    assert chunks == [(0, text)]
    return {'id': region['id'], 'ocrText': text, 'bbox': region['bbox']}

def process_page(**args):
    assert (args['batch_size'], args['max_new_tokens'], args['max_num_patches']) == (8, 96, 256)
    item = json.loads(args['region_path'].read_text())
    if item.get('fail'):
        raise RuntimeError('model failure')
    if item.get('barrier'):
        Path(str(os.getpid()) + '.started').touch()
        until = time.monotonic() + 10
        while len(list(Path('.').glob('*.started'))) < 2:
            if time.monotonic() > until:
                raise RuntimeError('pages did not overlap')
            time.sleep(.01)
    result = {'items': item['items'], 'pid': os.getpid()}
    args['output_path'].write_text(json.dumps(result))
    return result
'''


class HayaiCpuPoolTests(unittest.TestCase):
    def test_large_cuda_batch_requires_sufficient_free_and_total_vram(self):
        device = SimpleNamespace(type='cuda')
        runtime = SimpleNamespace(torch=SimpleNamespace(version=SimpleNamespace(cuda='12.6'),
            cuda=SimpleNamespace(mem_get_info=lambda _: (12 * 1024 ** 3, 24 * 1024 ** 3))))
        self.assertEqual(pool_module.resolve_batch_size(runtime, device), 32)
        runtime.torch.cuda.mem_get_info = lambda _: (7 * 1024 ** 3, 24 * 1024 ** 3)
        self.assertEqual(pool_module.resolve_batch_size(runtime, device), 8)
        runtime.torch.cuda.mem_get_info = lambda _: (10 * 1024 ** 3, 12 * 1024 ** 3)
        self.assertEqual(pool_module.resolve_batch_size(runtime, device), 8)
        runtime.torch.version.cuda = None
        self.assertEqual(pool_module.resolve_batch_size(runtime, device), 8)
        self.assertEqual(pool_module.resolve_batch_size(runtime, SimpleNamespace(type='cpu')), 8)

    def test_fast_verified_glyphs_merge_with_fallback_in_original_order(self):
        batch, items = self.batch('mixed', [{'items': [{'id': 'b', 'ocrText': 'fallback'}]}])
        items[0].update(fastGlyphs=[{'region': {'id': 'a', 'bbox': [1, 2, 3, 4]}, 'text': 'exact'}],
                        glyphOrder=['a', 'b'])
        batch.write_text(json.dumps({'items': items}))
        with pool_module.HayaiPool(self.request) as run:
            run(batch)
        result = json.loads(Path(items[0]['output']).read_text())
        self.assertEqual(result['items'], [{'id': 'a', 'ocrText': 'exact', 'bbox': [1, 2, 3, 4]},
                                           {'id': 'b', 'ocrText': 'fallback'}])
        self.assertEqual(result['textEvidenceCount'], 2)
        self.assertFalse(result['noTextDetected'])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.script = self.root / 'fake_hayai.py'
        self.script.write_text(FAKE_MODEL)
        self.request = {'hayaiScript': str(self.script), 'workingDir': str(self.root)}
        self.env = patch.dict(os.environ, {'C18_HAYAI_CPU_WORKERS': '2',
                                          'C18_HAYAI_PYTHONPATH': ''})
        self.env.start()
        self.addCleanup(self.env.stop)

    def batch(self, name, values):
        items = []
        for index, value in enumerate(values):
            region = self.root / f'{name}-{index}-regions.json'
            region.write_text(json.dumps(value))
            items.append({'image': str(self.root / 'unchanged.png'),
                          'regions': str(region),
                          'output': str(self.root / f'{name}-{index}-output.json')})
        path = self.root / f'{name}-batch.json'
        path.write_text(json.dumps({'items': items}))
        return path, items

    def test_concurrent_pages_reuse_models_and_keep_results_bound_to_outputs(self):
        first, items = self.batch('first', [{'items': [3, 1], 'barrier': True},
                                          {'items': [8], 'barrier': True}])
        second, repeated = self.batch('recovery', [{'items': [5]}])
        pool = pool_module.HayaiPool(self.request)
        with pool as run:
            run(first)
            children = list(pool.children)
            run(second)
            self.assertEqual(len(list(self.root.glob('*.loaded'))), 2)
            self.assertEqual(json.loads(Path(items[0]['output']).read_text())['items'], [3, 1])
            self.assertEqual(json.loads(Path(items[1]['output']).read_text())['items'], [8])
            self.assertEqual(json.loads(Path(repeated[0]['output']).read_text())['pid'], children[0].pid)
        self.assertTrue(all(child.poll() == 0 for child in children))

    def test_empty_batch_does_not_load_a_model(self):
        batch, _ = self.batch('empty', [])
        with pool_module.HayaiPool(self.request) as run:
            run(batch)
        self.assertEqual(list(self.root.glob('*.loaded')), [])

    def test_gpu_uses_one_model_across_line_glyph_and_recovery_batches(self):
        self.request['ocrDevice'] = 'gpu'
        pool = pool_module.HayaiPool(self.request)
        outputs = []
        with pool as run:
            for name in ('line', 'glyph', 'recovery-line', 'recovery-glyph'):
                batch, items = self.batch(name, [{'items': [2, 1]}, {'items': [3]}])
                run(batch)
                outputs.extend(json.loads(Path(item['output']).read_text()) for item in items)
            children = list(pool.children)
            self.assertEqual(len(children), 1)
            self.assertEqual(len(list(self.root.glob('*.loaded'))), 1)
            self.assertEqual({item['pid'] for item in outputs}, {children[0].pid})
            self.assertEqual([item['items'] for item in outputs], [[2, 1], [3]] * 4)
            self.assertEqual((self.root / f'{children[0].pid}.device').read_text(), 'gpu')
        self.assertTrue(all(child.poll() == 0 for child in children))

    def test_worker_failure_reaps_every_child_and_does_not_report_success(self):
        batch, _ = self.batch('failure', [{'items': [], 'fail': True},
                                        {'items': [], 'barrier': True}])
        pool = pool_module.HayaiPool(self.request)
        children = []
        original_start = pool.start_child
        def record_child():
            original_start()
            children.append(pool.children[-1])
        pool.start_child = record_child
        with self.assertRaisesRegex(RuntimeError, 'exited before completing'):
            with pool as run:
                run(batch)
        self.assertEqual(len(children), 2)
        self.assertTrue(all(child.poll() is not None for child in children))


if __name__ == '__main__':
    unittest.main()
