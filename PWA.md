# Mughal Accounts PWA

The GitHub Pages app can be installed from its existing HTTPS address. No new
hosting service, database migration, or app-store submission is required.

## Install after deployment

- Android / compatible desktop browsers: use **Install app** when the browser
  offers installation, or use the browser's install menu.
- iPhone / iPad: open the site in Safari, select **Share → Add to Home Screen**,
  leave **Open as Web App** enabled if offered, then select **Add**.
- Open the new Mughal Accounts icon. It launches without the normal browser
  toolbar. The installed app may require a separate sign-in.

## Internet and privacy

Accounting remains online. The service worker stores only `offline.html` and the
public app icon. It does not store the main app HTML, account records, API
responses, credentials, or transaction requests in Cache Storage. It does not
queue or replay transactions. Existing session storage is unchanged.

After an online visit installs the service worker, an offline launch shows a
reconnect screen instead of stale accounting data. An already-open app displays
an offline notice. No automatic reload occurs when connection returns, so forms
remain untouched. A first-ever visit still needs internet.

## Updates and maintenance

- Keep manifest `id`, `start_url`, and `scope` relative to the repository directory.
- Keep `sw.js` at the repository root. Its scope must not cover other GitHub Pages
  apps belonging to the same account.
- App HTML is fetched from the network on launch. Continue bumping changed CSS/JS
  query versions in `index.html`, as in previous releases.
- When changing the offline page or cached icon, bump the `sw.js` cache version.
  When the worker changes, existing windows show **Update available**. Reloading
  requires confirmation and is blocked while a save is in progress. Other open
  windows are not forcibly reloaded.
- Cache cleanup only removes old caches belonging to this app's exact scope.
- Icons package the existing logo on white square canvases. The maskable icon
  keeps the logo inside its central safe area. The source logo is unchanged.

## Verification

Automated coverage is in `tests/pwa.test.cjs`. Run the full suite with the
instructions in `tests/README.md`.

A real-browser/device installation pass is still required after deployment:

1. Inspect the manifest and worker in browser developer tools; confirm the
   repository scope, valid PNG icons, and successful worker activation.
2. Install on Android/desktop and on iPhone/iPad. Confirm logo, standalone launch,
   sign-in, safe-area spacing, and screen-specific header colours.
3. Navigate through reports and confirm the bottom header shadow.
4. Go offline and reload after an online visit: expect the reconnect page, not
   balances or a cleared session. Reconnect and choose **Try again**.
5. Inspect Cache Storage: only the reconnect page and icon should be present.
6. Deploy a worker revision with a form open: confirm no automatic reload. Cancel
   the update confirmation, then save the form and accept the update.

References:
- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [WebKit: Home Screen web apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [MDN: Waiting service workers](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/waiting)
