## Installation

1) Click on code -> download zip 
2) Extract the folder from zip file 
3) In your chrome window go to chrome://extensions
4) Click load unpacked
5) Select extracted "spadinh" folder

## Usage

#### Ratio Filter

- The "auto" checkbox beside the ratio input will determine whether this filter will automatically run on page load.

- Alternatively you can press Ctrl + Shift to trigger this action.

- The record count text will update to reflect the new number of results on the page.

#### Dinhscogvery

- With a Discogs release page open (or one of its marketplace listings), **Pass** marks the release as passed in dinhscogvery and **Revisit** parks it on the built-in Revisit list (press again to take it off).

- The same keys as dinhscogvery work on the Discogs page itself: `p` passes, `r` toggles Revisit. A small toast in the bottom-right corner shows the result. Keys are ignored while typing in a field or with a modifier held.

- The status line under the buttons shows where the release already stands (`#123 · passed · Revisit`), or `not in the dinhscogvery catalog` when it isn't an EDM release in the mirror.

- On a seller page, listings you've already passed are removed and listings on the Revisit list are tinted teal with a bar down their left edge. This runs on load and on paging, independently of the ratio filter's "auto" setting.

- The passed/revisit lists are cached for 10 minutes. Passing or revisiting through this extension updates the cache straight away; click the popup's status line to re-sync after triaging in dinhscogvery itself.

- If dinhscogvery can't be reached, the page is left exactly as it is rather than half-filtered.

#### YouTube

- On a video page, `s` opens a Google search for the video as `artist - track name` in a new tab. The title is used as-is when it already has that shape (the norm for record rips), with upload noise like `(Official Video)` or `[HD]` stripped; a title with no ` - ` gets the channel name in front as the artist.

- `a` likes the video. It only ever likes — pressing it on a video you've already liked says so rather than unliking it.

- Neither key clashes with YouTube's own shortcuts. Keys are ignored while typing in a field or with a modifier held.

- On a Discogs release page, `a` likes the video playing in the embedded player. The embed has no like button, so the extension opens the video on YouTube in a background tab, likes it there and closes the tab again — you stay on Discogs, and a toast reports the result. It works whether the page or the player has keyboard focus. You need to be signed in to YouTube in that browser; otherwise the toast says the like didn't register.

- Requests go to dinhscogvery's Tailscale Serve address by default (`https://ukfcp2j9w2qg.tail287e49.ts.net`), so this works from any laptop on the tailnet. Change the API url field if it's served elsewhere (e.g. `http://127.0.0.1:8000` on the serving machine).

- Serve terminates TLS and proxies to `127.0.0.1:8000`, so dinhscogvery stays bound to localhost — nothing needs to listen on port 8000 across interfaces, and nothing is exposed to the LAN. Check it with `tailscale serve status`; re-add it with `tailscale serve --bg 8000`.