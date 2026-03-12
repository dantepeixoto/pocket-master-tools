# Pocket Master Tools

Ferramentas web para quem usa arquivos `.nam` no **Sonicake Pocket Master**.

## O que esse projeto faz

Este site resolve dois problemas comuns:

1. **Ajuste de volume de `.nam`**
- Você sobe um arquivo `.nam`
- Escolhe o ganho em dB
- Baixa o `.nam` ajustado

2. **Gerador de Full Rig (Head + IR)**
- Você sobe um `.nam` de amp head
- Escolhe um cabinet IR (Drive/High Gain ou Clean)
- O site processa o sweep e gera `wet_signal.wav` para usar no Tone3000

Tudo roda no navegador, sem backend.

## Como usar

1. Abra o site.
2. Escolha a ferramenta:
- **Ajuste de Volume** para aumentar/reduzir nível do `.nam`.
- **Gerador de Full Rig** para criar o `wet_signal.wav`.
3. Siga as instruções exibidas na tela.

## Rodando localmente (importante)

O runtime oficial do NAM precisa de `SharedArrayBuffer`, então o servidor local deve enviar:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Exemplo rápido com Python:

```bash
cd /media/dante/dados2/projetos/pocket-master-tools
cat > /tmp/coop_server.py <<'PY'
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

ThreadingHTTPServer(("127.0.0.1", 3000), H).serve_forever()
PY
python3 /tmp/coop_server.py
```

Abra `http://127.0.0.1:3000` e confira no console:

```js
window.crossOriginIsolated
```

Deve retornar `true`.

## Deploy no Netlify

Este projeto já inclui o arquivo [`_headers`](./_headers) com os headers necessários.

Deploy simples:

1. Arraste a pasta do projeto para o Netlify.
2. Após publicar, abra o site e valide:

```js
window.crossOriginIsolated
```

Se retornar `true`, o runtime oficial está pronto para uso.

## Estrutura principal

```text
.
├── index.html
├── src/
│   ├── volume.js
│   ├── nam-official-runtime.js
│   ├── ir-convolver.js
│   ├── wav-encoder.js
│   └── ...
├── t3k-wasm-module.js
├── t3k-wasm-module.wasm
├── t3k-wasm-module.aw.js
├── t3k-wasm-module.worker.js
├── t3k-wasm-module.ww.js
└── _headers
```

## Créditos

- Neural Amp Modeler Core (Steve Atkinson)
- neural-amp-modeler-wasm (Tone3000)
- nam_volume_knob (mrgeneko)
