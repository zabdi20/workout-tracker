# Spike result: rest alert reach

**Status:** Complete. Conclusive negative.
**Device:** iPhone, iOS 18.7, Safari 26.5.2 (WebKit 605.1.15)
**Tested in:** both a Safari tab (`standalone: false`) and an installed
home-screen app (`standalone: true`).

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

| Mode | Category | Installed | Backgrounded behaviour |
| --- | --- | --- | --- |
| A one-shot | `ambient` | no | Suspended. `currentTime` 1.4 → 2.1 over 42 s away (1.7 % of real time). Audio resumed on return. |
| A one-shot | `playback` | no | Interrupts other audio — a playing video stopped. |
| B keepalive + JS | `playback` | no | JS frozen. A 30 s timer fired at 81 s, in the same second the app was reopened. `TONE PLAY RESOLVED`, but only on resume. |
| B keepalive + JS | `ambient` | no | Frozen. |
| **A one-shot** | **`playback`** | **yes** | **Suspended. `currentTime` 1.5 → 5.5 over 58 s away (6.9 % of real time). Beep sits at 30 s, so it could not sound.** |

The decisive run is the last. Installing the app improved throughput from
1.7 % to 6.9 % of real time — better, but still frozen for practical purposes,
and far short of reaching a beep 30 s in.

Playback resumed at full speed the moment the app returned to the foreground.
The track is 31.5 s long; `currentTime` was 5.5 s on return at 8:10:47 and the
`ended` event fired at 8:11:13 — exactly the 26 s remaining. Audio advances only
while foregrounded.

`navigator.audioSession` **is** available and accepts both `ambient` and
`playback`, reporting the value back correctly. The category is honoured for
mixing behaviour; it does not affect suspension.

## Findings

**iOS suspends both timers and audio playback when a PWA is backgrounded,
regardless of audio session category and regardless of whether the app is
installed.** The element keeps reporting `paused=false` while frozen, so element
state is not a trustworthy signal — only `currentTime` movement is.

**Removing JavaScript from the critical path does not help.** Mode A was built
specifically so that no code needs to run when the alert fires; the audio is
pre-rendered with the beep baked in. It fails anyway, because the audio clock
itself is suspended. This rules out the entire class of workaround, not just one
implementation of it.

**The two categories trade off as specified, and neither wins.** `ambient` mixes
with the user's audio but is silenced when backgrounded. `playback` does take
over the audio session — it demonstrably stopped a playing video — and still
does not play while backgrounded. So `playback` costs the user their music and
buys nothing.

**Web Push was rejected without testing,** for reasons these results do not
change: it requires a server to originate the push, reinstating the backend this
design deliberately removes, and it needs live network in a gym basement.

## Decision

The pre-committed third outcome applies: **foreground tone plus Wake Lock only.**

- **Ship:** a tone on timer completion while the app is visible, and a Wake Lock
  held for the duration of rest so the screen stays awake with a large countdown.
- **Do not build:** the silent-audio keepalive. It cannot work, and under
  `playback` it would silence the user's music for no benefit. No setting is
  needed for a feature that does nothing.
- **Document as unsupported:** app-switched and screen-locked alerting.

This is a platform limit, not a design choice — the same class as the absent
Vibration API. No amount of engineering reaches around it from a PWA.

Wake Lock still covers the phone sitting on the bench with the app open, which
is how most sets are logged. The residual gap is real and should be stated
plainly in the UI rather than papered over: if the user leaves the app, the
timer keeps correct time but cannot announce itself.

## Consequences for the design

1. The rest timer must still be **timestamp-based**, and this spike strengthens
   that requirement rather than softening it. A 30 s `setInterval` was measured
   firing at 81 s. On return the app must recompute from a stored deadline, not
   trust accumulated ticks.
2. **Wake Lock is the primary mechanism**, not a companion, and must re-acquire
   on `visibilitychange` — it is released whenever the document hides.
3. `restAlertSound` remains a useful setting for silencing the foreground tone.
4. Returning to the app after rest has elapsed is a **normal, expected flow**,
   not an edge case. The UI should make elapsed rest immediately obvious on
   resume.

## Method note

Two harness bugs were found and fixed before any result was trusted:

1. The tone element was never started by a user gesture, so `play()` was rejected
   with `NotAllowedError` regardless of backgrounding. iOS only permits
   programmatic `play()` on an element a gesture has already started.
2. Audio elements were constructed at page load, making it impossible to
   distinguish opening the page from running a test when the user's music
   stopped.

Both were measurement errors, not platform behaviour, and neither appears in the
results table. The first produced a plausible-looking failure that would have
been recorded as a platform verdict had it not been checked.
