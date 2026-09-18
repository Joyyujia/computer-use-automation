# Computer-Use Automation System

An end-to-end vertical slice that lets an LLM discover a UI workflow once, compiles that run into a typed capability, and replays the capability without a model in the decision loop.

The included target is a fictional legacy-style member-servicing application. Never use real credentials or PII.

## What is implemented

- Genuine OpenAI-powered observe -> decide -> act discovery with an API-compatible strict object response envelope
- Configured target navigation before the first model call, plus redacted, executable extraction targets from app declarations or labeled legacy fields with stable IDs
- Versioned, reviewable, parameterized capability artifacts
- Successful-action-only compilation followed by fresh-browser deterministic validation before artifact persistence
- Deterministic Playwright replay with bounded competing-state waits and no model fallback
- Structured success, business-outcome, intervention, and failure results
- Reviewed success/outcome/recovery contracts kept distinct from model-learned steps
- Origin/route/action allowlists, popup/redirect checks, resolved navigation checks, and trusted risk inference across locator fallbacks
- Redaction before persistence, sanitized DOM observations, and sensitive-literal rejection
- Same-session human handoff for configured interventions, recovery failures, execution failures, and final verification failures, with exclusive control, resume, and abort
- Browser acceptance tests for two-member reuse, delayed outcomes, stale state, recovery, ambiguity, frames, leakage, and handoff

## Setup

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Set `OPENAI_API_KEY` in your environment for a genuine discovery run. `OPENAI_MODEL` is configurable and defaults to `gpt-5.4-mini`. The API request uses `store: false`.

## End-to-end demo

Start the fictional legacy application:

```bash
npm run demo:app
```

In another terminal, export the values from `.env` and run genuine discovery:

```bash
set -a
source .env
set +a

CUA_MEMBER_ID=12345 npm run discover -- "Look up the supplied member and read their savings balance"
```

Discovery opens and policy-checks the configured entrypoint before the model receives its first observation. It writes a draft capability under `artifacts/generated/` only after replaying that exact generated artifact in a fresh browser and matching its typed outputs. Failed actions are retained in evidence/history but never compiled. It does not silently promote the artifact to approved.

`approval: "draft"` is review metadata in this assignment implementation, not a replay gate: the CLI intentionally executes draft artifacts so a newly discovered capability can be demonstrated and evaluated. A production registry or deployment wrapper should reject non-`approved` artifacts before invoking replay.

The live adapter records provider response IDs and marks provenance as live. The scripted adapter used in tests cannot produce live provenance. The reviewed API-backed run, exact generated artifact, deterministic replays, and same-session handoff are tracked in [`evidence/submission/index.json`](evidence/submission/index.json); tests remain separate supporting evidence. A fresh post-hardening live discovery and model-disabled replay are retained as [supplemental independent verification](evidence/submission/independent-verification/index.json).

For the complete discovery-to-replay demonstration, copy the `artifactPath` printed by the successful discovery result and pass that exact, unedited file to replay. Removing `OPENAI_API_KEY` demonstrates that replay has no model dependency:

```bash
env -u OPENAI_API_KEY npm run replay -- \
  /absolute/path/printed/as/artifactPath \
  '{"memberId":"67890"}'
```

The repository also includes a bundled-fixture shortcut for exercising replay without first making an API call:

```bash
npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"12345"}'
npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"67890"}'
```

Exercise the expected business outcome:

```bash
npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"99999"}'
```

The unknown-member invocation returns `status: "business_outcome"` and `code: "member_not_found"` rather than a technical failure.

The fixture supports controlled states without adding hidden shortcuts to the automation engine:

```bash
CUA_TARGET_URL='http://127.0.0.1:4173/?delayMs=800' npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"67890"}'
CUA_TARGET_URL='http://127.0.0.1:4173/?notice=1' npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"12345"}'
CUA_TARGET_URL='http://127.0.0.1:4173/?hang=1' npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"12345"}'
```

`CUA_TARGET_URL` is a CLI entrypoint overlay for fixture and tenant routing; the replay engine still executes the validated artifact with no model decisions.

The `?hang=1` fixture intentionally withholds every terminal result. After the bounded automation timeout it can enter operator handoff and wait for up to five minutes; open `http://127.0.0.1:4174` and choose **Abort run** when the timeout path has been demonstrated.

## Human handoff demo

The normal replay command can trigger the configured `session_expired` intervention:

```bash
CUA_HEADLESS=false CUA_TARGET_URL='http://127.0.0.1:4173/?expired=1' npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"12345"}'
```

Open `http://127.0.0.1:4174`, take control, click **Restore session** inside the operator console's session preview, then return control. Do not click the control in the separate Playwright browser window: only preview interactions are recorded as human actions and enable **Return control**. Replay revalidates that the expiry state cleared and continues in the same Playwright context. The control lease rejects automation input while the human owns the session. The operator can also abort; typed values are recorded only as `Typed redacted text`.

## Tests

```bash
npm run check
npm test
npm run test:coverage
```

The suite covers domain validation, policy and risk branches, artifact compilation, model-adapter contracts, state transitions, redaction, deterministic outcomes and failures, bounded recovery, discovery stopping conditions, frame targeting, popup/dialog handling, leakage canaries, and same-session handoff. Coverage thresholds fail the build below 80% statements/lines/functions or 70% branches.

Browser integration tests open loopback ports and launch Chromium. They use a scripted model adapter solely for repeatability; fixture runs are explicitly marked `createdFromLiveRun: false` and are not represented as the assignment's genuine model evidence.

Generate the reviewed mechanics evidence set with:

```bash
npm run evidence:samples
```

The tracked [`evidence/samples/index.json`](evidence/samples/index.json) is explicitly labeled `scripted_non_live_evidence`. It proves the evidence format and local mechanics but does not replace the required API-backed run.

## Architecture map

- `src/core/schema.ts` - capability and result contracts
- `src/core/discovery.ts` - bounded model-driven discovery loop
- `src/core/model-adapter.ts` - live OpenAI and scripted test adapters
- `src/core/discovery-schema.ts` - strict API envelope and validated internal decision union
- `src/core/artifact-compiler.ts` - transcript-to-capability compilation
- `src/core/capability-profile.ts` - reviewed completion, outcome, recovery, and intervention contract
- `src/core/replay.ts` - deterministic execution, outcomes, recovery, and checkpoints
- `src/core/playwright-surface.ts` - surface observation and actions
- `src/core/policy.ts` - action, origin, and risk enforcement
- `src/core/evidence.ts` - redacted evidence bundles
- `src/core/session-registry.ts` - retained live browser sessions
- `src/core/handoff.ts` - intervention and control-lease state
- `src/core/operator-server.ts` - minimal same-session operator console
- `test/integration.test.ts` - complete browser-level vertical-slice checks

## Learned versus configured

The LLM learns the ordered navigation, fill, click, and extraction targets. The reviewed `lookupBalanceProfile` supplies the required identity-equality checkpoint, detail visibility, output definition, `member_not_found` detector, service-notice recovery, and session-expiry intervention. Discovery accepts a business outcome only when the model's assertion and the same-code reviewed detector both match the live page; the reviewed message is returned. Model-proposed checkpoints and error detectors cannot replace this reviewed runtime contract.

## Evidence policy

Ad-hoc evidence under `evidence/runs/` and generated artifacts are ignored by default. The deliberately reviewed submission bundle is tracked under [`evidence/submission/`](evidence/submission/), containing:

1. The genuine discovery evidence and resulting artifact, including provider response IDs and `createdFromLiveRun: true`.
2. A model-disabled deterministic replay of that exact artifact for a distinct valid member.
3. A `member_not_found` replay.
4. A delayed-response replay proving bounded waiting.
5. A same-session handoff run showing pause, a recorded human action, return of control, and successful resume.
6. A separately indexed post-hardening live discovery and exact-artifact replay retained as supplemental independent verification.

Its index records the artifact SHA-256, redacted reproduction commands, run IDs, outcome codes, and review status. To regenerate the bundle, repeat the commands above, inspect every generated file, and copy only the reviewed runs rather than committing `evidence/runs/` wholesale.

DOM observations include rendered text and semantic controls, not raw HTML. Extraction candidates come first from `data-automation-field`; the legacy fallback admits visible table cells, definition values, and output elements only when they have a stable ID and a nearby semantic label. Their values are always redacted. Unlabeled or selector-unstable legacy fields require human review instead of guessed extraction.

The complete model context—target URL, observation, prior decisions, rationales, alerts, and controls—passes through the persistence redactor. It removes declared runtime values, URL credentials/query/fragment values, tagged extraction values, common email/SSN/currency patterns, and typed human text. Generated artifacts reject URL state and any text the same redactor would change. This is defense in depth, not universal PII detection; fictional data remains mandatory. Failure evidence is sanitized JSON rather than a screenshot, and operator screenshots are live transport only.

Do not commit `.env`, API keys, browser storage state, raw sensitive invocation data, or unreviewed live screenshots.
