/**
 * ir-convolver.js — Aplica um IR (Impulse Response) a um AudioBuffer
 *
 * Usa Web Audio API: OfflineAudioContext + ConvolverNode
 * para processar o sinal de saída do NAM com o cabinet escolhido.
 */

/**
 * Carrega um arquivo WAV de IR a partir de uma URL e retorna um AudioBuffer.
 * @param {string} url - caminho para o arquivo .wav do IR
 * @param {number|null} sampleRate - sample rate alvo (opcional)
 * @returns {Promise<AudioBuffer>}
 */
export async function loadIR(url, sampleRate = null) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao carregar IR: ${url} (HTTP ${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();

  // AudioContext temporário apenas para decodificar.
  // Se sampleRate não for informado, preserva o padrão do device/browser.
  const tempCtx = sampleRate
    ? new AudioContext({ sampleRate })
    : new AudioContext();
  const irBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();

  return irBuffer;
}

/**
 * Aplica um IR a um AudioBuffer usando OfflineAudioContext + ConvolverNode.
 * Processa offline (não em tempo real) — adequado para gerar reamp_output.wav.
 *
 * @param {AudioBuffer} inputBuffer - sinal de entrada (saída do NAM)
 * @param {AudioBuffer} irBuffer - impulse response do cabinet
 * @returns {Promise<AudioBuffer>} - sinal convolvido
 */
export async function applyIR(inputBuffer, irBuffer) {
  const sampleRate = inputBuffer.sampleRate;
  const targetLength = inputBuffer.length; // obrigatório: mesmo tamanho do input (exigência do Tone3000)

  // Renderiza com tamanho exato do input — a cauda do IR é cortada intencionalmente.
  // O ConvolverNode aplica o IR em tempo real; o OfflineAudioContext para em targetLength samples.
  const offlineCtx = new OfflineAudioContext(1, targetLength, sampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  const convolver = offlineCtx.createConvolver();
  // Mantem ganho consistente do IR original para evitar variacoes inesperadas.
  convolver.normalize = false;
  convolver.buffer = irBuffer;

  source.connect(convolver);
  convolver.connect(offlineCtx.destination);

  source.start(0);

  return await offlineCtx.startRendering();
}

/**
 * Resamplea um AudioBuffer para o sample rate alvo, se necessário.
 * Usa OfflineAudioContext internamente.
 *
 * @param {AudioBuffer} buffer
 * @param {number} targetSampleRate
 * @returns {Promise<AudioBuffer>}
 */
export async function resample(buffer, targetSampleRate) {
  if (buffer.sampleRate === targetSampleRate) return buffer;

  const ratio = targetSampleRate / buffer.sampleRate;
  const newLength = Math.round(buffer.length * ratio);

  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    newLength,
    targetSampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}
