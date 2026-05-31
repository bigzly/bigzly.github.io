# Media Ranker

This folder now contains the ranker plus a local collection helper:

- a static web app
- a no-hosting Scriptable app
- a browser extension for collecting public media URLs into a download queue

## What it does

- Lets you choose GIFs, images, and previewable short videos directly in the browser
- Builds an exact ranked top-`N` shortlist instead of fully sorting the media you are going to cut
- Uses fewer comparisons for the `30 choose 20` use case
- Lets you mark recently posted files so fresh media is ranked first and repeats are shown less
- Splits the ranked keep list into multiple post groups with subreddit notes, scheduled times, and grouped exports
- Auto-saves the browser session on the same device so you can refresh and resume
- Exports the top files themselves as a ZIP with numbered filenames so the order stays intact
- Copies the keep list and cut list filenames as a backup

## Files

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `scriptable/GIF Ranker.js`
- `media-collector-extension/`

## Browser media collector

The `media-collector-extension` folder is a local Chrome/Edge extension. Load it unpacked from the browser extensions page, then press `Alt+Shift+D` on a supported Reddit, `redd.it`, or Redgifs page to add the largest visible media candidate to a local download queue and start downloading it.

It also adds a right-click action named `Add media to download queue`. Downloads are saved under a `media-queue` folder in your normal browser downloads directory.

For one-button collecting, run `media-collector-extension/hotkeys/media-collector-mouse.ahk` to map your rear mouse side button to the extension shortcut. Use `media-collector-extension/hotkeys/media-collector-mouse-v1.ahk` if your AutoHotkey install is v1.

## Fastest iPhone option now

Use the Scriptable version in `scriptable/GIF Ranker.js`.

1. Install Scriptable on your iPhone.
2. Create a new script and paste in `GIF Ranker.js`.
3. Put your GIFs into one Files folder.
4. Run the script and choose `Pick a folder`.

See `scriptable/README.md` for the full flow.

## Hosted web app option

If you still want the browser version:

1. Upload the `gif-ranker` folder to a static host such as Netlify Drop or GitHub Pages.
2. Open the hosted URL on your iPhone in Safari.
3. Use Share -> Add to Home Screen if you want it to feel app-like.
4. Pick your GIFs or images from Files or Photos, mark recent posts if needed, and start ranking.
5. If Safari gets sluggish, refresh and use `Resume saved session`.

## Lowest-friction hosting options

- Netlify Drop: drag the folder into [Netlify Drop](https://app.netlify.com/drop)
- GitHub Pages: push the folder to a GitHub repo and enable Pages
- Cloudflare Pages: upload the folder as a static site

## Notes

- The files stay local in the browser.
- The web app now targets your exact top list first, which is usually a better fit than fully ranking all 30 files.
- Recent-post marks push those files behind fresh media and auto-cut them once the shortlist is full.
- Short videos are previewed and exported as original files; browser-side video-to-GIF conversion is intentionally not included.
- The top media export uses numbered filenames like `01-name.gif`, `02-name.jpg`, so the order is preserved when you save or unzip it.
- The post planner can create multiple folders such as `post-01-r-example`, each with numbered files, plus a `posting-plan.txt`.
- The planner is only a local organizer. Check each subreddit rules page and avoid reposting too often.
- Saved-session restore depends on browser storage support on that device.
- The Scriptable version avoids hosting entirely and works best if your GIFs are already in the Files app.
