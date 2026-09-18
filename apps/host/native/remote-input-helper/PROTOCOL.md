# Doujiao Remote Input Helper Protocol (Win32 SendInput)

## Overview

The `doujiao-remote-input.exe` helper is a dedicated native Win32 process designed to safely execute keyboard and mouse operations via `SendInput`.

## Core Security Constraints

1. **Inherited Stdin Only**: The process listens on standard input (`stdin`) and writes responses/events to standard output (`stdout`). It never creates or binds to network sockets or named pipes.
2. **Session Token Validation**: An initial `hello` handshake establishes an ephemeral 256-bit session token. Every subsequent message must present this token. Messages with missing or incorrect tokens are discarded.
3. **Local Mouse Override**: If physical mouse movement by the local user is detected, remote input is suppressed for a 1500 ms safety window to guarantee local authority.
4. **Guaranteed Release-All**: All held keys and mouse buttons are tracked. When the pipe closes, EOF is encountered, or parent terminates, all held keys and buttons are automatically released.

## Message Format

All messages are single-line JSON objects terminated by `\n`.

### Host -> Helper

- `hello`:
  `{"type":"hello","token":"<session-token>"}`
- `pointer-move`:
  `{"type":"pointer-move","token":"...","x":0.5,"y":0.5}`
- `pointer-button`:
  `{"type":"pointer-button","token":"...","button":"left"|"middle"|"right","pressed":true|false}`
- `wheel`:
  `{"type":"wheel","token":"...","deltaX":0,"deltaY":120}`
- `key`:
  `{"type":"key","token":"...","code":"KeyA","pressed":true|false,"modifiers":[]}`
- `hide-cursor`:
  `{"type":"hide-cursor","token":"...","hidden":true|false}`
- `release-all`:
  `{"type":"release-all","token":"..."}`
- `shutdown`:
  `{"type":"shutdown","token":"..."}`

### Helper -> Host

- `ack`:
  `{"type":"ack","op":"hello"|"pointer-move"|...,"success":true}`
- `local-override`:
  `{"type":"local-override","durationMs":1500}`
- `error`:
  `{"type":"error","message":"..."}`
