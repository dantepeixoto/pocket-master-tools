/**
 * nam-official-runtime.js — Processamento NAM usando runtime oficial Tone3000 WASM
 */

let runtimePromise = null;
let runtimeModule = null;
let runtimeAudioContext = null;
let runtimeAudioWorkletNode = null;
const RUNTIME_BASE_URL = new URL('../', import.meta.url).href;
const RUNTIME_JS_URL = new URL('../t3k-wasm-module.js', import.meta.url).href;
const RUNTIME_AW_URL = new URL('../t3k-wasm-module.aw.js', import.meta.url).href;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeDisconnect(node, destination = null) {
  if (!node || typeof node.disconnect !== 'function') return;
  try {
    if (destination) node.disconnect(destination);
    else node.disconnect();
  } catch {
    // Ignora disconnect duplicado ou conexao inexistente.
  }
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Timeout aguardando ${label}.`);
}

function loadScriptOnce(url) {
  return import(url);
}

async function ensureRuntimeLoaded() {
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      throw new Error(
        'Runtime oficial NAM requer Cross-Origin Isolation (COOP/COEP) e SharedArrayBuffer. ' +
        'Hospede com os headers: Cross-Origin-Opener-Policy: same-origin e Cross-Origin-Embedder-Policy: require-corp.'
      );
    }

    window.wasmAudioWorkletCreated = (node, context) => {
      runtimeAudioWorkletNode = node;
      runtimeAudioContext = context;
    };

    window.Module = {
      // Em import() nao existe document.currentScript, entao o runtime pode perder
      // referencias para .aw.js/.worker/.wasm. Fixamos urls absolutas aqui.
      mainScriptUrlOrBlob: RUNTIME_JS_URL,
      locateFile: (path) => {
        if (!path) return RUNTIME_AW_URL;
        return new URL(path, RUNTIME_BASE_URL).href;
      },
    };

    await loadScriptOnce(RUNTIME_JS_URL);

    runtimeModule = await waitFor(() => {
      const module = window.Module;
      if (!module) return null;
      const ready = module.runtimeInitialized === true || !!module.wasmMemory;
      const hasFns =
        typeof module._malloc === 'function' &&
        typeof module._free === 'function' &&
        typeof module.ccall === 'function' &&
        typeof module.stringToUTF8 === 'function' &&
        !!module.asm;
      if (!(ready && hasFns)) return null;

      // Probe real para evitar estado "metade inicializado" (erro Module.asm undefined).
      try {
        const ptr = module._malloc(1);
        module._free(ptr);
        return module;
      } catch {
        return null;
      }
    }, 30000, 'inicializacao do modulo WASM oficial');

  })();
  try {
    return await runtimePromise;
  } catch (err) {
    runtimePromise = null;
    throw err;
  }
}

async function setOfficialDspFromNamJson(namJson) {
  await ensureRuntimeLoaded();

  const jsonStr = JSON.stringify(namJson);
  const bytes = new TextEncoder().encode(jsonStr);
  const ptr = runtimeModule._malloc(bytes.length + 1);

  try {
    runtimeModule.stringToUTF8(jsonStr, ptr, bytes.length + 1);
    await runtimeModule.ccall('setDsp', null, ['number'], [ptr], { async: true });
  } finally {
    runtimeModule._free(ptr);
  }

  await waitFor(
    () => runtimeAudioContext && runtimeAudioWorkletNode,
    20000,
    'criacao do AudioWorklet do runtime oficial'
  );
}

async function resampleAudioBuffer(buffer, targetSampleRate) {
  if (buffer.sampleRate === targetSampleRate) return buffer;

  const ratio = targetSampleRate / buffer.sampleRate;
  const newLength = Math.round(buffer.length * ratio);
  const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, newLength, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  return await offlineCtx.startRendering();
}

export async function processWithOfficialNam(namJson, inputBuffer, onProgress) {
  await setOfficialDspFromNamJson(namJson);

  const contextSampleRate = runtimeAudioContext.sampleRate;
  const alignedInput = await resampleAudioBuffer(inputBuffer, contextSampleRate);

  const source = runtimeAudioContext.createBufferSource();
  source.buffer = alignedInput;

  const inputGain = runtimeAudioContext.createGain();
  inputGain.gain.value = 1;

  const tapNode = runtimeAudioContext.createScriptProcessor(4096, 1, 1);
  const silentOut = runtimeAudioContext.createGain();
  silentOut.gain.value = 0;

  const chunks = [];
  let captured = 0;
  const expected = alignedInput.length;
  let completed = false;

  const markComplete = () => {
    completed = true;
  };

  tapNode.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(data.length);
    copy.set(data);
    chunks.push(copy);
    captured += copy.length;
    if (onProgress) onProgress(Math.min(captured / expected, 1));
  };

  source.connect(inputGain);
  inputGain.connect(runtimeAudioWorkletNode);
  runtimeAudioWorkletNode.connect(tapNode);
  tapNode.connect(silentOut);
  silentOut.connect(runtimeAudioContext.destination);

  await runtimeAudioContext.resume();

  const startAt = runtimeAudioContext.currentTime + 0.03;
  source.start(startAt);
  source.stop(startAt + alignedInput.duration);
  source.onended = markComplete;

  const deadline = Date.now() + Math.ceil((alignedInput.duration * 4 + 10) * 1000);
  let resumeAt = Date.now();
  while ((captured < expected || !completed) && Date.now() < deadline) {
    if (Date.now() >= resumeAt) {
      resumeAt = Date.now() + 1000;
      if (runtimeAudioContext.state === 'suspended') {
        try {
          await runtimeAudioContext.resume();
        } catch {
          // tenta novamente no proximo ciclo
        }
      }
    }
    await sleep(20);
  }
  if (captured < expected) {
    console.warn(
      `[NAM OFFICIAL] captura incompleta: captured=${captured} expected=${expected} ` +
      `contextSR=${runtimeAudioContext.sampleRate} inputSR=${alignedInput.sampleRate} state=${runtimeAudioContext.state}`
    );
    throw new Error(`Captura incompleta do runtime oficial (${captured}/${expected} amostras).`);
  }

  safeDisconnect(source);
  safeDisconnect(inputGain);
  safeDisconnect(runtimeAudioWorkletNode, tapNode);
  safeDisconnect(tapNode);
  safeDisconnect(silentOut);
  tapNode.onaudioprocess = null;

  const output = new Float32Array(expected);
  let writeOffset = 0;
  for (const chunk of chunks) {
    if (writeOffset >= output.length) break;
    const available = output.length - writeOffset;
    const toCopy = Math.min(available, chunk.length);
    output.set(chunk.subarray(0, toCopy), writeOffset);
    writeOffset += toCopy;
  }

  if (onProgress) onProgress(1);

  const outCtx = new OfflineAudioContext(1, output.length, contextSampleRate);
  const outBuffer = outCtx.createBuffer(1, output.length, contextSampleRate);
  outBuffer.copyToChannel(output, 0);

  return outBuffer;
}
