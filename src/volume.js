/**
 * volume.js — Ajuste de volume de arquivos .nam
 *
 * Usa o módulo WASM de mrgeneko/nam_volume_knob (C++ compilado via Emscripten).
 * Referência: https://github.com/mrgeneko/nam_volume_knob
 *
 * API: Module.processNam(jsonString, linearFactor, gainDb) → jsonString modificado
 */

/**
 * Detecta se o modelo é Amp Head ou Full Rig.
 * @param {Object} metadata
 * @param {string} filename
 * @returns {'amp_head' | 'full_rig' | 'unknown'}
 */
export function detectModelType(metadata, filename = '') {
  const tags = ((metadata?.tags ?? []).join(' ')).toLowerCase();
  const name = (metadata?.name ?? filename ?? '').toLowerCase();
  const type = (metadata?.model_type ?? '').toLowerCase();

  if (
    type.includes('full') ||
    tags.includes('full rig') || tags.includes('full-rig') ||
    name.includes('full rig') || name.includes('full-rig')
  ) {
    return 'full_rig';
  }

  if (
    type.includes('amp') ||
    tags.includes('amp head') || tags.includes('amp-head') ||
    name.includes('amp head') || name.includes('amp-head') ||
    tags.includes('no cab') || name.includes('no cab')
  ) {
    return 'amp_head';
  }

  return 'unknown';
}

// Chaves que só existem em layers de modelos WaveNet Arquitetura 2 (A2, NAM >= 0.6.0).
// Confirmado comparando os exemplos oficiais wavenet_a1_standard.nam e wavenet_a2_max.nam
// do repositório sdatkinson/NeuralAmpModelerCore.
const A2_LAYER_MARKERS = [
  'bottleneck', 'gating_mode', 'groups_input', 'groups_input_mixin',
  'head1x1', 'layer1x1', 'conv_pre_film', 'conv_post_film', 'secondary_activation',
];

/**
 * Detecta se um .nam usa a Arquitetura 2 (A2, lançada em 2026).
 * A Pocket Master e o WASM de ajuste de volume (mrgeneko/nam_volume_knob) só entendem A1 —
 * processar um A2 corromperia o arquivo, pois o layout de pesos é diferente.
 *
 * @param {Object} namJson
 * @returns {'A1' | 'A2'}
 */
export function detectArchitectureGeneration(namJson) {
  const layers = namJson?.config?.layers;
  if (namJson?.architecture === 'WaveNet' && Array.isArray(layers)) {
    const isA2 = layers.some(
      (layer) => layer && A2_LAYER_MARKERS.some((key) => key in layer)
    );
    if (isA2) return 'A2';
  }
  return 'A1';
}

/**
 * Ajusta o volume de um modelo .nam via WASM.
 *
 * @param {Object} namJson - objeto JSON do arquivo .nam
 * @param {number} gainDb - ganho em dB
 * @returns {{ result: Object, scaledAll: false }}
 */
export function adjustVolume(namJson, gainDb) {
  const volumeModule = window.NamVolumeModule ?? (typeof Module !== 'undefined' ? Module : null);
  if (!volumeModule || typeof volumeModule.processNam !== 'function') {
    throw new Error('Módulo WASM ainda não carregado. Aguarde e tente novamente.');
  }

  const factor = Math.pow(10, gainDb / 20);
  const modified = volumeModule.processNam(JSON.stringify(namJson), factor, gainDb);

  if (typeof modified === 'string' && modified.startsWith('Error:')) {
    throw new Error(modified.replace(/^Error:\s*/, ''));
  }

  return { result: JSON.parse(modified), scaledAll: false };
}

/**
 * Lê um arquivo .nam e retorna o objeto JSON.
 * @param {File} file
 * @returns {Promise<Object>}
 */
export async function readNamFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(JSON.parse(e.target.result));
      } catch {
        reject(new Error('Falha ao parsear o arquivo .nam: não é um JSON válido.'));
      }
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsText(file);
  });
}

/**
 * Gera o download do .nam modificado.
 * @param {Object} namJson
 * @param {string} originalFilename
 * @param {number} gainDb
 */
export function downloadNam(namJson, originalFilename, gainDb) {
  const sign = gainDb >= 0 ? '+' : '';
  const baseName = originalFilename.replace(/\.nam$/i, '');
  const newName = `${baseName}_${sign}${gainDb}dB.nam`;

  const blob = new Blob([JSON.stringify(namJson)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = newName;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
