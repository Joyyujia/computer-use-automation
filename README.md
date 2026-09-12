# Computer-Use Automation System

A focused vertical slice for turning one LLM-discovered UI run into a typed, reviewable capability and replaying it without a model in the decision loop.

## Status

The deterministic core, policy boundary, evidence writer, handoff state machine, local legacy-style target, and example artifact are scaffolded. The live LLM discovery adapter and operator UI are explicit next milestones; the `discover` command refuses to create synthetic evidence in their absence.

## Setup and run

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium
npm test
```

Terminal 1 starts the local proxy application:

```bash
npm run demo:app
```

Terminal 2 deterministically replays the checked-in draft capability:

```bash
npm run replay -- artifacts/lookup-balance.v1.json '{"memberId":"12345"}'
```

Run evidence is written beneath `evidence/runs/<run-id>/`. Inputs whose schema marks them sensitive are never intended for raw logging; key-based redaction provides defense in depth.

For live discovery, copy `.env.example` to `.env`, provide `OPENAI_API_KEY`, and run:

```bash
npm run discover -- "Look up member 12345 and read their savings balance"
```

Discovery is not implemented in this scaffold yet. The command fails loudly and writes no misleading evidence.

## Repository map

- `src/core/schema.ts`: versioned capability and structured result contracts
- `src/core/replay.ts`: model-free executor and failure evidence
- `src/core/playwright-surface.ts`: web surface adapter behind the replay boundary
- `src/core/policy.ts`: origin/action allowlists and irreversible-action policy
- `src/core/handoff.ts`: explicit single-owner control lease and audit trail
- `public/`: deliberately old-fashioned proxy application
- `artifacts/`: reviewable capabilities (draft until a real discovery run validates them)
- `evidence/`: committed demonstration evidence and ignored ad-hoc runs

## Demo path

The intended end-to-end demo is: start the proxy, run genuine model-driven discovery, review/approve its artifact, replay with a different `memberId`, then inject a not-found outcome and exercise live handoff. Today only the proxy and replay path are executable; see `REPORT.md` for the cut line.

No real credentials or PII should be used. The demo data is fictional.
