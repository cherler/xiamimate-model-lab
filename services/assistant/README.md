# Optional case assistant

Run `npm run dev:assistant` for same-origin static pages and `/api/assistant/*` on loopback port 5328. `npm run dev` and the public build remain static-only. Stop the old local server before starting the optional one.

Copy `.env.example` to `.env`, then set the service base URL, key and model on the server. Requires an explicitly selected provider with Chat Completions `messages`, `tools`, `tool_calls`, `max_tokens` and JSON final text support. API reference: https://developers.openai.com/api/reference/resources/chat . Compatibility with a particular provider/model is not established until a live run passes. Never put credentials into web files. No external provider is selected by default.

The request sends only the visitor's question and up to four recent in-memory conversation messages, validated public-case identifier, explicit retail selection and server-owned public evidence. It does not send the document DOM, hidden research results, local paths or the cooperation form automatically. The visitor must explicitly transfer generated text to the local editable brief. No transcripts are persisted server-side.

Tool results are arithmetic/retrieval evidence; generated prose can still misinterpret them. Citation IDs are validated against retrieved sources, not a guarantee of semantic entailment. The UI separates the generated explanation from numeric tool reports. Raw generated markup never becomes HTML.

Engineering controls: 48 KB input, bounded question/selection schema, no arbitrary files/URLs/tools, 6 completion rounds/10 tool calls/4 calls per round, 90 s total cancellation, 2 concurrent requests, 20 requests per process per hour, max 1600 completion tokens per round. These are local demo guards, not a billing quota or production authentication. Provider pricing is unconfigured, so cost is not estimated. Public deployment needs explicit access/quota policy before exposing the proxy.

`node --test tests/assistant-*.test.mjs` uses real frozen retail artifacts for arithmetic and injected model responses for runtime tests. A passing test is not evidence of real model task success. Live answer quality, prompt-injection robustness, reliability and direct-model/workflow/Agent comparison remain pending until provider configuration and repeated human-reviewed tasks. The fixed workflow is honestly labeled and available without AI configuration.
