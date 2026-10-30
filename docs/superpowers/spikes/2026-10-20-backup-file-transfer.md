# Spike result: saving and opening a backup file on the iPhone

**Status:** Complete. The share sheet saves; the file input opens; the round trip is exact.
**Device:** iPhone, iOS 18.7, Safari 26.6.1 (WebKit 605.1.15)
**Tested in:** both a Safari tab (`navigator.standalone: false`) and an installed
home-screen app (`navigator.standalone: true`), on 2026-10-20.
**Page:** `public/file-diag.html`, added in `c689547` and deleted once this was recorded.

## Question

Plan 6's backup must save a file to iCloud Drive and read it back from a home-screen PWA
on iOS. How a home-screen app saves and opens files is device-specific, and the rest tone
taught that a mechanism assumed to work can fail on the phone. Which mechanisms actually
work, and does the file survive the trip byte for byte?

## What was tested

- **Save A:** `<a download>` on a blob URL — historically unreliable in standalone mode.
- **Save B:** `navigator.share({ files: [file] })` — the share sheet's Save to Files.
- **Open:** `<input type="file">`, once with `accept=".json,application/json"` and once
  with no filter.

Each saved file was about 2 MB, roughly years of training. It carried a SHA-256 of its body
and its own UTF-8 byte count, so opening it back proved an exact round trip, not just that
something came back. The body held non-ASCII names, escapes, `22.5`, `0.1 + 0.2` and
millisecond timestamps. Payloads were built and hashed before the tap, so an `await`
could not spend the user's gesture before `share()`.

Before deploying, the verifier was mutation-tested on a desktop. It caught each of these:
a byte-order mark, one changed weight, a timestamp off by 1 ms, CRLF line endings and a
truncated file.

## Results

| Mode | Save A (download link) | Save B (share sheet) | Open, JSON filter | Round trip |
| --- | --- | --- | --- | --- |
| Safari tab | **saved** (`lastModified` 2 s after the tap) | backed out (`AbortError`) | **worked** | **intact**, 2,080,463 bytes |
| Home-screen app | not tried | **saved to iCloud Drive**, `share()` resolved | **worked** | **intact**, 2,080,468 bytes |

The two sizes differ by five bytes because the file records which mode saved it, and
"home-screen app" is five characters longer than "Safari tab".

Environment, identical in both modes:

- `navigator.canShare({ files: [json] })` was `true`; `showSaveFilePicker` was undefined.
- `navigator.storage.persisted()` was `false`. The test page never asked for persistence.
  The app does ask, through `requestPersistentStorage()`, but its result is shown nowhere.
- `navigator.storage.estimate()` reported a quota of 39,321.60 MB.
- **`matchMedia('(display-mode: standalone)')` was `false` in the home-screen app**, while
  `navigator.standalone` was `true`. The page had no manifest.

## Conclusions

1. **Use the share sheet to save.** It works in the home-screen app, the mode the user
   actually uses, and the user found it fine. Whether the download link works in the
   home-screen app is unknown, and doesn't need answering.
2. **Use `<input type="file" accept=".json,application/json">` to open.** It found the
   files in both modes.
3. **The trip through iCloud Drive is exact.** A backup can rely on byte-for-byte
   fidelity.
4. **Quota is not the threat; eviction is.** About 39 GB is available against roughly
   1 MB of training data a year.
5. **Not measured:** whether `share()` still has the user's gesture after the app spends a
   moment building the file. The design therefore falls back to a second tap on
   `NotAllowedError`.
