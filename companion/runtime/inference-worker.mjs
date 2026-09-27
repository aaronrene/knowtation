import './inference-egress-guard.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeRoot = path.resolve(process.argv[2] ?? '');
if (!path.isAbsolute(runtimeRoot)) throw new Error('PRIVATE_MODEL_UNAVAILABLE');

let model;
let tokenizer;
let ort;
let loadMilliseconds;

async function load() {
  if (model) return;
  const start = performance.now();
  const ortRoot = path.join(runtimeRoot, 'node_modules/onnxruntime-web/dist');
  ort = await import(pathToFileURL(path.join(ortRoot, 'ort.wasm.min.mjs')));
  globalThis[Symbol.for('onnxruntime')] = ort;
  const transformersPath = path.join(
    runtimeRoot,
    'node_modules/@huggingface/transformers/dist/transformers.web.js'
  );
  const { BertTokenizer, env } = await import(pathToFileURL(transformersPath));
  env.allowRemoteModels = false;
  env.useFSCache = false;
  env.useBrowserCache = false;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = `${ortRoot}/`;
  ort.env.wasm.wasmBinary = await fs.readFile(path.join(ortRoot, 'ort-wasm-simd-threaded.wasm'));
  const modelRoot = path.join(runtimeRoot, 'models/all-MiniLM-L6-v2');
  tokenizer = new BertTokenizer(
    JSON.parse(await fs.readFile(path.join(modelRoot, 'tokenizer.json'), 'utf8')),
    JSON.parse(await fs.readFile(path.join(modelRoot, 'tokenizer_config.json'), 'utf8'))
  );
  model = await ort.InferenceSession.create(
    await fs.readFile(path.join(modelRoot, 'onnx/model_quantized.onnx')),
    { executionProviders: ['wasm'] }
  );
  loadMilliseconds = performance.now() - start;
}

async function embed(texts) {
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > 96 ||
      texts.some((text) => typeof text !== 'string' || Buffer.byteLength(text) > 4096)) {
    throw new Error('PRIVATE_INFERENCE_INPUT');
  }
  await load();
  const inputs = tokenizer(texts, { padding: true, truncation: false });
  if (inputs.input_ids.dims[1] > 256) throw new Error('PRIVATE_CONTEXT_LIMIT');
  const feeds = Object.fromEntries(model.inputNames.map((name) => [
    name,
    new ort.Tensor('int64', inputs[name].data, inputs[name].dims),
  ]));
  const outputs = await model.run(feeds);
  const hidden = outputs.last_hidden_state;
  const [batch, length, dimensions] = hidden.dims;
  const vectors = [];
  for (let row = 0; row < batch; row += 1) {
    const vector = Array(dimensions).fill(0);
    let count = 0;
    for (let token = 0; token < length; token += 1) {
      if (inputs.attention_mask.data[row * length + token] === 0n) continue;
      count += 1;
      for (let column = 0; column < dimensions; column += 1) {
        vector[column] += hidden.data[(row * length + token) * dimensions + column];
      }
    }
    for (let column = 0; column < dimensions; column += 1) vector[column] /= count;
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    vectors.push(vector.map((value) => value / norm));
  }
  return vectors;
}

let queue = Promise.resolve();
process.on('message', (message) => {
  queue = queue.then(async () => {
    try {
      if (message?.command !== 'embed' || Object.keys(message.arguments ?? {}).join(',') !== 'texts') {
        throw new Error('PRIVATE_INFERENCE_INPUT');
      }
      const vectors = await embed(message.arguments.texts);
      process.send?.({ id: message.id, ok: true, result: { vectors, loadMilliseconds } });
    } catch (error) {
      const safe = String(error?.message ?? '').startsWith('PRIVATE_')
        ? error.message
        : 'PRIVATE_MODEL_UNAVAILABLE';
      process.send?.({ id: message?.id ?? 'invalid', ok: false, error: safe });
    }
  });
});
process.send?.({ ready: true, pid: process.pid });
