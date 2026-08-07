# Spike result: rest alert reach

**Status:** one test outstanding — installed PWA (`standalone: true`)
**Device:** iPhone, iOS 18.7, Safari 26.5.2 (WebKit 605.1.15)
**Tested in:** Safari tab. **Every run so far logged `standalone: false`.**

## Question

Can a PWA sound an alert after the user switches apps or locks the phone, and
does doing so disturb their own audio?

The foreground tone was never in question. What is in question is whether any
mechanism survives backgrounding.

## What was tested

Two mechanisms, against the `navigator.audioSession.type` categories iOS exposes.

**Mode A — one-shot track.** A single pre-rendered WAV: 30 s of silence with the
beep baked in at the end, started inside the user gesture and left to play
through. Requires no JavaScript at fire time, which sidesteps timer suspension.

**Mode B — keepalive + JS-timed tone.** A looping silent track to hold the audio
session open, with `play()` called on a separate tone element from a timer.

## Results

| Mode | Category | Backgrounded behaviour |
| --- | --- | --- |
| A one-shot | `ambient` | Playback suspended. `currentTime` advanced 1.4 → 2.1 over 42 s away. Audio resumed on return to Safari. |
| A one-shot | `playback` | Interrupts other audio (video stopped). Beep-while-away not yet confirmed. |
| B keepalive + JS | `playback` | JS frozen. A 30 s timer fired at 81 s, in the same second the app was reopened. `TONE PLAY RESOLVED` but only on resume. |
| B keepalive + JS | `ambient` | Frozen. Rejected with `NotAllowedError` in the first run, which was a harness bug (the tone element was never unlocked by a gesture); after fixing, still frozen. |

`navigator.audioSession` **is** available and accepts both `ambient` and
`playback`, reporting the value back correctly.

## Findings

**iOS suspends both timers and audio playback in a backgrounded Safari tab,
regardless of audio session category.** The element continues to report
`paused=false` while frozen, so element state is not a reliable signal.

**The categories trade off exactly as specified, and neither wins.** `ambient`
mixes with the user's audio but is silenced when backgrounded. `playback`
survives in principle and does take over the audio session — it demonstrably
interrupts a playing video — but has not been shown to actually deliver a beep
while backgrounded.

**Two harness bugs were found and fixed before the results above were trusted:**

1. The tone element was never started by a user gesture, so `play()` was
   rejected with `NotAllowedError` regardless of backgrounding. iOS only permits
   programmatic `play()` on an element a gesture has already started.
2. Audio elements were constructed at page load, making it impossible to tell
   whether opening the page or running a test claimed the audio session.

Both were mistakes in the measurement, not platform behaviour. Neither
appears in the results table.

## Outstanding

Every run so far was a **Safari tab**, not an installed home-screen app
(`standalone: false`). The production app is always installed, and iOS is known
to treat installed PWAs differently in some respects.

Remaining test: Add to Home Screen, then Mode A with `playback`.

- If it survives → background alerts are possible; the spec's "interrupts music"
  branch applies and the keepalive ships off by default behind a setting.
- If it does not → conclude that iOS will not do this at all.

## Decision

Pending the installed-PWA test.

If that test also fails, the pre-committed third outcome applies: **foreground
tone plus Wake Lock only.** The app-switch and screen-locked cases are then
documented as unsupported on iOS, which is a platform limit rather than a
design choice — the same limit that rules out haptics, since the Vibration API
does not exist in iOS Safari.

Wake Lock still covers the common case of the phone sitting on the bench with
the app open, which is how most sets are actually logged.
