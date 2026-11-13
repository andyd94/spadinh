# Spadinh

Chrome extension for digging on Discogs and YouTube: filter listings, triage releases against dinhscogvery, and like, shortlist or search for the playing track from the keyboard.

## Shortcuts

| Key | Action | Discogs page | Discogs embedded player | YouTube video page |
| --- | --- | :---: | :---: | :---: |
| `p` | Pass the release in dinhscogvery | release / listing | | |
| `r` | Toggle the release on the Revisit list | release / listing | | |
| `a` | Like the playing video | ✓ | ✓ | ✓ |
| `d` | Add the playing video to the **Downloads** playlist | ✓ | ✓ | ✓ |
| `s` | Google the playing track as `artist - track name` | ✓ | ✓ | ✓ |
| `Shift+S` | Find the playing track on Soulseek and queue the best file for download | ✓ | ✓ | ✓ |
| `Ctrl+Shift` | Run the ratio filter | seller, artist, label, search | | |

Letter keys are ignored while typing in a field or with another modifier held. A toast on the page reports the result.

## Installation

1. `git clone git@github.com:andyd94/spadinh.git`
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `spadinh` folder.

To update:

1. `git pull`
2. Reload the extension in `chrome://extensions`.
3. Refresh any open Discogs and YouTube tabs.

### Soulseek helper (macOS only, once per Mac)

`Shift+S` needs a small helper Chrome can launch. It searches Soulseek through [slskd](https://github.com/slskd/slskd) using [Downloadinh](https://github.com/andyd94/downloadinh)'s code, and reads slskd's address and API key from Downloadinh's `downloadinh.toml`, so nothing is configured in the extension.

1. Set up Downloadinh as its README says: a checkout, a Python 3.11+ venv with it installed, and `downloadinh.toml` with slskd's `api_key`.
2. From the extension folder, run `bash native/install.sh` (no sudo). It looks for Downloadinh in a `downloadinh` folder next to this one (otherwise pass the path: `bash native/install.sh ~/code/downloadinh`) and for its Python in `.venv` or `venv` inside it, then `~/.venvs/downloadinh` (or set `DOWNLOADINH_PYTHON`). Re-run it if either folder moves.
3. Reload the extension in `chrome://extensions`. On a Mac that has never had it, **Load unpacked** the folder; the manifest `key` pins the extension id to `onhlmcgjfnopeojjoocnmneahejhhlmh`.

slskd has to be running. Soulseek allows one login per account, so the desktop Soulseek app can't be online on the same account at the same time.

## Ratio filter

Popup controls, for Discogs seller, artist, label and search pages.

- **Filter** (or `Ctrl+Shift`) drops every listing whose want/have ratio is below the popup's ratio. Default 0.75, remembered.
- **auto** runs the filter on page load and on paging.
- **Avoid Labels** / **Avoid Artists**: comma-separated, no spaces after the commas, matched whole and case-insensitively. Matching listings go when the filter runs.
- **Browse All** opens every remaining listing in its own tab.
- **Instrumentals** reruns the current Discogs search for instrumental and dub mixes.

On seller pages listings are removed and the record count updates. On artist, label and search pages the filter uses dinhscogvery's figures, so rows are hidden instead: lower the ratio and filter again to bring them back. Rows with no figures stay.

## Dinhscogvery

### Triage

- **Pass** (`p`) and **Revisit** (`r`) work on a release page or one of its marketplace listings. Pressing Revisit again takes the release off the list.
- Opening a release page marks it seen. Opening a master page marks every pressing seen.
- The popup status line shows where the release stands (`#123 · passed · Revisit`), or `not in the dinhscogvery catalog`. Click it to re-sync after triaging in dinhscogvery itself.

### Row strips

On artist, label, search and seller pages, each row dinhscogvery knows gets a strip under its title:

| Badge | Meaning |
| --- | --- |
| `24 have · 32 want` | Community figures; hover for the ratio |
| `★ 2.83 (6)` | Rating and vote count |
| styles | The release's styles |
| `no clips` (red) | No video on the release or its master: a blind buy |
| `instr 2/4` | Instrumental tracks out of total |
| `taste N` | Taste percentile, 0-100; hover for the raw score |
| `passed` / `owned` / `revisit` | Your status; passed rows are dimmed, revisit rows tinted |
| grey tint | Already seen, in dinhscogvery or on Discogs |

- A grouped master row shows its most-wanted version's figures and the number of versions held. It is tinted when any version is seen; hover the count for `seen n of m`.
- Seller pages: strips appear only for sellers dinhscogvery has mirrored (a toast says when it hasn't) and leave out rating, haves and wants. Passed listings are removed and Revisit listings tinted teal, regardless of **auto**.
- Rows dinhscogvery doesn't carry are left alone.

### Filter bar

A bar in the bottom-left corner of the page:

- **blind buys only** keeps rows with no clips. **instrumentals only** keeps rows with an instrumental track. Both are remembered across pages.
- While either is on, rows dinhscogvery doesn't know are hidden too.
- It shows how many rows are left (`4 of 17`) and what the ratio filter is hiding, with a × to show those rows again.
- The dot turns teal while anything is hidden. Click it to collapse the bar.

### Connection

- Default API url: `https://dinhscogvery.tail287e49.ts.net`, reachable only on the tailnet. Change it in the popup's API url field.
- If nothing answers within 5 seconds (e.g. a VPN is blocking Tailscale), requests fall back to `http://127.0.0.1:8000` for 10 minutes, then the tunnel is retried.
- If neither answers, the page is left untouched and the status says so.
- Data is cached for 10 minutes. Passing or revisiting through the extension updates it at once.

## YouTube keys

`a`, `d`, `s` and `Shift+S` act on the video playing on a YouTube video page or in a Discogs release page's embedded player, whichever has focus.

- **`a` (like)** only ever likes. On an already-liked video it says so.
- **`d` (Downloads)** adds the video to a private playlist named **Downloads**, created on first use. A video already in it is left alone. It uses your YouTube session: no Google Cloud or OAuth setup.
- On Discogs, `a` and `d` fall back to opening the video in a background YouTube tab, acting there and closing it, when the player can't do it (e.g. signed out because third-party cookies are blocked).
- **`s` (Google)** searches `artist - track name` in a new tab, with upload noise stripped from the title: `(Official Video)`, `[HD]`, label names, catalogue numbers, years. If the title has no ` - `, the channel name (on Discogs, the release artist) stands in as the artist.
- **`Shift+S` (Soulseek)** searches Soulseek for the same query and queues the best file in slskd. The choice is Downloadinh's: lead artist, title and mix name must match, and the length must be within 2 seconds of Spotify's when Spotify is configured there and knows the track. Among files that pass it's AIFF, then WAV, FLAC and 320/VBR MP3, highest resolution up to 24/48, free upload slot first. The toast shows what was queued, e.g. `soulseek: queued AIFF 16/44.1 from user (free slot) - file.aiff`.
- When no file passes, nothing is downloaded and the toast names the closest files and why each failed (`mix differs`, `MP3 192 kbps CBR is below 320`). A query with no ` - ` (a `Various` release with nothing highlighted) isn't searched: without an artist there's nothing to hold a file to.
- The file lands in slskd's downloads folder and stays there. Downloadinh's after-download steps (fake-lossless check, FLAC to AIFF, the move into Music) only run when Downloadinh does the downloading.

When nothing is playing, `s` and `Shift+S` search the highlighted text instead, e.g. a tracklist line. Leading positions (`A2`) and Discogs' `(2)` suffixes are dropped, and a highlight with no ` - ` gets the release artist or channel in front (never "Various"). A paused video is searched only when nothing is highlighted. On a Discogs page with no videos and nothing highlighted, the record itself is searched as `Artist - Title`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| dinhscogvery status says it couldn't reach either address | You're off the tailnet and nothing is serving on `127.0.0.1:8000`. |
| Toast: can't reach the Soulseek bridge | `native/install.sh` hasn't been run on this Mac since the helper moved to slskd, or a folder has moved. Re-run it. |
| Toast: can't search slskd | slskd isn't running, or the `api_key` in `downloadinh.toml` is wrong. |
| `a` or `d` on Discogs opens a background tab | Expected fallback when the embedded player is signed out. |
| `a` or `d` stops working everywhere | YouTube changed its internal request; the toast says why. |
| Keys do nothing after an update | Reload the extension and refresh the tab. |
