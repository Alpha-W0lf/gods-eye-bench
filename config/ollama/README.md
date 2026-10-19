# Local models through Ollama

Ollama's OpenAI-compatible endpoint ignores a requested context size and uses
the model's default, which cuts God's Eye View answers short (2,048 tokens for
`qwen3.5:4b` with Ollama 0.34.4, measured 2026-10-03). These Modelfiles make
variants with a 32k context. They reuse the base model's weights.

```bash
ollama create geb-qwen3.5-4b -f config/ollama/qwen3.5-4b.Modelfile
```

```bash
ollama create geb-gemma4-e2b -f config/ollama/gemma4-e2b.Modelfile
```

```bash
ollama create geb-qwen3.5-9b -f config/ollama/qwen3.5-9b.Modelfile
```

```bash
ollama create geb-granite4.1-8b -f config/ollama/granite4.1-8b.Modelfile
```

Pull a base model first if it is missing, for example `ollama pull qwen3.5:9b`
(6.6 GB) or `ollama pull granite4.1:8b` (5.3 GB).

Then run one as a community run (its label, concurrency and time limit come
from its entry in `config/models.json`):

```bash
npm run geb -- run --adapter openai-compatible --model geb-qwen3.5-4b --status community --out /tmp/geb
```

Remove a variant with `ollama rm geb-qwen3.5-4b`.
