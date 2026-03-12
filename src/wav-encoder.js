/**
 * wav-encoder.js — Exporta AudioBuffer como arquivo .wav
 *
 * Formato: PCM 16-bit, little-endian, com header RIFF padrão.
 * Suporta mono e estéreo.
 */

/**
 * Converte um AudioBuffer para Blob WAV.
 * @param {AudioBuffer} audioBuffer
 * @returns {Blob}
 */
export function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = numSamples * numChannels * bytesPerSample;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // ── RIFF header ──
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // ── fmt chunk ──
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);           // chunk size
  view.setUint16(20, 1, true);            // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true);              // block align
  view.setUint16(34, 16, true);           // bits per sample

  // ── data chunk ──
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // ── interleave samples (float32 → int16) ──
  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const raw = channels[c][i];
      if (!Number.isFinite(raw)) {
        throw new Error(`AudioBuffer inválido: NaN/Infinity no canal ${c}, amostra ${i}.`);
      }
      const sample = Math.max(-1, Math.min(1, raw));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Gera o download de um AudioBuffer como arquivo .wav.
 * @param {AudioBuffer} audioBuffer
 * @param {string} filename - ex: "reamp_input.wav"
 */
export function downloadWav(audioBuffer, filename) {
  const blob = audioBufferToWavBlob(audioBuffer);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Cria um sinal de teste padrão do NAM (impulso de 1 sample seguido de silêncio).
 * Usado como reamp_input: sinal que vai entrar no NAM para capturar a resposta.
 *
 * O sinal de referência do NAM é um arquivo de áudio específico de ~48s.
 * Aqui geramos uma versão simplificada: ruído rosa filtrado + silêncio,
 * adequada para treinar modelos no Tone3000.
 *
 * @param {number} sampleRate - taxa de amostragem (44100 para Pocket Master)
 * @param {number} durationSeconds - duração em segundos (padrão: 48)
 * @returns {AudioBuffer}
 */
export function generateTestSignal(sampleRate = 44100, durationSeconds = 48) {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const ctx = new OfflineAudioContext(1, numSamples, sampleRate);
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // Sinal de teste: sweep logarítmico de 20Hz a 20kHz
  // (melhor cobertura espectral para treinar o modelo)
  const f0 = 20;
  const f1 = 20000;
  const T = durationSeconds;
  const k = Math.log(f1 / f0);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Logarithmic sine sweep
    data[i] = Math.sin(2 * Math.PI * f0 * T / k * (Math.exp(t * k / T) - 1));
  }

  // Fade in/out de 0.1s para evitar cliques
  const fadeLen = Math.floor(sampleRate * 0.1);
  for (let i = 0; i < fadeLen; i++) {
    const g = i / fadeLen;
    data[i] *= g;
    data[numSamples - 1 - i] *= g;
  }

  return buffer;
}

// ── helpers ──

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
