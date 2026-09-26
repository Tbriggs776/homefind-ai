// ============================================================================
// Listing photo URLs
// ----------------------------------------------------------------------------
// MLS photos arrive from Spark as full-size originals
// (cdn.photos.sparkplatform.com/az/<id>-o.jpg — often 2500px / 500–900KB).
// Spark's resize CDN serves any bounding box for free, with a one-year
// immutable cache header:
//
//   https://cdn.resize.sparkplatform.com/<region>/<W>x<H>/true/<id>-o.jpg
//
// These helpers pick the right size per context so a 280px map popup doesn't
// download a 2500px photo. Some stored URLs are already resize URLs (e.g.
// 1024x768); they're normalized the same way. Non-Spark URLs pass through
// untouched.
// ============================================================================

const SPARK_PHOTO = /^https:\/\/cdn\.(?:photos|resize)\.sparkplatform\.com\/([a-z0-9]+)\/(?:\d+x\d+\/true\/)?([^/?#]+)$/i;

// Bounding boxes, 4:3. Spark fits the image inside the box, so actual
// dimensions vary with each photo's aspect ratio.
export const PHOTO_SIZES = {
  thumb: [300, 225],   // map popups, compare thumbnails
  card: [640, 480],    // listing cards
  large: [1024, 768],  // detail gallery
  xl: [1600, 1200],    // fullscreen / retina detail
};

export const PHOTO_PLACEHOLDER = '/placeholder-home.svg';

function parse(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(SPARK_PHOTO);
  return m ? { region: m[1], file: m[2] } : null;
}

export function sparkPhoto(url, size = 'card') {
  const parsed = parse(url);
  if (!parsed) return url || PHOTO_PLACEHOLDER;
  const [w, h] = PHOTO_SIZES[size] ?? PHOTO_SIZES.card;
  return `https://cdn.resize.sparkplatform.com/${parsed.region}/${w}x${h}/true/${parsed.file}`;
}

export function originalPhoto(url) {
  const parsed = parse(url);
  return parsed ? `https://cdn.photos.sparkplatform.com/${parsed.region}/${parsed.file}` : url;
}

// srcset across the given sizes; undefined for non-Spark URLs (plain src).
export function sparkSrcSet(url, sizes = ['thumb', 'card', 'large']) {
  if (!parse(url)) return undefined;
  return sizes.map((s) => `${sparkPhoto(url, s)} ${PHOTO_SIZES[s][0]}w`).join(', ');
}

// Props for an <img> showing a listing photo at a given size, with srcset
// and a fallback chain: resized → original → placeholder.
export function listingPhotoProps(url, size = 'card', srcSetSizes) {
  return {
    src: sparkPhoto(url, size),
    srcSet: srcSetSizes ? sparkSrcSet(url, srcSetSizes) : undefined,
    'data-original': originalPhoto(url) || '',
    onError: handlePhotoError,
  };
}

export function handlePhotoError(e) {
  const img = e.currentTarget;
  const original = img.dataset.original;
  if (original && img.dataset.fallback !== 'original' && img.src !== original) {
    img.dataset.fallback = 'original';
    img.removeAttribute('srcset');
    img.src = original;
    return;
  }
  if (img.dataset.fallback !== 'placeholder') {
    img.dataset.fallback = 'placeholder';
    img.removeAttribute('srcset');
    img.src = PHOTO_PLACEHOLDER;
  }
}

// Warm the browser cache for photos the user is likely to see next.
export function preloadPhotos(urls, size = 'card') {
  for (const url of urls) {
    if (!url) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = sparkPhoto(url, size);
  }
}

// React 18 doesn't know the camelCase `fetchPriority` prop (warns and drops
// it) and ESLint's react/no-unknown-property rejects the lowercase DOM
// attribute, so it's spread from here. Drop this once on React 19.
export const HIGH_FETCH_PRIORITY = { fetchpriority: 'high' };
