# Architecture

The system is a single TypeScript process with explicit boundaries for orchestration, model decisions, surface control, policy, evidence, replay, and handoff. A run orchestrator owns the browser session rather than either discovery or replay; this makes pausing and transferring the exact same session possible. Playwright is the first surface adapter because it gives a real application surface and observable accessibility semantics, while the artifact remains independent of Playwright types.

Discovery is a bounded observe -> decide -> policy-check -> act loop. It enforces a step cap, overall deadline, model-call deadline, and repeated-state/action detection. The OpenAI adapter requests one strict JSON-schema decision per iteration, disables response storage, and records provider response IDs. A scripted adapter exists only for repeatable tests and cannot mark provenance live. Replay is a separate code path with no model dependency. The single-process choice keeps this vertical slice inspectable; the session registry and evidence interfaces are seams for durable services later.

# Artifact schema

A capability is an agent-callable contract, not a raw transcript. It declares a schema version, semantic version, stable ID, typed inputs and outputs, app-family compatibility, ordered typed steps, locator rationales and fallbacks, risk levels, timeouts, retries, business-outcome detectors, bounded recovery rules, a final checkpoint, approval state, and discovery provenance.

The artifact compiler converts successful discovery decisions into parameter references. Runtime member data is represented as `{ source: "input", key: "memberId" }`, never embedded as a discovered literal. Fallback locators must declare the same `logicalTarget`; ambiguous or hidden primaries stop instead of falling through. Runtime-text extraction locators are rejected. Artifacts start as `draft`; a successful model run does not automatically authorize unattended production use.

The learned portion is deliberately narrow: ordered navigation, fill, click, and extraction targets. The reviewed `lookupBalanceProfile` supplies the identity-equality checkpoint, detail visibility requirement, output type, `member_not_found` detector, bounded service-notice recovery, and session-expiry intervention. These additions are listed in provenance. A model-proposed generic heading cannot weaken the reviewed success contract.

# Determinism & error handling

Replay validates the complete artifact and required inputs before launching a browser. After submission it waits under one deadline for competing configured states: business outcome, intervention, recovery, or identity-matched success. It clears and rejects stale fixture state, verifies the displayed member ID equals the invocation, validates every declared output, and checks no contradictory outcome remains. Clicks and navigation are not blindly retried after uncertain effects; safe reads and waits may repeat within their bounded deadline.

The public result distinguishes `success`, `business_outcome`, `intervention_required`, and `failure`. Failure categories include policy denial, timeout, missing or ambiguous target, invalid output, checkpoint failure, unexpected dialog/state, expired session, and control conflict. Failures include run and step IDs, expected state where applicable, a sanitized observed-state summary, and an evidence path. “Member not found” is a stable business outcome rather than a technical exception.

# Heterogeneity & multi-tenant

The `PlaywrightSurface` implements observation, targeting, action, extraction, and assertion behind a surface boundary. Observations report actual semantic roles and associated labels; a bare HTML `name` is not represented as a label. Named frame paths are observed and can be replayed, with an integration test proving the same frame path resolves. Roles and labels are preferred, then scoped CSS; coordinates are treated as risky and require approval.

Artifacts are keyed by vendor app family rather than tenant. A production registry would attach supported version ranges and allow narrow tenant overlays for entrypoints, labels, and locator mappings while forbidding silent changes to behavior or risk. Failure telemetry should quarantine a failing tenant/version range and route it for review instead of launching open-ended recovery.

# Escalation & handoff

Automation and the operator share a retained Playwright browser context. An intervention contains run, session, capability/goal, step, reason, sanitized context, evidence, state, owner, and human action history. The operator explicitly takes a single-owner control lease; the execution boundary rejects automation while the human owns it. The local console polls live screenshots, forwards coordinate clicks and keyboard input to the same page, records redacted action descriptions, and supports resume or abort. On resume, replay verifies the configured blocking condition has cleared before continuing.

This is a minimal but real handoff rather than a second browser or a TODO. Production additions would include authentication, encrypted transport, durable intervention state, streaming video, operator identity, lease expiry, and stronger keyboard/input controls.

# Safety

Discovery, replay, recovery, and resumed actions pass through the same configurable policy. It restricts origins, routes, and actions; checks post-action redirects; closes and rejects unexpected popups; and safely classifies browser dialogs. Trusted target patterns and coordinate use can require approval even when a model or artifact says `safe`. Unknown actions and origins fail closed.

Sensitive fields are parameterized. DOM observation walks rendered text only, removes script/style content, masks `data-sensitive` regions and input values, sanitizes URL query values, and replaces declared sensitive values before model calls. Evidence applies the same value-aware redactor before every write; extraction values marked sensitive are returned to the caller but not logged. Generated artifacts are rejected if known invocation/output literals appear. Failure evidence is sanitized JSON, while operator screenshots are live and not persisted by the evidence subsystem. The synthetic leakage tests cover this declared surface, not universal PII discovery.

# Cuts

The implementation intentionally omits production authentication, durable databases/queues, desktop automation, durable tenant overlays, automatic artifact approval, and unbounded LLM recovery. The operator console is local and intentionally bare. Frame fallback for unnamed, unstable layouts is limited, and redaction relies on declared values plus fixture tagging rather than universal PII detection. Only fictional demo data should be used.

The remaining submission blocker is operational: this workspace currently has no `OPENAI_API_KEY`. Provide one, run genuine discovery, inspect the redacted bundle, replay that exact generated artifact for member `67890`, and deliberately commit the live artifact/evidence plus successful, not-found, and handoff evidence. Fixture-driven tests prove mechanics but cannot substitute for the required API-backed run.
