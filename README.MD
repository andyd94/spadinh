# Spadinh

Chrome extension for digging on Discogs and YouTube: filter listings, triage releases against dinhscogvery, and like, shortlist or search for the playing track from the keyboard.

## Shortcuts

| Key | Action | Discogs page | Discogs embedded player | YouTube |
| --- | --- | :---: | :---: | :---: |
| `p` | Pass the release in dinhscogvery | release / listing | | |
| `r` | Toggle the release on the Revisit list | release / listing | | |
| `a` | Like the video | ✓ | ✓ | ✓ |
| `d` | Add the video to the **Downloads** playlist | ✓ | ✓ | ✓ |
| `s` | Google the track as `artist - track name` | ✓ | ✓ | ✓ |
| `Shift+D` | Download the track through Downloadinh | ✓ | ✓ | ✓ |
| `Ctrl+Shift` | Run the ratio filter | seller, artist, label, search | | |

On Discogs the video is the one playing. On YouTube it is the one under the mouse pointer, or the one playing when the pointer is on none.

Letter keys are ignored while typing in a field or with another modifier held. A toast on the page reports the result.

## Installation

1. `git clone git@github.com:andyd94/spadinh.git`
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `spadinh` folder.

To update:

1. `git pull`
2. Reload the extension in `chrome://extensions`.
3. Refresh any open Discogs and YouTube tabs.

### Downloadinh (for `Shift+D`)

`Shift+D` hands tunes to [Downloadinh](https://github.com/andyd94/downloadinh)'s queue, so Downloadinh has to be running on the same Mac:

```
downloadinh serve
```

Set it up as its README says (slskd, Spotify and Telegram details go in its `downloadinh.toml`). Nothing is configured in the extension; it talks to `http://127.0.0.1:5031`.

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

`a`, `d`, `s` and `Shift+D` act on the video playing on a YouTube video page or in a Discogs release page's embedded player, whichever has focus.

- **Hovering** on YouTube points the keys at another video: a row of the liked list or any playlist, the playlist panel beside the player, the sidebar, a search result, a home or channel tile. This works on any YouTube page, with or without a video playing. The row flashes and the toast names the video. With the pointer on the player, on the playing video's own row or on no video, the keys act on the playing video.
- **`a` (like)** only ever likes. On an already-liked playing video it says so; a hovered video is liked without that check.
- **`d` (Downloads)** adds the video to a private playlist named **Downloads**, created on first use. A video already in it is left alone. It uses your YouTube session: no Google Cloud or OAuth setup.
- On Discogs, `a` and `d` fall back to opening the video in a background YouTube tab, acting there and closing it, when the player can't do it (e.g. signed out because third-party cookies are blocked).
- **`s` (Google)** searches `artist - track name` in a new tab, with upload noise stripped from the title: `(Official Video)`, `[HD]`, label names, catalogue numbers, years, and whatever follows the track in a whole-record title (`Artist - Track - Some EP - Label 015` becomes `Artist - Track`; a part naming a mix is kept). If the title has no ` - `, the channel name (on Discogs, the release artist) stands in as the artist.
- **`Shift+D` (download)** adds the same query to Downloadinh's queue. Downloadinh looks for the best copy on Soulseek (artist, title, mix and length must match; AIFF, then WAV, FLAC, MP3), falls back to DeezLoadApp, discards fake lossless files, converts FLAC to AIFF and imports the result into Music.
- The toast follows the tune for up to 20 minutes: queued, searching, downloading with a percentage, then what it got (`downloadinh: got Artist - Title - AIFF 16/44.1 from Soulseek - file.aiff`) or that it couldn't be found. The full picture, with near misses and store links, is on Downloadinh's page at http://localhost:5031.
- A query with no ` - ` (a `Various` release with nothing highlighted) is turned down: without an artist there's nothing to hold a file to. So is a tune already waiting in the queue.

When nothing is playing, `s` and `Shift+D` take the highlighted text instead, e.g. a tracklist line. Leading positions (`A2`) and Discogs' `(2)` suffixes are dropped, and a highlight with no ` - ` gets the release artist or channel in front (never "Various"). A paused video is searched only when nothing is highlighted. On a Discogs page with no videos and nothing highlighted, the record itself is searched as `Artist - Title`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| dinhscogvery status says it couldn't reach either address | You're off the tailnet and nothing is serving on `127.0.0.1:8000`. |
| Toast: downloadinh isn't running | Start it with `downloadinh serve` and press `Shift+D` again. |
| `a` or `d` on Discogs opens a background tab | Expected fallback when the embedded player is signed out. |
| `a` or `d` stops working everywhere | YouTube changed its internal request; the toast says why. |
| Keys do nothing after an update | Reload the extension and refresh the tab. |
