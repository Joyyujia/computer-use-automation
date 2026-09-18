# Evidence

Generated run evidence belongs here. Ad-hoc runs under `runs/` are ignored until deliberately reviewed and committed.

Reviewed, redacted mechanics fixtures are tracked under `samples/`. Their index explicitly classifies them as non-live and points to scripted discovery, fresh artifact validation, a second-member replay, a not-found outcome, and a same-session handoff. Regenerate them with `npm run evidence:samples`.

Reviewed final evidence is tracked under `submission/`. Its canonical index links the genuine LLM-driven discovery, exact generated artifact, deterministic replay for a distinct valid member, delayed replay, explicit not-found outcome, and same-session handoff. A nested supplemental index records the post-hardening independent live discovery and model-disabled replay without replacing the canonical bundle. Do not place invented discovery logs here or commit `runs/` wholesale.
