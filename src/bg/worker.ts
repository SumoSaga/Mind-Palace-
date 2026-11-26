/// <reference lib="webworker" />
// Background removal runs here, off the main thread, so the workspace stays
// responsive. The model is downloaded from Hugging Face the first time and
// cached by the browser afterwards.
//
// Model: ormbg (Apache-2.0), run on the CPU. BiRefNet-lite (MIT) was tried
// first and gives better results in general, but in the browser its GPU path
// failed ("Too many storage buffers in shader") and its CPU path ran out of
// memory, so it is not usable here yet.
import { pipeline } from '@huggingface/transformers';

const MODEL = 'onnx-community/ormbg-ONNX';

export type WorkerRequest = { id: number; src: string };
export type WorkerReply =
  | { id: number; type: 'status'; message: string }
  /** `rgba` is the image with its background made transparent, 4 bytes per pixel. */
  | { id: number; type: 'done'; rgba: Uint8ClampedArray; width: number; height: number }
  | { id: number; type: 'error'; message: string };

const post = (reply: WorkerReply, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(reply, transfer);

// The library's types for this pipeline are loose; it is called as the model card shows.
let segmenter: Promise<any> | null = null;

function load(id: number): Promise<any> {
  if (!segmenter) {
    segmenter = pipeline('background-removal', MODEL, {
      device: 'wasm',
      dtype: 'fp32',
      progress_callback: (p: any) => {
        if (p?.status === 'progress' && typeof p.progress === 'number' && String(p.file).endsWith('.onnx')) {
          post({ id, type: 'status', message: `Downloading model ${Math.round(p.progress)}%` });
        }
      },
    });
    segmenter.catch(() => {
      segmenter = null;
    });
  }
  return segmenter;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, src } = e.data;
  try {
    post({ id, type: 'status', message: 'Preparing…' });
    const run = await load(id);
    post({ id, type: 'status', message: 'Removing background…' });
    const [result] = await run([src]);
    if (result.channels !== 4) throw new Error('Unexpected result from the background model');
    const rgba = new Uint8ClampedArray(result.data);
    post({ id, type: 'done', rgba, width: result.width, height: result.height }, [rgba.buffer]);
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
