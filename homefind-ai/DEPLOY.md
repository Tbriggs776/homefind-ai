# HomeFind AI — Deployment Guide

## What This Is
Production React/Vite frontend for crandellrealestate.com, wired to Supabase backend with 1,000 ARMLS IDX-compliant active listings. Full ARMLS Rules Section 23 compliance baked into every page.

## Architecture
```
Frontend: React 18 + Vite + React Router
Backend:  Supabase (Postgres + PostGIS + Edge Functions)
Auth:     Supabase Auth (email/password + magic link)
Data:     Spark Replication API → Supabase sync → Client queries
Hosting:  Vercel (crandellrealestate.com)
```

## ARMLS Compliance (Built In)
| Rule    | Requirement                              | Component             |
|---------|------------------------------------------|-----------------------|
| 23.3.7  | Brokerage name on every page (no scroll) | `BrokerageHeader`     |
| 23.3.9  | Brokerage name fully spelled out         | "Balboa Realty, LLC"  |
| 23.2.12 | Listing firm + agent contact per listing | `ListingAttribution`  |
| 23.3.3  | ARMLS data source attribution            | `ARMLSDisclaimer`     |
| 23.3.4  | Accuracy disclaimer                      | `ARMLSDisclaimer`     |
| 23.3.3  | Source badge on cards                    | `ARMLSSourceBadge`    |
| 23.3.5  | Active listings only                     | Supabase `.eq('status','active')` |

## Step 1: Local Setup

```bash
# Clone and install
cd C:\Users\Tyler\OneDrive\Documents\GitHub
# Replace the existing homefind-ai contents with these files, or:
# Copy everything into the existing repo

cd homefind-ai
npm install

# Set your Supabase anon key
# Edit .env.local → replace YOUR_LEGACY_ANON_KEY_HERE with your actual key
# (Supabase Dashboard → Settings → API Keys → Legacy tab → anon key)

# Run locally
npm run dev
# → http://localhost:5173
```

## Step 2: Push to GitHub

```bash
git add -A
git commit -m "feat: Supabase frontend - ARMLS compliant, Vercel-ready"
git push origin main
```

## Step 3: Deploy to Vercel

1. Go to https://vercel.com/new
2. Import the `Tbriggs776/homefind-ai` GitHub repo
3. Framework Preset: **Vite**
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Environment Variables (add both):
   - `VITE_SUPABASE_URL` = `https://bfnudxyxgjhdqwlcqyar.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your legacy anon key (JWT starting with eyJhbG...)
7. Deploy

## Step 4: Connect Domain

1. In Vercel → Project Settings → Domains
2. Add `crandellrealestate.com`
3. Vercel will show DNS records to add
4. Go to your domain registrar and update DNS:
   - **A record**: `76.76.21.21`
   - **CNAME**: `cname.vercel-dns.com` (for www)
5. Wait for DNS propagation (usually < 30 min)
6. Vercel auto-provisions SSL

## Step 5: Update Supabase Auth Redirect

1. Supabase Dashboard → Authentication → URL Configuration
2. Set Site URL: `https://crandellrealestate.com`
3. Add redirect URLs:
   - `https://crandellrealestate.com/**`
   - `https://www.crandellrealestate.com/**`
   - `http://localhost:5173/**` (for local dev)

## File Structure
```
homefind-ai/
├── index.html
├── package.json
├── vite.config.js
├── vercel.json                    # SPA routing + cache headers
├── .env.local                     # Supabase keys (not committed)
├── .gitignore
└── src/
    ├── main.jsx                   # Entry point
    ├── App.jsx                    # Router + ComplianceLayout
    ├── index.css                  # Global styles (Crandell brand)
    ├── api/
    │   ├── supabaseClient.js      # Supabase init
    │   └── useSupabase.js         # All data access hooks
    ├── lib/
    │   └── AuthContext.jsx        # Supabase Auth provider
    ├── components/
    │   ├── ARMLSCompliance.jsx    # IDX compliance components
    │   ├── ListingCard.jsx        # Property card (grid)
    │   └── Navbar.jsx             # Navigation
    └── pages/
        ├── Home.jsx               # Hero + featured listings
        ├── Search.jsx             # Filter + pagination + grid
        ├── PropertyDetail.jsx     # Full listing detail
        ├── AuthPage.jsx           # Sign in / up / magic link
        └── SavedProperties.jsx    # User's saved listings
```

## What's Already Done (Backend)
- 1,000 active ARMLS listings in Supabase with all compliance fields
- Edge Functions: syncSparkApiListings (MlsStatus Active filter), checkInactiveListings
- PostGIS: nearby_properties() RPC
- Full-text search: search_properties() RPC
- RLS policies on all tables
- 3 cron jobs running (sync, purge, token refresh)

## Next Steps After Deploy
1. Verify all pages show ARMLS compliance elements
2. Test search filters, pagination, property detail
3. Test auth flow (sign up, sign in, save properties)
4. Monitor Spark sync cron in Supabase logs
5. Consider adding: map view, AI chat assistant, virtual tours
