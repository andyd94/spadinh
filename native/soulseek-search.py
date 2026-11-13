# Chrome native messaging host: finds the best copy of a track on Soulseek and queues it in slskd.
#
# Chrome starts this through the launcher install.sh writes (native/soulseek-host), which runs it
# on Downloadinh's Python from Downloadinh's folder: the search, the matching rules and the format
# ranking are all Downloadinh's own (github.com/andyd94/downloadinh), and so is the config - the
# slskd address and API key come from its downloadinh.toml, nothing is kept in the extension.
#
# One {"query": "Artist - Title (Mix)"} comes in over the port (chrome.runtime.connectNative).
# {"progress": true, "text": ...} lines go back while the search runs, then one final
# {"ok": bool, "text": ...}, and the host exits.
#
# A file is queued only when it passes Downloadinh's rules: lead artist in the path, the same title
# and mix name, a wanted format, and - when Spotify is configured and knows the track - a length
# within the tolerance. Otherwise nothing is downloaded and the closest files are named with why
# they failed. The download itself is left to slskd; it lands in slskd's downloads folder.

import json
import os
import struct
import sys

SOULSEEK = "soulseek: "


def read_message():
    raw_length = sys.stdin.buffer.read(4)

    if len(raw_length) < 4:
        sys.exit(0)

    (length,) = struct.unpack("<I", raw_length)

    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send(message):
    data = json.dumps(message).encode("utf-8")

    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def progress(text):
    send({"progress": True, "text": SOULSEEK + text})


def file_name(f):
    return f.filename.replace("\\", "/").rsplit("/", 1)[-1]


def describe_queued(candidate):
    f = candidate.file
    slot = "free slot" if f.has_free_slot else "queue of %d" % f.queue_length

    return "queued %s from %s (%s) - %s" % (candidate.quality.label, f.username, slot, file_name(f))


def describe_miss(candidate):
    reasons = list(candidate.match.reasons)

    if not candidate.quality.acceptable:
        reasons.append(candidate.quality.reason)

    return "%s [%s]" % (file_name(candidate.file), ", ".join(reasons))


def describe_search_failure(url, error):
    if "Connection refused" in error or "Failed to establish" in error:
        return "can't search slskd - nothing is answering at %s, is it running?" % url

    if "401" in error or "403" in error:
        return "can't search slskd - it turned down the API key in downloadinh.toml"

    return "can't search slskd at %s (%s)" % (url, error[:200])


def run(query, soulseek=None, spotify=None, cfg=None):
    """Search, pick and queue. Returns the final (ok, text); `soulseek`, `spotify` and `cfg` are
    only passed in by tests."""
    try:
        from downloadinh import config as config_mod
        from downloadinh.models import Track, TrackResult
        from downloadinh.pipeline import Downloadinh, Settings, search_query
        from downloadinh.textnorm import parse_line
    except ImportError as error:
        return False, "can't load Downloadinh (%s) - run native/install.sh" % error

    try:
        parsed = parse_line(query)
    except ValueError:
        parsed = None

    if not parsed:
        # Without an artist there's nothing to hold a file to, and the wrong tune would download.
        return False, "need \"artist - title\" to pick a file, got \"%s\"" % query

    artists, title, mix = parsed
    track = Track(artists=artists, title=title, mix=mix, source_line=query)

    if cfg is None:
        try:
            cfg = config_mod.load(os.environ.get("DOWNLOADINH_CONFIG") or None)
        except Exception as error:
            return False, "can't read downloadinh.toml: %s" % error

    if soulseek is None:
        if not cfg.slskd_api_key:
            return False, "no slskd API key in downloadinh.toml"

        from downloadinh.slskd import SlskdClient

        soulseek = SlskdClient(cfg.slskd_url, cfg.slskd_api_key, cfg.slskd_downloads)

    if spotify is None and cfg.spotify_client_id and cfg.spotify_client_secret:
        from downloadinh.spotify import SpotifyClient

        spotify = SpotifyClient(cfg.spotify_client_id, cfg.spotify_client_secret)

    # A dry run is Downloadinh's own search-match-rank with nothing downloaded: it hands back the
    # best file, or the nearest misses. Queueing is done here so the key press returns straight
    # away instead of waiting out the transfer.
    settings = Settings(tolerance_s=cfg.tolerance_s, search_timeout_s=cfg.search_timeout_s, dry_run=True)
    app = Downloadinh(soulseek, spotify, None, settings)
    result = TrackResult(track=track)

    track = result.track = app.resolve(track, result)
    length = "" if track.duration is None else ", %d:%02d" % divmod(round(track.duration), 60)
    progress("searching %s%s…" % (search_query(track), length))

    if not app.try_soulseek(track, result):
        failed = [n for n in result.notes if n.startswith("Soulseek search failed")]

        if failed:
            return False, describe_search_failure(cfg.slskd_url, failed[0].split(": ", 1)[-1])

        text = "nothing good for %s" % track.display

        if result.near_misses:
            text += " - closest: " + "; ".join(describe_miss(c) for c in result.near_misses)
        else:
            text += " - " + next((n[len("Soulseek: "):] for n in result.notes if n.startswith("Soulseek: ")),
                                 "no results")

        return False, text

    try:
        soulseek.enqueue(result.chosen.file)
    except Exception as error:
        return False, "found %s but slskd wouldn't queue it (%s)" % (file_name(result.chosen.file), error)

    text = describe_queued(result.chosen)

    if track.duration is None:
        text += " - length not checked"

    return True, text


def main():
    message = read_message()
    query = " ".join(str(message.get("query") or "").split())

    if not query:
        send({"ok": False, "text": "nothing to search for"})
        return

    try:
        ok, text = run(query)
    except Exception as error:  # the page should hear about anything, not see the port drop
        ok, text = False, "failed: %s" % error

    send({"ok": ok, "text": SOULSEEK + text})


if __name__ == "__main__":
    main()
