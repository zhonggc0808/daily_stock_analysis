# RFC: Chat History Cursor Pagination Protocol

- **Status**: Proposed
- **Author**: DSA Frontend & Architecture Team
- **Date**: 2026-08-14
- **Target Area**: `apps/dsa-web` & `api/v1/agent/chat/sessions`

---

## 1. Context & Motivation

As users conduct extensive research sessions, chat histories grow to hundreds of message exchanges containing dense markdown reports, market data snapshots, and factor scores.

Currently, `GET /api/v1/agent/chat/sessions/{session_id}` returns the entire message history in a single response. For long-running conversations, this leads to:
- Excessive initial payload size (500KB - 2MB JSON).
- Extended DOM mount times and increased initial JS Heap memory.
- Lack of standard pagination boundary for infinite scrolling.

This RFC outlines a backward-compatible **Cursor-based Pagination Protocol** (`before_id` / `limit`).

---

## 2. API Contract Specification

### 2.1 Request Parameters

`GET /api/v1/agent/chat/sessions/{session_id}/messages`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `before_id` | `string` | `null` | Return messages created strictly before this message ID (for scrolling up into history). |
| `after_id` | `string` | `null` | Return messages created strictly after this message ID (for forward sync). |
| `limit` | `integer` | `20` | Maximum number of messages to return (min `1`, max `100`, default `20`). |
| `direction` | `string` | `"backward"` | Pagination direction: `"backward"` (newest-to-oldest) or `"forward"`. |

### 2.2 Response Envelope

```json
{
  "success": true,
  "session_id": "sess_default_01",
  "messages": [
    {
      "id": "msg_01J6A8Z7KQ5",
      "role": "user",
      "content": "分析比亚迪 002594",
      "timestamp": 1723628400000,
      "metadata": {}
    },
    {
      "id": "msg_01J6A8Z9MN2",
      "role": "assistant",
      "content": "比亚迪近期在新能源出海和高端化布局方面...",
      "timestamp": 1723628405000,
      "skill": "bull_trend",
      "backend": "default"
    }
  ],
  "pagination": {
    "has_more": true,
    "limit": 20,
    "next_cursor": "msg_01J6A8Z7KQ5",
    "prev_cursor": "msg_01J6A8Z9MN2",
    "total_count": 84
  }
}
```

#### Field Definitions:
- `messages` (`Array<Message>`): Paginated message list, chronological order (oldest first within the returned window).
- `pagination.has_more` (`boolean`): Indicates if older messages exist prior to `next_cursor`.
- `pagination.next_cursor` (`string | null`): Cursor ID to pass as `before_id` to retrieve the next older page.
- `pagination.prev_cursor` (`string | null`): Cursor ID to pass as `after_id` to retrieve newer messages.
- `pagination.total_count` (`number`, optional): Total messages count in the session.

---

## 3. Client Implementation Guidelines

```
                         ┌─────────────────────────┐
                         │ User scrolls near top   │
                         │ (scrollTop < 80px)      │
                         └────────────┬────────────┘
                                      │
                         Check `has_more` && !`isLoadingMore`
                                      │
                         Record current `scrollHeight` & `scrollTop`
                                      │
                         Fetch `before_id = oldestMessage.id`
                                      │
                         Prepend older messages to Zustand store
                                      │
                         Adjust viewport scroll position:
                         `el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop`
```

### 3.1 Scroll Position Preservation (Anchor Stability)
When older messages are prepended to the top of the container, the browser's default behavior would push existing messages downward, causing a jarring visual jump.

DSA Web will use `useLayoutEffect` to calculate:
$$\Delta H = \text{scrollHeight}_{\text{new}} - \text{scrollHeight}_{\text{prev}}$$
and update $\text{scrollTop} \leftarrow \text{scrollTop}_{\text{prev}} + \Delta H$, keeping the user's viewport perfectly stationary.

---

## 4. Migration & Compatibility Strategy

1. **Phase 1 (Non-breaking additive)**: Server adds `GET /api/v1/agent/chat/sessions/{session_id}/messages` supporting pagination while maintaining `GET /api/v1/agent/chat/sessions/{session_id}`.
2. **Phase 2 (Client adoption)**: DSA Web `agentChatStore` queries `/messages?limit=20` on session load and dynamically loads older batches when scrolling near the top.
3. **Phase 3 (Full deprecation)**: Full message history array in session metadata is truncated or replaced with session preview info only.
