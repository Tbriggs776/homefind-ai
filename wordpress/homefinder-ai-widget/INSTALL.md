# homeFinder AI Featured Listings — Install Guide

## 5-Step Installation

**Step 1 — Zip the plugin folder**

From the directory containing `homefinder-ai-widget/`, run:

```bash
zip -r homefinder-ai-widget.zip homefinder-ai-widget/
```

(Windows PowerShell alternative: `Compress-Archive -Path homefinder-ai-widget -DestinationPath homefinder-ai-widget.zip`)

**Step 2 — Upload to WordPress**

In your WP admin dashboard go to:
Plugins > Add New Plugin > Upload Plugin

Choose the zip file you just created, click **Install Now**, then **Activate Plugin**.

**Step 3 — Enter your API credentials**

Go to **Settings > homeFinder AI** and fill in:

| Field | Where to find it |
|-------|-----------------|
| Supabase Project URL | Supabase dashboard > Project Settings > API > Project URL |
| Supabase Anon Key | Supabase dashboard > Project Settings > API > `anon` public key |
| homeFinder Base URL | Leave as `https://homefind.ai` unless you self-host |
| Default Card Limit | How many cards to show (1–24, default 6) |
| Default Layout | Grid / Carousel / List |

Click **Save Changes**.

**Step 4 — Embed on any page or sidebar**

- **Shortcode** — paste `[homefinder_featured]` into any page, post, or text block.
  Optional attributes: `limit="6" layout="grid" columns="3"`
- **Gutenberg block** — open the block inserter, search "homeFinder Featured Listings", and click to insert. Adjust settings in the right-hand inspector panel.
- **Classic widget** — go to Appearance > Widgets, drag "homeFinder AI Featured Listings" to any sidebar.

**Step 5 — Verify**

Preview the page. You should see live featured property cards linking back to homefind.ai. If you see "No featured listings available right now", double-check your Supabase URL and anon key in the settings page.

---

### Notes

- Cards are cached for 15 minutes server-side. To force a refresh, resave the settings page.
- The ARMLS logo, disclaimer, and agent contact fields are included automatically when `listing_source === 'flexmls_idx'` — no extra configuration needed.
- Carousel keyboard navigation: Arrow Left / Arrow Right when focus is inside the carousel.
- To uninstall cleanly: deactivate then delete the plugin from WP admin. All options and cached data are removed automatically via `uninstall.php`.
