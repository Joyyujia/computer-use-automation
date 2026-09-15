# Architecture

The system is a single TypeScript process with explicit boundaries for orchestration, model decisions, surface control, policy, evidence, replay, and handoff. A run orchestrator owns the browser session rather than either discovery or replay; this makes pausing and transferring the exact same session possible. Playwright is the first surface adapter because it gives a real application surface and observable accessibility semantics, while the artifact remains independent of Playwright types.

Discovery is a bounded observe -> decide -> policy-check -> act loop. The OpenAI adapter requests one strict JSON-schema decision per iteration and disables response storage. A scripted adapter exists only for repeatable tests and marks compiled provenance as non-live. Replay is a separate code path that never calls a model. The single-process choice keeps this vertical slice inspectable; the session registry and evidence interfaces are seams for durable services later.

# Artifact schema

A capability is an agent-callable contract, not a raw transcript. It declares a schema version, semantic version, stable ID, typed inputs and outputs, app-family compatibility, ordered typed steps, locator rationales and fallbacks, risk levels, timeouts, retries, business-outcome detectors, bounded recovery rules, a final checkpoint, approval state, and discovery provenance.

The artifact compiler converts successful discovery decisions into parameter references. Runtime member data is represented as `{ source: "input", key: "memberId" }`, never embedded as a discovered literal. Artifacts start as `draft`; a successful model run does not automatically authorize unattended production use. Raw model decisions remain evidence while the normalized artifact becomes the reusable capability.

# Determinism & error handling

Replay validates the complete artifact and required inputs before acting. For each step it checks known business outcomes, applies only artifact-defined recoveries, enforces policy, resolves the recorded locator sequence, executes the fixed action, records evidence, and finally verifies the checkpoint. Retries repeat the same action; they do not ask a model to improvise.

The public result distinguishes `success`, `business_outcome`, `intervention_required`, and `failure`. Failure categories include policy denial, timeout, missing target, checkpoint failure, unexpected dialog/state, expired session, control conflict, and internal defects. The demo recognizes “Member not found” as a legitimate business outcome before the later balance locator can fail. Rich failure evidence includes the responsible step, structured events, and a screenshot.

# Heterogeneity & multi-tenant

The `PlaywrightSurface` implements observation, targeting, action, extraction, and assertion behind a surface boundary. A desktop accessibility adapter could implement the same concepts without changing the capability's caller contract. Locator order favors roles and labels, then visible text and scoped structural selectors, with coordinates reserved for an explicit last resort. Frame paths support hostile legacy layouts.

Artifacts are keyed by vendor app family rather than tenant. A production registry would attach supported version ranges and allow narrow tenant overlays for entrypoints, labels, and locator mappings while forbidding silent changes to behavior or risk. Failure telemetry should quarantine a failing tenant/version range and route it for review instead of launching open-ended recovery.

# Escalation & handoff

Automation and the operator share a retained Playwright browser context. An intervention contains run, session, step, reason, evidence, state, owner, and human action history. The operator explicitly takes a single-owner control lease; server endpoints reject input when the human does not hold it. The local console polls live screenshots, forwards coordinate clicks and keyboard input to the same page, records redacted action descriptions, and returns the lease before automation resumes.

This is a minimal but real handoff rather than a second browser or a TODO. Production additions would include authentication, encrypted transport, durable intervention state, streaming video, operator identity, lease expiry, and stronger keyboard/input controls.

# Safety

Discovery, replay, recovery, and resumed actions pass through the same configurable policy. It restricts origins and action types and classifies steps as safe, reversible, or irreversible. Irreversible steps are blocked or require approval scoped to the exact run step; an unhandled approval request returns `intervention_required`. Unknown actions and origins fail closed.

Sensitive fields are parameterized, observations sent to the model replace supplied input values with `[SUPPLIED]`, evidence is redacted before serialization, and the live API request uses `store: false`. The demo uses fictional data. Production would require schema-driven field classification, encrypted short-retention evidence, authenticated approvals, tenant isolation, and content-aware screenshot redaction.

# Cuts

The implementation intentionally omits production authentication, durable databases/queues, desktop automation, tenant overlay storage, automatic artifact approval, and unbounded LLM recovery. The operator console is local and intentionally bare. Screenshot redaction is not yet content-aware, so only fictional demo data should be used.

The remaining submission-time action is operational rather than architectural: provide an API key, run one genuine discovery, inspect its redacted bundle, and deliberately commit that evidence plus successful, not-found, and handoff runs. Fixture-driven tests cannot substitute for the assignment's required genuine discovery evidence.
