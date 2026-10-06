"""Chapter transport for the unchanged Hayai page/batch inference contract.

Each child owns one model. Line crops retain their original order and minibatches.
An optional exact-match verifier removes accepted single glyphs before dispatch;
the original glyph order is restored through the runtime's normal hint contract.
The pool lives for one chapter in the app worker's cancellation process tree.
"""
import concurrent.futures
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import time
from types import SimpleNamespace


class HayaiPool:
    def __init__(self, request):
        self.request = request
        self.device = request.get('ocrDevice', 'cpu')
        self.limit = (max(1, int(os.environ.get('C18_HAYAI_CPU_WORKERS', '1')))
                      if self.device == 'cpu' else 1)
        self.children = []
        self.verifier = None
        self.fast_module = None
        if self.device == 'cpu' and request.get('glyphVerificationAssets'):
            spec = importlib.util.spec_from_file_location('glyph_fast', Path(__file__).with_name('glyph-fast-verification.py'))
            self.fast_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.fast_module)
            self.verifier = self.fast_module.create(request['glyphVerificationAssets'])

    def __enter__(self):
        return self.run

    def __exit__(self, *_):
        self.close()

    def start_child(self):
        env = dict(os.environ)
        env['PYTHONPATH'] = env.get('C18_HAYAI_PYTHONPATH', env.get('PYTHONPATH', ''))
        child = subprocess.Popen(
            [sys.executable, '-u', str(Path(__file__).resolve()),
             self.request['hayaiScript'], self.device],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr,
            text=True, encoding='utf-8', env=env, cwd=self.request['workingDir'],
            creationflags=(subprocess.CREATE_NO_WINDOW |
                           (subprocess.BELOW_NORMAL_PRIORITY_CLASS if self.device == 'cpu' else 0))
            if os.name == 'nt' else 0,
        )
        self.children.append(child)

    def run(self, batch, _request=None):
        items = json.loads(Path(batch).read_text('utf-8-sig'))['items']
        if not items:
            return
        started = time.perf_counter()
        count = min(self.limit, len(items))
        try:
            while len(self.children) < count:
                self.start_child()
            pending = queue.Queue()
            for index, item in enumerate(items, 1):
                pending.put((index, item))
            with concurrent.futures.ThreadPoolExecutor(max_workers=count) as executor:
                futures = [executor.submit(self.consume, child, pending, len(items))
                           for child in self.children[:count]]
                try:
                    for future in concurrent.futures.as_completed(futures):
                        future.result()
                except BaseException:
                    # Reap children before waiting on other pipe readers. A failed
                    # child must not leave its siblings doing a long OCR batch.
                    self.terminate()
                    raise
        except BaseException:
            self.close()
            raise
        print(json.dumps({'phase': 'font_ocr_batch_done', 'batch': str(batch),
                          'items': len(items), 'workers': count,
                          'seconds': time.perf_counter() - started}), file=sys.stderr, flush=True)

    def consume(self, child, pending, total):
        while True:
            try:
                index, item = pending.get_nowait()
            except queue.Empty:
                return
            print(json.dumps({'phase': 'start', 'index': index, 'total': total,
                              'output': item['output'], 'count': 0}), file=sys.stderr, flush=True)
            if self.verifier is not None:
                item = self.fast_module.prepare_or_fallback(self.verifier, item)
            child.stdin.write(json.dumps(item) + '\n')
            child.stdin.flush()
            line = child.stdout.readline()
            if not line:
                raise RuntimeError(f'Hayai worker exited before completing {item["output"]}')
            result = json.loads(line)
            if not result.get('ok') or result.get('output') != item['output']:
                raise RuntimeError(f'Hayai worker failed: {result}')
            print(json.dumps({'phase': 'done', 'index': index, 'total': total,
                              'output': item['output'], 'count': result['count']}), file=sys.stderr, flush=True)

    def terminate(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
        for child in self.children:
            child.wait()

    def close(self):
        # All requests have finished here. EOF shuts down idle model processes.
        for child in self.children:
            # A worker failure can leave a buffered request aimed at a closed
            # pipe. Reaping the other children must still happen in that case.
            with contextlib.suppress(BrokenPipeError):
                child.stdin.close()
        for child in self.children:
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            child.stdout.close()
        self.children.clear()


def resolve_batch_size(runtime, device):
    torch = getattr(runtime, 'torch', None)
    version = getattr(torch, 'version', None)
    if getattr(device, 'type', None) != 'cuda' or not getattr(version, 'cuda', None):
        return 8
    free, total = torch.cuda.mem_get_info(device)
    # Keep low-memory/ROCm/CPU defaults. The existing runtime recursively splits
    # a batch on CUDA OOM if another application consumes VRAM after this check.
    return 32 if free >= 8 * 1024 ** 3 and total >= 16 * 1024 ** 3 else 8


def serve(script, device):
    # Embedded Python ignores PYTHONPATH. Use the same engine-owned directory
    # supplied by the managed runtime, never the font worker's dependency stack.
    paths = os.environ.get('C18_HAYAI_PYTHONPATH', '').split(os.pathsep)
    sys.path[:0] = [path for path in paths if path]
    spec = importlib.util.spec_from_file_location('hayai_runtime', script)
    runtime = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(sys.stderr):
        spec.loader.exec_module(runtime)
        model, tokenizer, processor, device = runtime.load_runtime(SimpleNamespace(device=device))
        batch_size = resolve_batch_size(runtime, device)
    for line in sys.stdin:
        command = json.loads(line)
        item = runtime.normalize_batch_item(command)
        with contextlib.redirect_stdout(sys.stderr):
            payload = runtime.process_page(
                image_path=Path(item['image']), region_path=Path(item['regions']),
                output_path=Path(item['output']), model=model, tokenizer=tokenizer,
                processor=processor, device=device, batch_size=batch_size,
                max_new_tokens=96, max_num_patches=256,
            )
            if command.get('fastGlyphs'):
                by_id = {row['id']: row for row in payload['items']}
                for fast in command['fastGlyphs']:
                    region, text = fast['region'], fast['text']
                    by_id[region['id']] = runtime.dialogue_hint(region, text, [(0, text)])
                payload['items'] = [by_id[key] for key in command['glyphOrder']]
                payload['textEvidenceCount'] = sum(bool(row.get('ocrText')) for row in payload['items'])
                payload['noTextDetected'] = not payload['items']
                Path(item['output']).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', 'utf-8')
            runtime.release_gpu_memory()
        print(json.dumps({'ok': True, 'output': item['output'],
                          'count': len(payload['items'])}), flush=True)


if __name__ == '__main__':
    serve(sys.argv[1], sys.argv[2])
