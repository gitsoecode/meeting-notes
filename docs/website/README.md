# Website deep-link redirect

One page the marketing site needs to host, so Claude Desktop citations can
deep-link into the installed Gistlist app.

## What to deploy

Host `open-redirect.html` in this directory at:

```
https://gistlist.app/open
```

(either as `/open/index.html` or configured so `/open` serves the file —
whichever the site generator prefers). No build step, no runtime deps,
just a static file.

## Why it exists

Claude Desktop's markdown renderer sanitizes non-standard URL schemes
(`gistlist://`, `obsidian://`, etc.) and silently strips them. The MCP
server emits citation links against `https://gistlist.app/open` instead,
and this page bounces through to the `gistlist://` scheme that the
installed Gistlist.app registers.

Shape of incoming URLs from the MCP server:

```
https://gistlist.app/open?m=<run_id>&t=<start_ms>        — seekable transcript moment
https://gistlist.app/open?m=<run_id>&s=<summary|prep|notes|transcript>
```

The page parses those params, builds the matching `gistlist://` URL, and
fires `window.location.href = ...`. If the app isn't installed (scheme
handler absent), the user stays on the page and sees a "Download
Gistlist" CTA.

## Do not change without coordinating

The URL params (`m`, `t`, `s`) are part of the MCP server's public
output. If the website changes them, the MCP server
(`packages/mcp-server/src/tools.ts` — `formatCitationLink` and
`openUrlBase`) must change in lockstep and every shipped copy of the
Gistlist app needs the update too. Tread carefully.

## Testing locally

The MCP server reads `GISTLIST_OPEN_URL_BASE` to override the default
`https://gistlist.app/open`. For local redirect testing you can set it
to e.g. `http://localhost:3000/open` in the dev install script's `env`
block, serve the HTML locally, and click citations from Claude Desktop
— they'll bounce through localhost instead of production.
