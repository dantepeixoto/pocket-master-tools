/**
 * nam-processor.js — Forward pass do NAM em JavaScript puro
 * Suporta: LSTM, WaveNet
 */

// ─────────────────────────────────────────────
// Funções de ativação
// ─────────────────────────────────────────────

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const tanh = Math.tanh;

// ─────────────────────────────────────────────
// LSTM
// ─────────────────────────────────────────────

function extractLstmWeights(namJson) {
  const H = namJson.config.hidden_size;
  const w = namJson.weights;
  let o = 0;
  const rd = (n) => { const a = w.slice(o, o + n); o += n; return a; };

  // Layout: wIh [4H×1], wHh [4H×H], bIh [4H], bHh [4H], wHead [H], bHead [1]
  const wIh   = rd(4 * H);
  const wHh   = rd(4 * H * H);
  const bIh   = rd(4 * H);
  const bHh   = rd(4 * H);
  const wHead = rd(H);
  const bHead = rd(1);

  return { H, wIh, wHh, bIh, bHh, wHead, bHead };
}

function lstmProcess(params, inputData, onProgress) {
  const { H, wIh, wHh, bIh, bHh, wHead, bHead } = params;
  const N = inputData.length;
  const out = new Float32Array(N);

  let h = new Float64Array(H);
  let c = new Float64Array(H);

  // Warm-up com silêncio (1s)
  const warmup = Math.min(inputData.length > 0 ? Math.floor(inputData.length / 48) : 44100, 44100);
  for (let i = 0; i < warmup; i++) {
    const step = lstmStep(0, h, c, params);
    h = step.h; c = step.c;
  }

  const CHUNK = 4096;
  return new Promise(async (resolve) => {
    for (let i = 0; i < N; i += CHUNK) {
      const end = Math.min(i + CHUNK, N);
      for (let j = i; j < end; j++) {
        const step = lstmStep(inputData[j], h, c, params);
        h = step.h; c = step.c;
        out[j] = step.out;
      }
      if (onProgress) onProgress(i / N);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (onProgress) onProgress(1);
    resolve(out);
  });
}

function lstmStep(x, h, c, { H, wIh, wHh, bIh, bHh, wHead, bHead }) {
  const gates = new Float64Array(4 * H);
  for (let g = 0; g < 4 * H; g++) {
    gates[g] = bIh[g] + bHh[g] + wIh[g] * x;
    for (let k = 0; k < H; k++) gates[g] += wHh[g * H + k] * h[k];
  }
  const newC = new Float64Array(H);
  const newH = new Float64Array(H);
  for (let k = 0; k < H; k++) {
    const i_ = sigmoid(gates[k]);
    const f  = sigmoid(gates[H + k]);
    const g  = tanh(gates[2 * H + k]);
    const o  = sigmoid(gates[3 * H + k]);
    newC[k] = f * c[k] + i_ * g;
    newH[k] = o * tanh(newC[k]);
  }
  let out = bHead[0];
  for (let k = 0; k < H; k++) out += wHead[k] * newH[k];
  return { h: newH, c: newC, out };
}

// ─────────────────────────────────────────────
// WaveNet
// ─────────────────────────────────────────────

function extractWaveNetWeights(namJson) {
  const cfg = namJson.config;
  if (!cfg || !Number.isFinite(cfg.num_channels) || !Number.isFinite(cfg.num_layers) || !Number.isFinite(cfg.kernel_size)) {
    if (Array.isArray(cfg?.layers)) {
      throw new Error(
        'WaveNet em formato "stacked layers" detectado (config.layers). ' +
        'Este formato ainda nao e suportado pelo processador JS atual.'
      );
    }
    throw new Error(
      'WaveNet com config invalida para este processador. ' +
      'Esperado: num_channels, num_layers, kernel_size.'
    );
  }
  const C = cfg.num_channels;
  const K = cfg.kernel_size;
  const numLayers = cfg.num_layers;
  const dilations = cfg.dilations ?? Array.from({ length: numLayers }, (_, i) => Math.pow(2, i % 10));

  const w = namJson.weights;
  let o = 0;
  const rd = (n) => { const a = w.slice(o, o + n); o += n; return a; };

  // Weight layout (PyTorch state_dict order seguindo NAM Core):
  // 1. input_conv: weight [C, 1, 1] → C valores; bias [C]
  // 2. Para cada layer: filter_weight [2C,C,K], filter_bias [2C],
  //                     res_weight [C,C,1]=C², res_bias [C],
  //                     skip_weight [C,C,1]=C², skip_bias [C]
  // 3. head: weight [1,C] → C valores; bias [1]

  const inputWeight = rd(C);       // [C]
  const inputBias   = rd(C);       // [C]

  const layers = [];
  for (let l = 0; l < numLayers; l++) {
    const filterWeight = rd(2 * C * C * K); // [2C, C, K]
    const filterBias   = rd(2 * C);
    const resWeight    = rd(C * C);         // [C, C]
    const resBias      = rd(C);
    const skipWeight   = rd(C * C);         // [C, C]
    const skipBias     = rd(C);
    layers.push({ filterWeight, filterBias, resWeight, resBias, skipWeight, skipBias, dilation: dilations[l] });
  }

  const headWeight = rd(C); // [1, C]
  const headBias   = rd(1);

  const consumed = o;
  const total = w.length;
  if (consumed !== total) {
    console.warn(`WaveNet: ${consumed} pesos consumidos de ${total}. Possível incompatibilidade de arquitetura.`);
  }

  return { C, K, numLayers, dilations, inputWeight, inputBias, layers, headWeight, headBias };
}

/**
 * Convola 1D causal com dilation, sample-by-sample via ring buffer.
 * buffer: Float64Array de tamanho [bufSize * inC], interpretado como [bufSize][inC]
 * weight: Float64Array de tamanho [outC * inC * K]
 * bias:   Float64Array de tamanho [outC]
 * pos:    índice atual no ring buffer (write pointer)
 */
function causalConv1dSample(input, buffer, bufSize, K, dilation, inC, outC, weight, bias, pos) {
  const output = new Float64Array(outC);

  for (let oc = 0; oc < outC; oc++) {
    let sum = bias[oc];
    for (let k = 0; k < K; k++) {
      // Posição no passado: k * dilation amostras atrás
      const bufPos = ((pos - k * dilation) % bufSize + bufSize) % bufSize;
      for (let ic = 0; ic < inC; ic++) {
        const wIdx = oc * inC * K + ic * K + k;
        sum += weight[wIdx] * buffer[bufPos * inC + ic];
      }
    }
    output[oc] = sum;
  }
  return output;
}

function waveNetProcess(params, inputData, onProgress) {
  const { C, K, numLayers, layers, inputWeight, inputBias, headWeight, headBias } = params;
  const N = inputData.length;
  const out = new Float32Array(N);

  // Aloca ring buffers para cada layer
  // Tamanho do buffer = (K-1)*dilation + 1 (mínimo para causalidade)
  const buffers = layers.map((layer) => {
    const bufSize = (K - 1) * layer.dilation + 1;
    return { data: new Float64Array(bufSize * C), size: bufSize, pos: 0 };
  });

  // Buffer de entrada (K=1 na input_conv, então não precisa de history)
  // mas mantemos consistência

  const CHUNK = 1024;
  return new Promise(async (resolve) => {
    for (let i = 0; i < N; i += CHUNK) {
      const end = Math.min(i + CHUNK, N);
      for (let n = i; n < end; n++) {
        const x = inputData[n];

        // 1. Input conv (kernel=1, sem history): h = inputWeight * x + inputBias
        const h0 = new Float64Array(C);
        for (let c = 0; c < C; c++) {
          h0[c] = inputWeight[c] * x + inputBias[c];
        }

        let residual = h0;
        const skipSum = new Float64Array(C);

        // 2. WaveNet layers
        for (let l = 0; l < numLayers; l++) {
          const layer = layers[l];
          const buf = buffers[l];

          // Escreve o residual atual no ring buffer
          for (let c = 0; c < C; c++) {
            buf.data[buf.pos * C + c] = residual[c];
          }

          // Dilated causal conv: [2C output]
          const gated = causalConv1dSample(
            residual, buf.data, buf.size, K, layer.dilation,
            C, 2 * C, layer.filterWeight, layer.filterBias, buf.pos
          );

          // Gated activation: tanh(first half) * sigmoid(second half)
          const activated = new Float64Array(C);
          for (let c = 0; c < C; c++) {
            activated[c] = tanh(gated[c]) * sigmoid(gated[C + c]);
          }

          // Res conv (1x1): [C]
          const res = new Float64Array(C);
          for (let oc = 0; oc < C; oc++) {
            res[oc] = layer.resBias[oc];
            for (let ic = 0; ic < C; ic++) {
              res[oc] += layer.resWeight[oc * C + ic] * activated[ic];
            }
            res[oc] += residual[oc]; // residual connection
          }

          // Skip conv (1x1): [C]
          for (let oc = 0; oc < C; oc++) {
            let s = layer.skipBias[oc];
            for (let ic = 0; ic < C; ic++) {
              s += layer.skipWeight[oc * C + ic] * activated[ic];
            }
            skipSum[oc] += s;
          }

          // Avança ring buffer
          buf.pos = (buf.pos + 1) % buf.size;
          residual = res;
        }

        // 3. Head: linear sobre skipSum
        let y = headBias[0];
        for (let c = 0; c < C; c++) y += headWeight[c] * skipSum[c];
        out[n] = y;
      }

      if (onProgress) onProgress(i / N);
      await new Promise((r) => setTimeout(r, 0));
    }

    if (onProgress) onProgress(1);
    resolve(out);
  });
}

// ─────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────

/**
 * Processa um AudioBuffer através de um modelo NAM (.nam).
 * Suporta LSTM e WaveNet.
 *
 * @param {Object} namJson - JSON do arquivo .nam
 * @param {AudioBuffer} inputBuffer - sinal de entrada (mono)
 * @param {function(number):void} [onProgress] - callback 0..1
 * @returns {Promise<AudioBuffer>}
 */
export async function processWithNam(namJson, inputBuffer, onProgress) {
  const arch = (namJson.architecture ?? '').toUpperCase();
  const inputData = inputBuffer.getChannelData(0);
  const sampleRate = inputBuffer.sampleRate;

  let outputData;

  if (arch.includes('LSTM')) {
    const params = extractLstmWeights(namJson);
    outputData = await lstmProcess(params, inputData, onProgress);

  } else if (arch.includes('WAVENET')) {
    const params = extractWaveNetWeights(namJson);
    outputData = await waveNetProcess(params, inputData, onProgress);

  } else {
    throw new Error(
      `Arquitetura "${namJson.architecture}" não suportada. ` +
      `Suportadas: LSTM, WaveNet.`
    );
  }

  // Diagnóstico: verifica NaN e amplitude do output
  let nanCount = 0, peak = 0;
  for (let i = 0; i < Math.min(outputData.length, 10000); i++) {
    if (isNaN(outputData[i])) nanCount++;
    else peak = Math.max(peak, Math.abs(outputData[i]));
  }
  console.log(`[NAM] arch=${namJson.architecture} | config=${JSON.stringify(namJson.config)} | weights.length=${namJson.weights?.length}`);
  console.log(`[NAM] primeiras 10k amostras: ${nanCount} NaN | peak=${peak.toFixed(6)}`);
  console.log(`[NAM] primeiros 5 valores:`, Array.from(outputData.slice(0, 5)));

  const outCtx = new OfflineAudioContext(1, outputData.length, sampleRate);
  const outBuffer = outCtx.createBuffer(1, outputData.length, sampleRate);
  outBuffer.copyToChannel(outputData, 0);
  return outBuffer;
}
