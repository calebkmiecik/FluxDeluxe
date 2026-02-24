# FluxDeluxe UI & Architecture Roadmap

Improvement ideas for responsiveness, reliability, and overall feel.
Organized by priority tier — Tier 1 items deliver the biggest impact for least effort.

---

## Tier 1 — Transformative (Do First)

### A. Frame Accumulator + 60fps Paint Timer
**Problem:** Live data arrives at 100Hz+ and every frame triggers processing + canvas repaints on the main thread. UI events (clicks, scrolls, transitions) queue behind frame processing.
**Solution:** Data goes into a thread-safe ring buffer. A 16ms QTimer on the main thread pulls the latest state and repaints once per tick. Completely decouples data acquisition from rendering.
**Files:** `fluxlite_page.py:_on_live_data()`, canvas widgets

### B. Command Acknowledgment Protocol
**Problem:** Commands (tare, start/stop capture) are fire-and-forget over Socket.IO. No confirmation the backend received them, no timeout, no retry. Users can't tell if an action worked.
**Solution:** Every command gets a unique ID. Backend responds with `{command_id, status, message}`. Frontend shows a spinner until ACK, error toast on timeout (2s), auto-retry once.
**Files:** `io_client.py`, `hardware.py`, DynamoPy event handlers

### C. Connection State Machine with Visual Feedback
**Problem:** Backend readiness is detected by checking if the subprocess exists — but the socket may not be listening yet. Users see a blank screen and wonder "is it working?"
**Solution:** Explicit startup stages with UI feedback:
`LAUNCHING → BACKEND_STARTING → SOCKET_CONNECTING → DISCOVERING_DEVICES → READY`
Show each stage in the status bar or a startup overlay.
**Files:** `main_window.py`, `hardware.py:_auto_connect_thread()`

### D. Backend Heartbeat + Auto-Recovery
**Problem:** If the backend hangs (not crashed, just stuck), the frontend has no way to detect it. If it crashes, the user has to manually restart the app.
**Solution:** Backend sends a heartbeat event every 2s. If 3 are missed, show "Backend Unresponsive" and auto-restart. On crash detection (process exit), restart within 2s, reconnect socket, show brief "Backend restarted" toast.
**Files:** `main.py:_start_dynamo_backend()`, DynamoPy main loop, `hardware.py`

---

## Tier 2 — High Value, Moderate Effort

### E. Toast/Snackbar Notification System
**Problem:** Status updates are scattered across various status bars and labels. Easy to miss, inconsistent.
**Solution:** Unified toast system (bottom-right popups): "Device connected", "Capture saved", "Upload complete", "Tare failed — retrying". Auto-dismiss after 3-5s, with optional action buttons.
**Files:** New `ui/widgets/toast_manager.py`, integrated into `main_window.py`

### F. Offload Frame Processing to Worker Thread
**Problem:** Force calculations, COP computation, temperature tracking all run on the main thread inside `_on_live_data()`.
**Solution:** Dedicated QThread for data processing. Socket data → worker thread (compute) → emit final values → main thread (display only). Main thread never does math.
**Files:** `fluxlite_page.py`, new `workers/data_pipeline_worker.py`

### G. Optimistic UI with Rollback
**Problem:** Actions feel slow because the UI waits for backend response before updating.
**Solution:** Immediately update UI on action (e.g. show "Taring..." on click). If ACK arrives within 2s, show success. If timeout, rollback and show error. Makes the app feel instant.
**Files:** `fluxlite_page.py`, control panel handlers

### H. Timer-Based Periodic Checks
**Problem:** Periodic tare checks and device-decay tracking run per-frame (~100x/sec). Redundant computation.
**Solution:** Move to QTimers at 1-2Hz. Free performance win.
**Files:** `fluxlite_page.py:_on_live_data()`, `hardware.py` device decay

### I. Connection Quality Indicator
**Problem:** Users can't tell if the connection is healthy, degraded, or down.
**Solution:** Small dot in the status bar — green (healthy), yellow (high latency / dropped frames), red (disconnected). Based on heartbeat latency and frame arrival rate.
**Files:** `main_window.py` status bar, `hardware.py`

---

## Tier 3 — Polish That Elevates the Feel

### J. Auto-Reconnect with Persistent UI State
**Problem:** On disconnect, the UI clears and goes blank. User loses context.
**Solution:** Keep last data visible with a subtle "Reconnecting..." overlay. Resume seamlessly when reconnected. Like Slack/Discord disconnection handling.
**Files:** `hardware.py:_on_disconnect()`, canvas widgets

### K. Loading Skeletons
**Problem:** Switching tabs or loading test lists shows blank space or frozen UI.
**Solution:** Animated skeleton placeholders (grey pulsing rectangles) that signal "loading" without feeling broken.
**Files:** New `ui/widgets/skeleton.py`, panel switching logic

### L. Subtle Animated Transitions
**Problem:** Panel switches, section expansions, and dialog appearances are instant/jarring.
**Solution:** 150ms fade/slide using QPropertyAnimation. The difference between "smooth app" and "broken app" is often just an animation.
**Files:** `main_window.py` panel switching, dialog show/hide

### M. Debounced Inputs
**Problem:** Text fields that trigger searches or filters can freeze the UI if they fire on every keystroke.
**Solution:** 300ms debounce timer — only fire the action after the user stops typing.
**Files:** Any filter/search text fields in temperature testing, model management

### N. Undo Toasts Instead of Confirmation Dialogs
**Problem:** "Are you sure?" dialogs interrupt flow and feel clunky.
**Solution:** 5-second undo toasts: "Capture deleted. [Undo]". Faster, less interruptive, more modern. Depends on Toast system (E).
**Files:** Destructive action handlers throughout the app

### O. Offline-First Everything
**Problem:** Cloud operations (Supabase, Firebase) can block or fail, making the app feel unreliable.
**Solution:** All operations save locally first, sync in background. App never blocks on network. Background sync (already implemented) is the foundation — extend it to all cloud operations.
**Files:** `supabase_temp_repo.py`, Firebase sync code

---

## Tier 4 — Architectural Bets (v2.0 Territory)

### P. Shared Memory for Live Data
Replace socket serialization with mmap between backend and frontend. Backend writes latest frame into shared memory, frontend reads at its own pace. Zero serialization cost. This is how LabVIEW and Dewesoft achieve ultra-low latency.

### Q. QML Hybrid for GPU-Accelerated Widgets
Keep the main app in Qt Widgets, but write new real-time visualization widgets (force plots, COP trails, live canvases) in QML. Embed via QQuickWidget. GPU-accelerated rendering at 60fps with declarative animations. Incrementally modernize the look without a full rewrite.

### R. Raw WebSocket Replacing Socket.IO
Socket.IO adds protocol overhead (handshake, polling fallback, event wrapping). A bare WebSocket + msgpack would be lower latency and simpler. Already using msgpack encoding — just drop the wrapper.

### S. Session Crash Recovery
If the app crashes during a live test, detect the interrupted session on restart. The backend may still be writing the CSV. Offer to recover and resume display.

### T. Plugin Architecture for Tools
Make FluxLite, Metrics Editor, etc. loadable plugins instead of hardcoded tabs. Each tool is a directory with a manifest. Easier to develop, test, and ship independently.
