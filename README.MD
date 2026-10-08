## Installation

1) Click on code -> download zip 
2) Extract the folder from zip file 
3) In your chrome window go to chrome://extensions
4) Click load unpacked
5) Select extracted "spadinh" folder

## Usage

#### Ratio Filter

- On a seller page, **Filter** removes every listing whose want/have ratio (the two community numbers on the listing) is below the ratio in the popup. The ratio defaults to 0.75 and is remembered.

- The "auto" checkbox beside the ratio input will determine whether this filter will automatically run on page load and on paging.

- Alternatively you can press Ctrl + Shift to trigger this action.

- The record count text will update to reflect the new number of results on the page.

- **Avoid Labels** and **Avoid Artists** are comma-separated lists; listings by any of them are removed at the same time as the ratio filter runs. The artist is the part of the listing title before ` - `, the label is as shown on the listing (minus its `(n)` suffix); both are matched whole, ignoring case, with no spaces after the commas.

- **Browse All** opens every listing left on the page in its own tab.

- **Instrumentals** reloads the current Discogs search with the query set to `instrumental|dubstrumental|dubstramenal|dub&`, i.e. instrumental and dub mixes (and the usual misspellings).

#### Dinhscogvery

- With a Discogs release page open (or one of its marketplace listings), **Pass** marks the release as passed in dinhscogvery and **Revisit** parks it on the built-in Revisit list (press again to take it off).

- The same keys as dinhscogvery work on the Discogs page itself: `p` passes, `r` toggles Revisit. A small toast in the bottom-right corner shows the result. Keys are ignored while typing in a field or with a modifier held.

- The status line under the buttons shows where the release already stands (`#123 · passed · Revisit`), or `not in the dinhscogvery catalog` when it isn't an EDM release in the mirror.

- On a seller page, listings you've already passed are removed and listings on the Revisit list are tinted teal with a bar down their left edge. This runs on load and on paging, independently of the ratio filter's "auto" setting.

- The passed/revisit lists are cached for 10 minutes. Passing or revisiting through this extension updates the cache straight away; click the popup's status line to re-sync after triaging in dinhscogvery itself.

- If dinhscogvery can't be reached, the page is left exactly as it is rather than half-filtered.

- Requests go to dinhscogvery's Tailscale Serve address by default (`https://ukfcp2j9w2qg.tail287e49.ts.net`), so this works from any laptop on the tailnet. Change the API url field if it's served elsewhere (e.g. `http://127.0.0.1:8000` on the serving machine).

- Serve terminates TLS and proxies to `127.0.0.1:8000`, so dinhscogvery stays bound to localhost — nothing needs to listen on port 8000 across interfaces, and nothing is exposed to the LAN. Check it with `tailscale serve status`; re-add it with `tailscale serve --bg 8000`.

#### YouTube

- On a video page, `s` opens a Google search for the video as `artist - track name` in a new tab. The title is used as-is when it already has that shape (the norm for record rips), with upload noise like `(Official Video)` or `[HD]` stripped; a title with no ` - ` gets the channel name in front as the artist (minus the ` - Topic` of YouTube's auto-generated artist channels; a `Various Artists - Topic` channel adds nothing).

- `a` likes the video. It only ever likes — pressing it on a video you've already liked says so rather than unliking it.

- Neither key clashes with YouTube's own shortcuts. Keys are ignored while typing in a field or with a modifier held.

- On a Discogs release page, `a` likes the video playing in the embedded player, without leaving the page. The embed has no like button, so the extension sends the like button's own internal request from inside the player frame, using your YouTube session. That request is undocumented, so if YouTube ever rejects it — or you're signed out in the player, which happens when third-party cookies are blocked — the extension falls back to opening the video on YouTube in a background tab, liking it there and closing the tab again. A toast reports which happened. It works whether the page or the player has keyboard focus.

- On a Discogs release page, `s` opens the same Google search as on YouTube for the video playing in the embedded player. When a video's title has no ` - ` of its own, the release artist from the page heading stands in as the artist.

- When nothing is playing, both `s` and `Shift+S` search for whatever text is highlighted on the page instead — highlight a tracklist line like `The Architect – Amber Waves` and press the key. A leading position (`A2 `) and Discogs' `(2)` artist suffix are dropped. A highlight with no ` - ` of its own — a bare track name on a single-artist release — gets the release artist (on YouTube, the channel) put in front; "Various" never is. A video that's loaded but paused is only searched when nothing is highlighted. On a Discogs page with no videos and nothing highlighted, the record itself is searched, as `Artist - Title` from the page heading (just the title for a `Various` release).

#### Soulseek

- `Shift+S` — on a YouTube video page, on a Discogs release page, or inside its player — searches SoulseekQt for the playing track, using the same `artist - track name` query as `s` (minus the ` - `, which Soulseek would read as "exclude"). SoulseekQt comes to the front, switched to Search → Manual Searches if it was on another tab, with the results tab open. A toast on the page reports what was searched, or why it couldn't be.

- SoulseekQt has no API, so the extension hands the query to a small helper (`native/soulseek-search.py`) that Chrome is allowed to launch; it types into SoulseekQt's search box and presses Search through macOS accessibility. macOS only; it uses the built-in `osascript` and Apple's `/usr/bin/python3`, which needs the Xcode Command Line Tools installed (`xcode-select --install` if `python3 --version` prompts for them). One-time setup on each Mac:

  1) From the extension folder run `bash native/install.sh` (no sudo). It registers the helper with Chrome, Chromium and Brave for this checkout's location — re-run it if the folder moves.
  2) In `chrome://extensions`, remove any existing Spadinh entry and **Load unpacked** the folder again: the `key` in the manifest fixes the id at `onhlmcgjfnopeojjoocnmneahejhhlmh` on every machine, and Chrome treats that as a new extension (the popup's saved settings reset once). On later updates a plain reload is enough.
  3) Press `Shift+S` once; macOS asks to let Google Chrome control the computer. Allow it under System Settings → Privacy & Security → Accessibility (and, if asked, under Automation), then press `Shift+S` again.

- If the toast says it can't reach the Soulseek bridge, step 1 hasn't been run on this Mac, or the folder has moved since. Any other failure is reported in the toast with the reason.
