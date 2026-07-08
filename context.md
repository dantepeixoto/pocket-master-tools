# Pocket Master Tools — Contexto do Projeto

## O que é esse projeto

Um site estático (HTML + JS puro, sem framework) com ferramentas para usuários do **Sonicake Pocket Master** que usam arquivos `.nam` do Neural Amp Modeler.

## Problema que resolve

A Pocket Master não consegue rodar NAM + IR ao mesmo tempo (falta de processamento). Por isso:

- Modelos "Amp Head" (só o amp, sem cabinet) soam thin/harsh na Pocket Master
- Usuários precisam de modelos "Full Rig" (amp + cab embutido) para funcionar bem
- Além disso, muitos modelos têm volumes inconsistentes entre si

## Funcionalidades planejadas

### ✅ 1. Ajuste de volume do .nam

- Usuário arrasta o `.nam`, escolhe ganho em dB, baixa o arquivo modificado
- Lógica: escala os pesos da camada de saída (head weights) da rede neural
- Script Python de referência já foi criado: `nam_volume_knob.py`
- Precisar portar essa lógica para JavaScript

### 🔄 2. Gerador de Full Rig (DAW embutida no browser)

- Usuário arrasta um `.nam` do tipo "Amp Head"
- Site detecta automaticamente se é Amp Head ou Full Rig (lendo metadados do JSON)
- Usuário escolhe um IR: 🔴 "Porrada" ou 🟢 "Clean"
- Site gera dois arquivos de áudio:
  - `reamp_input.wav` — sinal de teste padrão do NAM (sweep de 48s)
  - `reamp_output.wav` — mesmo sinal processado pelo NAM + IR
- Usuário baixa os dois e sobe no Tone3000 para treinar um novo modelo Full Rig
- **Tudo roda no browser, sem servidor**

## Stack técnica

```
pocket-master-tools/
├── index.html
├── src/
│   ├── volume.js           (ajuste de volume — portar do Python)
│   ├── nam-processor.js    (carrega NAM via WebAssembly)
│   ├── ir-convolver.js     (aplica IR via Web Audio API ConvolverNode)
│   └── wav-encoder.js      (exporta áudio gerado como .wav)
├── assets/
│   ├── ir-heavy.wav        (IR "porrada" — a escolher no Tone3000, licença CC0/CC-BY)
│   └── ir-clean.wav        (IR "clean" — a escolher no Tone3000, licença CC0/CC-BY)
└── CONTEXT.md
```

- **HTML + JS puro** — sem framework, sem build step, abre direto no browser
- **Web Audio API** — ConvolverNode (convolução com IR), OfflineAudioContext (render offline), AudioBuffer
- **NAM WASM** — repositório `neural-amp-modeler-wasm` do Tone3000 (open source, MIT)
  - GitHub: https://github.com/tone-3000/neural-amp-modeler-wasm
- **Hospedagem** — GitHub Pages (gratuito, site estático)

## Detalhes técnicos importantes

### Formato .nam

- É um arquivo JSON com campos: `architecture`, `config`, `weights`, `metadata`
- Arquiteturas suportadas: LSTM, WaveNet, ConvNet, Linear e variantes
- Para ajuste de volume: escalar os últimos N pesos (head layer)
- `head_size` geralmente está em `config.head_size` ou calculado de `hidden_size + 1` (LSTM)
- Metadados a atualizar: `loudness` e `output_level_dbu`
- Para detectar tipo: checar campo de metadata ou nome (Full Rig vs Amp Head)

### Sample rate — CRÍTICO para Pocket Master

- A Pocket Master roda a **44.1kHz**
- A maioria dos NAMs disponíveis é treinada a **48kHz**
- A Pocket Master NÃO faz sample rate conversion correta — interpreta 48kHz como 44.1kHz
- **Solução**: treinar o novo modelo Full Rig já a 44.1kHz no Tone3000
- O Tone3000 trainer permite escolher o sample rate na hora do treinamento

### IR a escolher

- Dois IRs fixos embutidos no site (sem o usuário precisar subir nada)
- 🔴 "Porrada" — 4x12 estilo Marshall/Mesa, SM57, para rock/metal
- 🟢 "Clean" — 1x12 ou 2x12 estilo Fender/Vox, para clean/blues
- **Obrigatório**: licença CC0 ou CC-BY para uso livre
- Fonte recomendada: Tone3000, OwnHammer free, ML Sound Lab free

### Tone3000 API

- Existe uma API REST (beta): https://www.tone3000.com/api
- Versão atual: busca/download de tones, autenticação OAuth
- **Não tem endpoint de treinamento ainda** — documentação diz que vem em breve
- Vale contactar: support@tone3000.com para perguntar sobre API de treinamento

## Fluxo completo do usuário (Feature 2)

```
1. Arrasta o .nam no site
2. Site detecta: "Amp Head detectado — vamos adicionar o cabinet"
3. Usuário escolha: 🔴 Porrada  ou  🟢 Clean
4. Clica em "Gerar áudios" (leva ~30s)
5. Baixa: reamp_input.wav + reamp_output.wav
6. Site mostra link + instruções para o Tone3000 trainer
7. No Tone3000: sobe os dois .wav, treina a 44.1kHz, baixa o .nam Full Rig
8. Importa o novo .nam na Pocket Master via SonicLink ou Sonicake Manager
```

## Hospedagem

**Recomendado: GitHub Pages**

- Gratuito, ilimitado para sites estáticos
- Deploy automático via push no repositório
- URL: `https://seuusuario.github.io/pocket-master-tools`
- Como ativar: Settings → Pages → Source → Deploy from branch → main

**Alternativas gratuitas:**

- **Netlify** — arrastar a pasta no site já faz o deploy, URL customizável, muito fácil
- **Vercel** — similar ao Netlify, ótimo DX
- **Cloudflare Pages** — CDN global, muito rápido, free tier generoso

Para esse projeto (site estático, sem backend, sem banco), GitHub Pages ou Netlify são mais que suficientes.

## Próximos passos

1. [ ] Criar estrutura de pastas do projeto
2. [ ] Explorar o `neural-amp-modeler-wasm` do Tone3000 e entender como carregar um .nam e processar áudio
3. [ ] Portar lógica de ajuste de volume do Python para JS (`volume.js`)
4. [ ] Implementar detecção de tipo (Amp Head vs Full Rig)
5. [ ] Implementar geração do sinal de teste (sweep padrão do NAM)
6. [ ] Implementar convolução com IR (`ir-convolver.js`)
7. [ ] Implementar exportação de .wav (`wav-encoder.js`)
8. [ ] Escolher e licenciar os dois IRs
9. [ ] Montar UI simples e clara
10. [ ] Deploy no GitHub Pages

## Atualização (jul/2026) — NAM Arquitetura 2 (A2)

Em 2026 o NAM lançou a **Arquitetura 2 (A2)**, um novo formato de rede (stack de módulos estilo WaveNet, mas feedforward, com FiLM/gating/bottleneck) que reduz uso de CPU e melhora a qualidade. **Decisão do projeto: não dar suporte a A2 por enquanto** — a Pocket Master só roda A1, e portar o parseamento seria trabalho grande sem benefício imediato para os usuários. Em vez disso, o site passou a:

- Avisar explicitamente na ferramenta de **Ajuste de Volume** que só A1 é suportado (aviso fixo + bloqueio automático se detectar A2).
- Detectar A2 comparando `config.layers[i]` — em modelos WaveNet A2 aparecem chaves que não existem em A1: `bottleneck`, `gating_mode`, `groups_input`, `groups_input_mixin`, `head1x1`, `layer1x1`, `conv_pre_film`, `conv_post_film`, `secondary_activation`. Confirmado comparando os exemplos oficiais `wavenet_a1_standard.nam` (version 0.5.0) e `wavenet_a2_max.nam` (version 0.6.0) do repo `sdatkinson/NeuralAmpModelerCore`. Ver `detectArchitectureGeneration()` em `src/volume.js`.
- O **Tone3000 parou de treinar modelos A1** (o pipeline de treino web deles só gera A2 agora — "Can I still train A1 or custom architectures on TONE3000? No."). Por isso o Gerador de Full Rig não manda mais o usuário treinar no Tone3000; agora aponta para o tutorial em vídeo (https://www.youtube.com/watch?v=fbxO6XHU8x4) e o notebook do Google Colab **NAMTrainerColab** (https://colab.research.google.com/github/sdatkinson/NAMTrainerColab/blob/main/notebook.ipynb), que ainda treina A1 (usa `neural-amp-modeler==0.13`, anterior ao A2).
- **Achado importante**: o `input.wav` que o NAMTrainerColab pede para o reamp é **byte-a-byte idêntico** ao `T3K-sweep-v3.wav` já usado no site (mesmo md5). Ou seja, **não foi preciso trocar o arquivo de sweep** — só expor um link de download com o nome `input.wav` apontando pro arquivo que já existia (`src/T3K-sweep-v3.wav`), reaproveitando o `wet_signal.wav` gerado pela ferramenta como o `output.wav` que o notebook espera.

## Referências

- NAM WASM (Tone3000): https://github.com/tone-3000/neural-amp-modeler-wasm
- NAM Core (original): https://github.com/sdatkinson/NeuralAmpModelerCore
- Tone3000 API docs: https://www.tone3000.com/api
- Projeto de referência (C++ → WASM): https://github.com/mrgeneko/nam_volume_knob
- Script Python de ajuste de volume: `nam_volume_knob.py` (já criado nessa conversa)
