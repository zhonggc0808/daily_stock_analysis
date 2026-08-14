# RFC: Chat Token/Delta Streaming Protocol

- **Status**: Proposed
- **Author**: DSA Frontend & Architecture Team
- **Date**: 2026-08-14
- **Target Area**: `apps/dsa-web` & `api/v1/agent/chat`

---

## 1. Context & Problem Statement

Currently, `POST /api/v1/agent/chat/stream` streams stage progress events (`stage_start`, `tool_start`, `tool_done`, `generating`) via SSE (`text/event-stream`), but the response text is delivered primarily as a single monolithic `content` string inside the final `done` event.

For long analytical responses (e.g., full multi-factor report, wave theory analysis), users experience a noticeable delay between the `generating` stage and the instant appearance of 1,000+ characters.

This RFC specifies a standard, fault-tolerant **Token/Delta Streaming Protocol** enabling real-time incremental rendering in DSA Web while maintaining 100% backward compatibility with legacy endpoints.

---

## 2. Event Specification

### 2.1 Delta Event (`type: "delta"`)

During the generation phase, the backend emits incremental text chunks as SSE data payloads:

```json
{
  "type": "delta",
  "message_id": "msg_01J6A8Z7KQ5...",
  "session_id": "sess_default_01",
  "seq": 14,
  "delta": "由于近期白酒板块",
  "accumulated_length": 182,
  "meta": {
    "model": "deepseek-r1",
    "finish_reason": null
  }
}
```

#### Field Definitions:
- `type` (`string`, required): Literal `"delta"`.
- `message_id` (`string`, required): Unique identifier for the assistant message being generated.
- `session_id` (`string`, required): Active chat session identifier.
- `seq` (`number`, required): Monotonically increasing sequence number starting from `0`.
- `delta` (`string`, required): Incremental text chunk generated in this step.
- `accumulated_length` (`number`, optional): Total UTF-8 character length generated so far (for checksum and missed chunk detection).
- `meta` (`object`, optional): Associated model metadata and intermediate completion signals.

### 2.2 Completion Event (`type: "done"`)

The existing `done` event remains the definitive end-of-stream signal:

```json
{
  "type": "done",
  "success": true,
  "message_id": "msg_01J6A8Z7KQ5...",
  "session_id": "sess_default_01",
  "total_seq": 48,
  "content": "完整回复全文...",
  "total_steps": 6,
  "duration_ms": 3420
}
```

---

## 3. Frontend Ingestion & Reassembly Rules

```
                       ┌─────────────────────────┐
                       │  SSE Stream: data-line  │
                       └────────────┬────────────┘
                                    │
                            JSON.parse(data)
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
        type === "delta"                       type === "done"
                 │                                     │
    ┌────────────┴────────────┐            Reconcile full `content`
    │ Verify sequence: seq    │            Finalize loading state
    │ • seq === expected:     │
    │   append delta          │
    │ • seq > expected:       │
    │   buffer until gap filled│
    │ • seq < expected:       │
    │   ignore (duplicate)    │
    └────────────┬────────────┘
                 ▼
     RAF-throttled React state
                 ▼
     Render Incremental Markdown
```

### 3.1 Ordering and Gap Detection
- The client maintains `expectedSeq` (initially `0`).
- If `event.seq === expectedSeq`:
  - `accumulatedContent += event.delta`
  - `expectedSeq++`
  - Flush any buffered sequential deltas.
- If `event.seq > expectedSeq`:
  - Store event in `deltaBuffer` map keyed by `seq`.
  - If buffer wait exceeds 1,500ms, request stream reconciliation or fallback to final `done.content`.

### 3.2 Smooth Markdown Rendering
- Delta stream updates are batched using `requestAnimationFrame` (or 16ms/33ms micro-debounce) to avoid excessive React commit cycles during rapid token bursts.
- Incomplete markdown syntax (such as unclosed code blocks ` ``` `, bold tags `**`, or table rows) is handled gracefully by `react-markdown` and `remark-gfm` AST recovery.

---

## 4. Reconnection & Resumability

If the HTTP connection drops mid-generation:
1. Client reconnects with headers or query params:
   `GET /api/v1/agent/chat/stream?session_id=...&resume_message_id=...&since_seq=14`
2. Server checks session cache:
   - If stream still in flight / cached: replays deltas where `seq > since_seq`.
   - If stream completed: immediately emits `done` with full `content`.
   - If expired: emits `error` with `code: "STREAM_EXPIRED"`, prompting fresh retry.

---

## 5. Backward Compatibility Guarantee

1. **Existing Clients**: Legacy clients ignoring `type: "delta"` continue relying on `type: "done"`'s `content` field.
2. **Existing Backends**: If the server emits only `type: "generating"` followed by `type: "done"`, DSA Web falls back automatically to full-content rendering without UI breakage.
