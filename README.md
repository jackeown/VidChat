# MeliChat

MeliChat is a static peer-to-peer video chat room built with vanilla HTML, CSS, JavaScript, and PeerJS. It can be served from any static host, including GitHub Pages.

Live site: <https://jackeown.github.io/VidChat/>

## Features

- Copyable room links with generated room IDs
- Peer-to-peer camera sharing
- Screen sharing with optional screen audio controls
- Text chat with unread message badges
- File sharing through the chat panel
- Emoji autocomplete and shortcode expansion, including GitHub/Gemoji-style names like `:rocket:` and `:smiling_imp:`
- Multiple video layouts: grid, spotlight, and filmstrip
- Per-feed controls for volume, fit, position, and size
- Local settings for display name, chat name, background, accent color, video fit, and camera mirroring

## Files

- `index.html` - main app shell
- `style.css` - app styling and responsive layout
- `vidChat.js` - PeerJS room, media, chat, layout, and settings logic
- `emojiData.js` - local emoji shortcode catalog
- `about.html` - short project overview

## Running Locally

The app has no build step. Serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Camera and screen sharing require a secure browser context. `localhost` works for local development; deployed versions should use HTTPS.

## Deployment

Deploy the repository as static files. For GitHub Pages, publish the repo root or the branch/folder configured for Pages. The app loads PeerJS from the CDN in `index.html`:

```html
<script src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js"></script>
```

## Usage

1. Open the app.
2. Enter a display name when prompted.
3. Copy the room link and send it to someone else.
4. Use the camera, screen, layout, chat, file, and settings controls from the top bar and chat modal.

In chat, type `:` to open emoji autocomplete, or send full shortcodes such as `:devil:`, `:heart:`, or `:party:`.

## Notes

MeliChat uses PeerJS for signaling and WebRTC for media/data connections. Media and chat traffic are peer-to-peer once connections are established, but users still need access to the PeerJS signaling service and a working network connection.
