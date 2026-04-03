// App params - simplified after Base44 removal.
// Supabase config is now handled via environment variables in supabaseClient.js.
// This file is kept for any remaining imports but no longer manages auth tokens.

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
  if (typeof window === 'undefined') return defaultValue;
  const urlParams = new URLSearchParams(window.location.search);
  const searchParam = urlParams.get(paramName);
  if (removeFromUrl && searchParam) {
    urlParams.delete(paramName);
    const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, newUrl);
  }
  return searchParam || defaultValue || null;
};

export const appParams = {
  fromUrl: getAppParamValue('from_url', { defaultValue: typeof window !== 'undefined' ? window.location.href : '' }),
};
