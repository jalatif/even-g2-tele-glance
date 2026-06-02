# Structural Invariants (Content-Agnostic)

These invariants are checked regardless of fixture/real-data mode. They validate the state machine, UI rendering, and bridge output without depending on specific chat names or message content.

## S1. State machine validity

```typescript
// Every state must have valid properties for its screen
type StateInvariant = {
  screen: string
  valid: (state: AppState) => boolean
}
```

| Screen | Invariant |
|--------|-----------|
| `loading` | `message` non-empty |
| `auth` | `mode` is one of `needsSetup`, `signedOut`, `phonePending` |
| `sidebar.chats` | `chats` array non-empty, `selectedChatIndex` in range |
| `sidebar.topics` | `chat` defined, `topics` non-empty, `selectedTopicIndex` in range |
| `sidebar.messages` | `chat` defined, `messages` is array, `scrollOffset >= 0` |
| `sidebarRecording` | `chunks` is array, `startedAt > 0`, `focus === 'messages'` |
| `sidebarTranscribing` | `focus === 'messages'` |
| `sidebarConfirm` | `transcript` non-empty, `selectedIndex` is 0 or 1 |
| `sidebarSending` | `transcript` non-empty, `focus === 'messages'` |
| `sidebarSent` | `focus === 'messages'` |
| `asleep` | `chats` non-empty, `selectedChatIndex` in range |
| `newMessage` | `chat` defined, `message` non-empty |
| `error` | `message` non-empty |

## S2. State transition validity

Only valid transitions are allowed:

```
loading → {auth, sidebar.chats, error}
auth → {sidebar.chats, error}
sidebar.chats → {sidebar.topics, sidebar.messages, asleep, error}
sidebar.topics → {sidebar.messages, sidebar.chats, asleep, error}
sidebar.messages → {sidebarRecording, sidebarTranscribing, sidebarConfirm, sidebarSending, sidebarSent, sidebar.chats, asleep, error}
sidebarRecording → {sidebarTranscribing, sidebar.messages, error}
sidebarTranscribing → {sidebarConfirm, sidebar.messages, error}
sidebarConfirm → {sidebarSending, sidebar.messages, error}
sidebarSending → {sidebarSent, error}
sidebarSent → {sidebar.messages, sidebar.chats, error}
asleep → {sidebar.chats, asleep, error}
newMessage → {sidebar.messages, asleep, error}
error → {any screen}
```

**Catch-all invariant**: No transition leads to a screen whose `focus` doesn't match the screen (e.g., `sidebar` + `undefined focus` is invalid).

## S3. UI rendering invariants

### Every `screenModel(state)` call produces valid output:

```
kind === 'text' or kind === 'sidebar'
title UTF-8 bytes <= 120
body (if present) UTF-8 bytes <= 999
sidebarTitle (if present) non-empty
sidebarItems (if present) length 1..20
sidebarSelected (if present) in range of sidebarItems
panelBody (if present) UTF-8 bytes <= 999
panelBox (if present): heading non-empty, content non-empty
panelFooter (if present) UTF-8 bytes <= 120
focus (if 'sidebar' kind) === 'sidebar' or 'panel'
```

### Every bridge `Container` output is valid:

```
containerTotalNum === textObject.length + listObject.length + imageObject.length
containerID values are unique across ALL arrays (text, list, image)
textObject.length <= 8 (firmware max)
listObject.length === 1
Each TextContainerProperty has containerID in 0..9
When kind === 'sidebar' && focus === 'sidebar':
  - listObject[0].isEventCapture === 1
  - listObject[0].containerID === 8
When kind === 'sidebar' && focus === 'panel':
  - listObject[0].containerID === 8
  - listObject[0].isEventCapture === 0 (hidden)
  - textObject contains containerID 5 (sidebar text)
```

## S4. Performance invariants (budget-agnostic)

```
After any input event, at minimum the state dispatcher returns within 50ms
  (no blocking synchronous work allowed)
After state change, a render either fires OR explicit setStateWithoutRender was used
Render events should not arrive more than 3s after the triggering state change
```

## S5. Input coalescer invariants

```
A 'press' event must be followed by at most one matching press or doublePress within 220ms
A 'doublePress' must not be followed by a 'press' within 140ms
A 'swipeUp' must not be followed by another 'swipeUp' within 220ms
A 'swipeDown' must not be followed by another 'swipeDown' within 220ms
```

## S6. Timed-state invariants

```
Any 'longRunningStates' (sidebarTranscribing, sidebarSending) must auto-advance
  to the next state within 60s
No state with status containing 'Loading' should persist for more than 60s
  (handles both timeout and real slow backend)
```
