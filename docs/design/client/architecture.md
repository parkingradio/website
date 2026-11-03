# Architecture

The site is a single-page application: changing to another page does not require reloading the whole app. Another page
opens at its top, except when going back or forward in the browser's history.

The site declares French as its language. Times of day are shown and entered in the 24-hour format, e.g. "21 h 30": the
time fields are the browser's own, which follow the page's language in the browsers that format them by it. Pages'
paths are in French, like everything visitors and admins read, while their query parameters, and the values in them,
are in English, like the API's.

## Navigation bar

All pages share a common navigation bar at the top, from which all pages can be reached. It stays at the top of the
screen as the page scrolls, like the [player](player.md)'s bar at the bottom, except on very short screens, like a phone
held sideways, where it scrolls away to leave the page room. The navigation bar and the player's bar stay over the page:
nothing a page shows, like the suggestions under a field, is drawn over them, except what covers the whole screen on
purpose, like the Synth Meetups lightbox. On narrow screens like phones, the navigation links move into a drawer that
slides in from the left, opened by a menu button to the left of the logo.

The navigation bar also has the player's "en ondes" button (see [Navigation bar
button](player.md#navigation-bar-button)).

The "merch" entry isn't a page within the app: it's a direct external link to Parking Radio's Bigcartel store
(`https://parkingdotradio.bigcartel.com`), which handles the merch catalog, checkout, and payment entirely on its own.

The admin pages aren't linked from the navigation bar (see [Admin](admin/layout.md)).

## Configuration

The app reads [`GET /api/config`](../server/README.md#get-apiconfig) once, when it loads. Until it has it, what depends
on it waits: assets don't show, and pages that depend on a feature flag show nothing.

### Feature flags

A page that depends on a feature flag (see [Features](../server/features.md)) shows nothing until it knows whether the
flag is on, rather than switching from one version to the other in front of the visitor. When it can't know, it behaves
as if the flag were off. Since the flags are read when the app loads, visitors get a change as soon as they load a page
of the site, and a page they already have open stays as it was until they load it again.

### Assets

Static image assets, e.g. the Synth Meetups posters, are served from `assets.<domain>`, and addressed by their key, with
the domain in the configuration (see "Assets" in the [README](../../../README.md#assets)).

## Endpoints

- `GET /api/config`, for every page.
