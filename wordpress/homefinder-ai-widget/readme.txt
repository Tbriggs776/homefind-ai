=== homeFinder AI Featured Listings ===
Contributors:       homefinderai
Tags:               real estate, property listings, homefinder, featured listings, widget
Requires at least:  6.0
Tested up to:       6.7
Requires PHP:       8.0
Stable tag:         1.0.0
License:            GPL-2.0-or-later
License URI:        https://www.gnu.org/licenses/gpl-2.0.html

Embed featured property cards from homeFinder AI on any WordPress site via shortcode, Gutenberg block, or classic widget.

== Description ==

**homeFinder AI Featured Listings** pulls live featured property data from your homeFinder AI Supabase backend and renders attractive, responsive property cards directly on your WordPress site. Each card links back to the full property detail page on homefind.ai.

= Features =

* Three embed methods: shortcode, Gutenberg block, and classic sidebar widget
* Three layout modes: Grid, Carousel, and List
* Responsive grid (1 col mobile / 2 col tablet / up to 4 col desktop)
* Status badges: Active (green), Coming Soon (purple), Pending (amber)
* "New" badge for listings on market 7 days or fewer
* "Price Reduced" badge when list price has been cut
* ARMLS compliance: office name, agent contact, disclaimer, and ARMLS logo
* 15-minute server-side transient cache (no client-side API key exposure)
* No build tools required — pure PHP + vanilla JS
* All output properly escaped; follows WordPress Coding Standards

= Usage =

**Shortcode:**
`[homefinder_featured]`
`[homefinder_featured limit="6" layout="grid" columns="3"]`

**Gutenberg block:**
Search for "homeFinder Featured Listings" in the block inserter (Widgets category).

**Classic widget:**
Navigate to Appearance > Widgets and add the "homeFinder AI Featured Listings" widget.

== Installation ==

1. Download or zip the `homefinder-ai-widget` folder.
2. In WordPress admin go to Plugins > Add New > Upload Plugin.
3. Upload the zip file and click Install Now, then Activate.
4. Go to Settings > homeFinder AI. Enter your Supabase Project URL and Supabase Anon Key. Optionally override the homeFinder Base URL and default display settings.
5. Add `[homefinder_featured]` to any page or post, drop the block into the editor, or add the widget to a sidebar.

== Frequently Asked Questions ==

= Where do I find my Supabase URL and anon key? =
In your Supabase dashboard, go to Project Settings > API. The Project URL and `anon` public key are displayed there.

= Can I change the number of cards shown? =
Yes. Set a default in Settings > homeFinder AI, or override per-instance with the `limit` shortcode attribute (1–24).

= Does the widget slow down my site? =
No. Data is fetched server-side and cached for 15 minutes via WP transients. Frontend pages are served from cache with no external API call.

= How do I clear the cache? =
Deactivate and reactivate the plugin, or wait for the 15-minute transient to expire. Advanced: delete options matching `_transient_hfai_featured_*` from wp_options.

= Is the anon key exposed to site visitors? =
No. The fetch happens in PHP on the server. The anon key is stored as a WP option and never output to the browser.

== Screenshots ==

1. Grid layout — three columns with property cards.
2. Carousel layout with prev/next navigation.
3. List layout with horizontal card orientation.
4. Settings page under Settings > homeFinder AI.
5. Gutenberg block inspector controls.

== Changelog ==

= 1.0.0 =
* Initial release.
* Grid, Carousel, and List layouts.
* Gutenberg block with ServerSideRender preview.
* Classic WP_Widget.
* Shortcode with transient caching.
* Full ARMLS compliance display (office, agent contact, disclaimer, logo).
* Uninstall cleanup of all options and transients.

== Upgrade Notice ==

= 1.0.0 =
Initial release. No upgrade steps required.
