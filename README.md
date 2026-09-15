# Computer-Use Automation System

An end-to-end vertical slice that lets an LLM discover a UI workflow once, compiles that run into a typed capability, and replays the capability without a model in the decision loop.

The included target is a fictional legacy-style member-servicing application. Never use real credentials or PII.

## What is implemented

- Genuine OpenAI-powered observe -> decide -> act discovery with strict structured decisions
- Versioned, reviewable, parameterized capability artifacts
- Deterministic Playwright replay with bounded retries and checkpoints
- Structured success, business-outcome, intervention, and failure results
- Origin/action allowlists and step-scoped approval for irreversible actions
- Schema-aware parameterization and recursive evidence redaction
- Structured run manifests, JSONL events, observations, screenshots, and results
- Same-session human handoff with an explicit control lease and browser operator console
- Unit and browser integration tests for discovery, replay, not-found handling, and handoff

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
npm run discover -- "Look up member 12345 and read their savings balance"
```

Discovery writes a draft capability under `artifacts/generated/` and a redacted evidence bundle under `evidence/runs/<run-id>/`. It does not silently promote the artifact to approved.

Replay a reviewed artifact without any model call:

```bash
npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"12345"}'
```

Exercise the expected business outcome:

```bash
npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"99999"}'
```

The second invocation returns `status: "business_outcome"` and `code: "member_not_found"` rather than a technical failure.

## Human handoff demo

With the legacy application still running:

```bash
CUA_HEADLESS=false npm run handoff
```

Open `http://127.0.0.1:4174`, take control, click or type into the live browser, and return control. The console operates the same Playwright page held by the automation session. The control lease prevents human and automation input at the same time, and human actions are recorded with sensitive typed content redacted.

## Tests

```bash
npm run check
npm test
```

The integration suite opens loopback ports and launches Chromium. It uses a scripted model adapter solely for repeatability; fixture runs are explicitly marked `createdFromLiveRun: false` and are not represented as the assignment's genuine model evidence.

## Architecture map

- `src/core/schema.ts` - capability and result contracts
- `src/core/discovery.ts` - bounded model-driven discovery loop
- `src/core/model-adapter.ts` - live OpenAI and scripted test adapters
- `src/core/artifact-compiler.ts` - transcript-to-capability compilation
- `src/core/replay.ts` - deterministic execution, outcomes, recovery, and checkpoints
- `src/core/playwright-surface.ts` - surface observation and actions
- `src/core/policy.ts` - action, origin, and risk enforcement
- `src/core/evidence.ts` - redacted evidence bundles
- `src/core/session-registry.ts` - retained live browser sessions
- `src/core/handoff.ts` - intervention and control-lease state
- `src/core/operator-server.ts` - minimal same-session operator console
- `test/integration.test.ts` - complete browser-level vertical-slice checks

## Evidence policy

Ad-hoc evidence under `evidence/runs/` and generated artifacts are ignored by default. Before submission, perform a genuine API-backed discovery run, inspect its contents for sensitive data, then deliberately commit:

1. The genuine discovery evidence and resulting artifact.
2. A successful deterministic replay.
3. A `member_not_found` replay.
4. A handoff run showing pause, human actions, and resume.

Do not commit `.env`, API keys, browser storage state, or raw sensitive invocation data.
