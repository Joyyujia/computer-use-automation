# Architecture

The system is a single TypeScript process around a narrow `Surface` boundary. Playwright is the first adapter because it gives a real, inspectable browser session, while the artifact records semantic controls rather than Playwright calls. Discovery and replay share observation/action primitives but not decision logic: an LLM chooses actions only during discovery; replay interprets a frozen artifact. A local legacy-style member console keeps the demo ethical and reproducible.

The current scaffold implements the replay-side boundary, evidence writer, policy enforcement, and control-transfer state machine. It intentionally does not claim a model run occurred. The next implementation increment adds the model adapter and promotes a discovered artifact only after checkpoint validation.

# Artifact schema

Each capability has an immutable schema version plus an independently evolving semantic version, a caller-facing name/description, typed inputs and outputs, surface compatibility metadata, ordered typed steps, and a final checkpoint. Values distinguish literals from invocation inputs so runtime data never needs to be baked into a recording. Locators contain a primary strategy, bounded fallbacks, optional frame paths, and a human-readable robustness rationale.

Capabilities begin as `draft`. Approval is separate from successful discovery, leaving room for review and later replay-confidence gates. `appFamily` is the reusable identity; `tenantVariant` can select a narrow override without forking the entire flow.

# Determinism & error handling

Replay validates the whole artifact before opening a browser, substitutes typed invocation values, checks every action against policy, retries only the same recorded action a bounded number of times, and verifies a recorded checkpoint. It never asks a model what to do. Locator preference is semantic role/label first, scoped structural selector second, and coordinates only as an explicit last resort.

The result union separates success, expected business outcomes, and failures. Failures carry category, step, observation context, recoverability, and an evidence path. The scaffold implements structured failures and screenshots; recognizing the demo's “member not found” state as a `business_outcome`, known-dialog recovery, and session expiry are the next replay increment.

# Heterogeneity & multi-tenant

The recorded verbs operate through a surface adapter. A desktop adapter could implement the same locate/click/fill/extract concepts using an accessibility tree and screenshot coordinates without changing the caller contract. Frame paths and fallback locators cover hostile web surfaces without making DOM details the top-level abstraction.

Artifacts should be stored once per vendor app family and version range. Tenant overlays may replace entrypoints, labels, and a bounded locator map, but not silently alter action meaning or risk. Replay telemetry should cluster failures by app version and tenant; repeated checkpoint or locator failures quarantine the affected compatibility range rather than triggering open-ended model recovery.

# Escalation & handoff

`HandoffCoordinator` models control as a single-owner lease. Automation requests intervention with run, step, reason, and evidence; a human explicitly takes the same session, records manual actions, and returns the lease before replay continues. This prevents concurrent input and preserves an audit trail. The remaining work is a small authenticated operator route that exposes the existing browser session and persists intervention state rather than keeping it in memory.

# Safety

Every step is checked against configurable origin and action allowlists. Irreversible actions are blocked or require confirmation; confirmation is scoped to a step ID rather than the whole run. Evidence is structured and recursively redacted for secret and high-risk identity keys, and artifacts refer to parameters instead of recording supplied values. Production would add schema-driven redaction, encrypted short-lived evidence, tenant isolation, authenticated approvals, and stricter output classification.

# Cuts

The scaffold deliberately omits the real LLM discovery adapter, live operator console, durable session registry, and committed run evidence. Those are visible omissions rather than mocks: the discovery command exits without manufacturing an artifact or log. Next, implement one genuine tool-structured model loop, save its transcript-derived artifact only after validation, add not-found as a business outcome, and demonstrate pause/take-control/resume on the same Playwright context. Desktop support and scaling infrastructure remain design-only.
