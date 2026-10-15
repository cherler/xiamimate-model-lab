# Optional case assistant

Run `npm run dev:assistant` for same-origin pages and `/api/assistant/*` on loopback port 5328. Stop the old local server first. `npm run dev` and the public build remain static-only. Frozen model results and orders are never changed by a conversation.

## Configuration

Copy `.env.example` to ignored `.env` and configure the server base URL, key and model. Both OpenAI-compatible Chat Completions and Anthropic-compatible Messages are supported. `/anthropic` is detected automatically; `MODEL_LAB_AI_PROTOCOL` can override the protocol. Never put credentials into web files.

The current local configuration uses `MiniMax-M3` at `https://api.minimax.cn/v1`, with 32768 output tokens. M3 OpenAI requests use `max_completion_tokens` and `reasoning_split: true`; other compatible models retain `max_tokens`. The 1M context capacity is separate from the output allowance, which includes thinking. The runtime default is 8192; the configurable 1024–65536 range is an application guard, not a provider maximum claim.

For M3, `MODEL_LAB_AI_THINKING=auto` disables thinking in Ask AI and enables adaptive thinking in Agent mode. `disabled` or `adaptive` explicitly overrides that choice. Answer-format correction disables thinking. These are operating choices, not evidence of optimal model quality. M3.1-only effort settings are not applied to M3. References: https://platform.minimax.cn/docs/api-reference/text-openai-api and https://platform.minimax.cn/docs/api-reference/text-anthropic-api .

## Evidence and tool execution

Only the visitor's submitted question, up to four recent in-memory conversation messages, public-case identifier, explicit retail selection and server-owned public evidence are sent. No DOM, research-only results, arbitrary local files or cooperation forms are sent automatically. The visitor explicitly transfers a generated brief to the local editable form. Normal conversations are not persisted by the server.

Context-free Ask AI receives the public catalogue and compact model-upgrade status index. Retail Agent receives the public decision-case scope. Seed trace entries identify server-provided evidence; they are not autonomous model tool selections. Subsequent model calls may use only the defined read-only tools. Native assistant messages are retained across business-tool turns; private reasoning/signatures do not appear in UI or downloaded traces.

Retail results include unchanged raw pence metrics and server-derived display facts: GBP amounts converted once, exact dates/weekdays, same-selection cost/shortage differences and capacity semantics. When two resource settings share a frozen run/window/model and item order, the server computes `selectionChanges`, including direction and each policy's increased/decreased/unchanged products with pack/unit deltas. Different windows or models are not silently paired. The baseline is the explicit page selection, not whichever tool result arrived first. When the model queries a different resource setting in the same window/model, the runtime reads the form baseline once if needed, records that call as server-provided evidence and counts it against the tool budget. The final report rebuilds comparisons from that baseline, so calling the lower budget first cannot reverse the direction.

Every retail result also includes a complete descending order-quantity ranking per policy. Equal pack counts share competition ranks (1, 2, 2, 4); item IDs only break display ties. Top-three previews include all ties at rank three. Packs and units remain separate. Quantity ranking is not product value or procurement priority. Order records are not regenerated and no real orders are placed.

## Answer validation and correction

Answers require a JSON object with allowed fields, string summary/brief and citations to retrieved source IDs. A complete JSON code fence is accepted; arbitrary surrounding prose is not extracted. Invalid shape, unknown citations or focused factual-check failures permit **one** correction within the existing total task budget.

Correction is an independent formatting task containing the question, untrusted draft, allowed source IDs and successful public evidence. Agent history/private reasoning are not replayed. MiniMax-M3 OpenAI is asked to submit the corrected object through a single `submit_answer` function; business tools are unavailable. The prompt explicitly permits this function, avoiding a conflict with the prohibition on business tools. If the provider returns text despite the requested function, it is labeled `validated_text_required` and undergoes exactly the same checks; it is not silently trusted. An unexpected business-tool call is rejected. Failed attempts, usage and correction history remain visible, including on final errors.

When successful retail comparison/review results exist, the final response is explicitly marked `answerOrigin: tool_report`: the server compiles all quantitative retail prose, rankings, directional changes, sources and limitations from those results. The model still selects tools and submits a schema-valid final response, but its free-text draft and brief are not published in this branch. A validation entry discloses this separation; it does not claim the draft passed semantic validation. The UI labels it “工具计算结论”, with complete rankings and before/after item tables. This is a constrained report, not unrestricted AI causal explanation. Unsupported questions still require separate evidence; a correct report does not prove the model selected every tool the question required.

For non-report answers, focused checks catch unsupported amounts, common missing-unit or 100× currency mistakes, unprovided statistical-significance claims, mixed policy-ranking scope and assertions that a policy changed the shared per-item shortage penalty. Correct explicitly labeled pence/GBP conversions remain valid. An explicit ISO date paired with a wrong weekday is corrected by UTC calendar arithmetic, with an audit entry; impossible dates and negated statements are not rewritten. The 900-character retail summary target is a **presentation warning**, not a rejection rule.

These checks are not a general semantic verifier: a known number can still be assigned to the wrong context, and explanatory language can overgeneralize. Non-report AI prose still requires source review; retail reports do not inherit that prose. A valid JSON reply is not a successful business task. Generated markup is escaped, never rendered as HTML.

## Limits and evaluation

Local guards: 48 KB input, validated question/selection schema, 6 completion rounds, 10 business-tool calls, 4 calls per round, one correction, 90-second total cancellation, 2 concurrent HTTP requests, 20 requests per process/hour and 2 MiB provider response limit. Larger output budgets do not guarantee completion before the deadline. These controls are not production authentication or a billing quota. Pricing is unconfigured, so no cost estimate is shown.

`node --test tests/assistant-*.test.mjs` verifies frozen arithmetic, protocol state, citation/repair boundaries, evidence checks and safe rendering. Mock tests are not real model performance evidence.

`npm run eval:assistant` makes real API calls for twelve development tasks: the original eight, currency/calendar regressions, explicit quantity rankings and reverse-budget changes. Append task IDs for a recorded subset, e.g. `npm run eval:assistant unrun-model profit`. Ignored artifacts contain source SHA-256 hashes, selected tasks, completion state, requests, public tool traces, usage, timing and validation failures. They exclude private reasoning and keys. Keep earlier failures; partial/aborted runs must not be presented as complete. Review semantic correctness separately, with the reviewer identified. These are known-task development checks, not independent generalization or production reliability estimates. Current results and remaining limitations are recorded in `docs/agent-cooperation-plan.md`.
