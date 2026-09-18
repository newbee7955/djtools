# Remote Assist Direct P2P Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make remote assistance prefer a genuine P2P path, fall back to TURN through a standards-compliant ICE restart, and emit diagnostics that accurately explain the selected path and failed checks.

**Architecture:** Keep the existing signaling envelope and carry an ICE generation plus negotiation phase inside the existing offer, answer, and ice-candidate payloads. The controlling peer starts with STUN-only configuration, measures the direct-attempt timeout from ICE `checking`, and performs one coordinated ICE restart after enabling the full TURN configuration. Candidate collection is tracked from events, while the selected path is resolved from the WebRTC transport's `selectedCandidatePairId`.

**Tech Stack:** Electron 33, TypeScript, browser WebRTC APIs, Node.js `node:test`, UDP/STUN probing.

## Global Constraints

- Preserve the existing signaling protocol version and message type allowlist.
- Preserve the user's untracked `services/remote-assist-signal.zip` and all unrelated worktree changes.
- Do not commit or push during this execution.
- Use test-first changes for each behavioral fix.
- Treat TURN reachability probing as endpoint evidence only; final relay usability is determined by ICE.
- Keep a diagnostic-only direct mode available through `DOUJIAO_REMOTE_ICE_MODE=direct-only`.

---

### Task 1: Harden STUN probing and remove duplicate ICE URLs

**Files:**
- Modify: `apps/host/tests/remote-assist-ice-probe.test.mjs`
- Modify: `apps/host/src/main/services/remote-assist/ice-probe.ts`
- Modify: `services/remote-assist-signal/src/turn-credentials.ts`
- Modify: `services/remote-assist-signal/tests/signal-server.test.mjs`

- [x] Add a test proving an arbitrary UDP reply is not accepted as a STUN success response.
- [x] Add a test proving a binding-success response with the matching transaction ID is accepted.
- [x] Add a test proving ICE server construction de-duplicates URLs already present in TURN credentials.
- [x] Run the focused tests and confirm the new assertions fail for the expected reasons.
- [x] Validate STUN message type, magic cookie, declared length, and transaction ID before marking the endpoint reachable.
- [x] Remove the bundled `stun:` URL from newly generated TURN credentials.
- [x] De-duplicate ICE URLs defensively in `buildIceServers` while retaining credentials on TURN entries.
- [x] Re-run the focused tests and confirm they pass.

### Task 2: Add direct-first negotiation and coordinated TURN fallback

**Files:**
- Modify: `apps/host/tests/remote-assist-session-window.test.mjs`
- Modify: `apps/host/src/main/container/remote-assist-session-window.ts`

- [x] Replace the obsolete test that requires TURN from the first offer with tests for STUN-only initial configuration.
- [x] Add assertions that only the controlling peer starts the fallback timer when ICE enters `checking`.
- [x] Add assertions that fallback calls `setConfiguration` with all ICE servers, starts a new ICE generation, and creates an ICE-restart offer.
- [x] Add assertions that `direct-only` mode never enables TURN.
- [x] Run the session-window tests and confirm they fail for the old implementation.
- [x] Partition configured ICE servers into direct and full sets without misclassifying credential-free TURN URLs.
- [x] Create the peer connection with the direct set and start the timeout from `checking`.
- [x] Let only the controller perform a single TURN fallback and ICE restart.
- [x] On the controlled peer, apply the full configuration before accepting a fallback offer.
- [x] Keep connection status wording neutral until the selected candidate pair is known.
- [x] Re-run the focused tests and confirm they pass.

### Task 3: Isolate trickle candidates by ICE generation

**Files:**
- Modify: `apps/host/tests/remote-assist-session-window.test.mjs`
- Modify: `apps/host/src/main/container/remote-assist-session-window.ts`

- [x] Add tests requiring `iceGeneration` and `icePhase` on offer, answer, and candidate payloads.
- [x] Add tests requiring explicit end-of-candidates signaling and `addIceCandidate(null)` handling.
- [x] Add tests requiring stale-generation candidates to be ignored and future-generation candidates to be queued.
- [x] Run the focused test and confirm the new assertions fail.
- [x] Track the active ICE generation and negotiation phase in the renderer.
- [x] Queue candidates by generation until the corresponding remote description is installed.
- [x] Discard stale candidates and flush only the active generation.
- [x] Signal and consume end-of-candidates explicitly.
- [x] Re-run the focused tests and confirm they pass.

### Task 4: Make ICE diagnostics reflect gathered candidates and the selected transport

**Files:**
- Modify: `apps/host/tests/remote-assist-session-window.test.mjs`
- Modify: `apps/host/src/main/container/remote-assist-session-window.ts`

- [x] Replace the invalid `srflx<->srflx` requirement with host-to-srflx/prflx connectivity checks.
- [x] Add tests requiring local candidate types to be recorded from `onicecandidate` and remote types from received candidate messages.
- [x] Add tests requiring selection through `transport.selectedCandidatePairId`, with a conservative compatibility fallback.
- [x] Add tests requiring ICE error address and port details in diagnostics.
- [x] Run the focused test and confirm the new assertions fail.
- [x] Parse and record candidate metadata even when browser candidate convenience fields are absent.
- [x] Merge event-observed candidate inventory with `getStats()` inventory for reporting.
- [x] Resolve the active candidate pair through the transport report before considering nominated/succeeded fallbacks.
- [x] Emit conclusions that distinguish missing mappings, unresponsive direct checks, unsuccessful direct checks, and relay fallback.
- [x] Re-run the focused tests and confirm they pass.

### Task 5: Document and verify the recovery path

**Files:**
- Modify: `docs/remote-assistance-security.md`
- Verify: all remote-assist tests and host build/typecheck

- [x] Document direct-first behavior, timeout origin, ICE restart fallback, and `DOUJIAO_REMOTE_ICE_MODE=direct-only` diagnostics.
- [x] Run all focused remote-assist tests.
- [x] Run the broader remote-assist test set.
- [x] Run host TypeScript checks and the host production build. The production build passes; the standalone host typecheck remains blocked by pre-existing `.ts` import configuration and screen-recording errors.
- [x] Inspect `git diff --check`, changed-file scope, and final worktree status.
- [x] Record environmental limitations: a correct implementation cannot force direct UDP through a peer network that blocks hole punching.

## Verification Notes

- Relevant host, plugin, and signaling tests: 168 passed, 0 failed with `--test-concurrency=1`.
- Signaling service TypeScript check: passed.
- Host production build: passed.
- Host standalone typecheck: blocked by existing TS5097 imports and existing screen-recording type errors outside this change.
- Live two-network NAT traversal was not available in this workspace; the implementation and diagnostics are verified, but actual direct-path success still depends on both endpoint networks.
