# Optional case assistant

Run `npm run dev:assistant` for same-origin static pages and `/api/assistant/*` on loopback port 5328. `npm run dev` and the public build remain static-only. Stop the old local server before starting the optional one.

Copy `.env.example` to `.env`, then set the service base URL, key and model on the server. Supports OpenAI-compatible Chat Completions and Anthropic-compatible Messages. `/anthropic` is detected automatically; `MODEL_LAB_AI_PROTOCOL` can explicitly select `openai` or `anthropic`. Both require tools and a JSON final answer. API reference: https://developers.openai.com/api/reference/resources/chat . The MiniMax-M3 endpoints have returned live responses; this confirms connectivity, not task correctness or stability. Never put credentials into web files. No external provider is selected by default.

The request sends only the visitor's question and up to four recent in-memory conversation messages, validated public-case identifier, explicit retail selection and server-owned public evidence. It does not send the document DOM, hidden research results, local paths or the cooperation form automatically. The visitor must explicitly transfer generated text to the local editable brief. No transcripts are persisted server-side.

Tool results are arithmetic/retrieval evidence; generated prose can still misinterpret them. Citation IDs are validated against retrieved sources, not a guarantee of semantic entailment. The UI separates the generated explanation from numeric tool reports. Raw generated markup never becomes HTML.

Engineering controls: 48 KB input, bounded question/selection schema, no arbitrary files/URLs/tools, 6 completion rounds/10 tool calls/4 calls per round, 90 s total cancellation, 2 concurrent requests, 20 requests per process per hour, default 8192 generated tokens per round (including thinking; configurable 1024–65536; local MiniMax configuration uses 32768). These are local demo guards, not a billing quota or production authentication. Provider pricing is unconfigured, so cost is not estimated. Public deployment needs explicit access/quota policy before exposing the proxy.

`node --test tests/assistant-*.test.mjs` uses real frozen retail artifacts for arithmetic and injected model responses for runtime tests. A passing test is not evidence of real model task success. Live answer quality, prompt-injection robustness, reliability and direct-model/workflow/Agent comparison require repeated reviewed tasks; the first integration runs include failures. The fixed workflow is honestly labeled and available without AI configuration.

After configuration, `npm run eval:assistant` runs the eight fixed tasks in `evaluation-tasks.json`, saving local ignored transcripts. This intentionally makes paid API calls. Review each criterion and repeat runs before reporting task success or stability; a syntactically valid answer is not a successful task. No evaluation has been fabricated for an unconfigured service.

## MiniMax-M3 protocol

The current integration uses `https://api.minimax.cn/v1` with `MiniMax-M3`, as requested by the project owner. M3 sends `max_completion_tokens` (not both length parameters), and `reasoning_split: true`. Other compatible models retain `max_tokens`.

Anthropic compatibility remains available at `https://api.minimax.cn/anthropic`; MiniMax documents this alternative at: https://platform.minimax.cn/docs/guides/text-generation . The adapter calls `/anthropic/v1/messages`, converts the tool schema/results, retains the full native assistant content blocks internally across tool turns, and exposes only final answer text to the UI. Thinking blocks and signatures are not added to trace downloads.

The official M3 defaults differ: Anthropic Messages disables thinking by default; OpenAI compatibility enables it. We explicitly disable it for simple `ask` questions and enable `adaptive` for `agent` tasks. These are our initial operating choices, not measured evidence that they are optimal. `MODEL_LAB_AI_THINKING=disabled|adaptive` overrides this. M3.1-specific effort levels must not be applied to M3. See https://platform.minimax.cn/docs/api-reference/text-anthropic-api and https://platform.minimax.cn/docs/api-reference/text-openai-api .

`https://api.minimax.cn/v1` remains supported through the OpenAI adapter; MiniMax reasoning is split from final text, and the complete assistant message is retained for subsequent tool turns. Using a different protocol does not by itself prove higher model quality.

The 1M context capacity does not set the output budget. The OpenAI compatibility documentation counts thinking against the generation limit and recommends `max_completion_tokens` for new integrations. The local 65536 ceiling is an application guard, not a claim about the provider maximum. Responses are bounded to 2 MiB; the 90-second task deadline still applies, so a larger output allowance does not guarantee that a long generation will complete.

Final answers are checked for JSON/object shape, allowed fields and retrieved citations. A failed check allows one model correction within the existing six-round/90-second budget. Correction disables tools and preserves native assistant state; it never substitutes a fabricated answer. Both attempts appear in a separate validation record, including on errors. Invalid raw output and private reasoning are not included in that record. This is format recovery, not semantic validation.

Retail tool responses now include server-derived `display` facts: GBP amounts converted once from pence, same-selection cost/shortage differences, policy labels, exact window dates/weekdays and the inventory-capacity interpretation. Existing raw metrics remain unchanged for audit and UI tables. Case summaries also expose modeling-path status and explicitly state that these tools cannot retrieve arbitrary per-model/per-sample scores.

Focused answer checks reject unsupported £ amounts, common missing-unit/raw-pence patterns and incorrect date/weekday claims. They share the single correction budget with format validation. These checks catch the observed failure classes; they are not a complete semantic verifier (e.g. a known number can still be attributed to the wrong policy). Keep human-readable scope and source review, and the deterministic tables, alongside AI prose.

Explicitly labeled correct pence or GBP values remain acceptable (including unit-conversion questions). The guard rejects the 100× mismatch or a missing unit, not correct explanations of the conversion. A negative statement such as “并非都是周四” is allowed; exact date/weekday pairs are still checked.
