/**
 * HomeFind AI — Debug & Diagnostics System
 * 
 * Toggle on/off from browser console: window.__HF_DEBUG.toggle()
 * View current state: window.__HF_DEBUG.dump()
 * Clear logs: window.__HF_DEBUG.clear()
 * 
 * Also accessible via URL param: ?debug=true
 */

const MAX_LOG_ENTRIES = 200;

class DebugSystem {
  constructor() {
    this.enabled = false;
    this.logs = [];
    this.authEvents = [];
    this.edgeFunctionCalls = [];
    this.errors = [];
    this.queryResults = [];
    this.startTime = Date.now();

    // Auto-enable via URL param
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === 'true') {
        this.enabled = true;
      }
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    console.log(`[HF Debug] ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
    if (this.enabled) {
      console.log('[HF Debug] Commands: window.__HF_DEBUG.dump() | .clear() | .toggle() | .errors() | .auth() | .edge()');
    }
    return this.enabled;
  }

  _ts() {
    return `+${((Date.now() - this.startTime) / 1000).toFixed(1)}s`;
  }

  _add(arr, entry) {
    arr.push({ ...entry, timestamp: new Date().toISOString(), elapsed: this._ts() });
    if (arr.length > MAX_LOG_ENTRIES) arr.shift();
  }

  // ── Auth tracking ─────────────────────────────────────────────────────
  logAuth(event, detail) {
    const entry = { event, detail: typeof detail === 'object' ? { ...detail } : detail };
    this._add(this.authEvents, entry);
    if (this.enabled) {
      console.log(`[HF Auth] ${this._ts()} ${event}`, detail || '');
    }
  }

  // ── Edge Function tracking ────────────────────────────────────────────
  logEdgeCall(functionName, status, duration, detail) {
    const entry = { functionName, status, duration, detail };
    this._add(this.edgeFunctionCalls, entry);
    if (this.enabled) {
      const icon = status === 'success' ? '✓' : status === 'error' ? '✗' : '…';
      console.log(`[HF Edge] ${this._ts()} ${icon} ${functionName} (${duration || '?'}ms)`, detail || '');
    }
  }

  // ── Error tracking ────────────────────────────────────────────────────
  logError(source, error) {
    const entry = {
      source,
      message: error?.message || String(error),
      stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
      code: error?.code,
    };
    this._add(this.errors, entry);
    if (this.enabled) {
      console.error(`[HF Error] ${this._ts()} [${source}]`, error);
    }
  }

  // ── Supabase query tracking ───────────────────────────────────────────
  logQuery(table, operation, result) {
    const entry = {
      table,
      operation,
      rowCount: Array.isArray(result?.data) ? result.data.length : result?.data ? 1 : 0,
      error: result?.error?.message || null,
    };
    this._add(this.queryResults, entry);
    if (this.enabled && result?.error) {
      console.warn(`[HF Query] ${this._ts()} ${table}.${operation} ERROR:`, result.error.message);
    }
  }

  // ── General log ───────────────────────────────────────────────────────
  log(category, message, detail) {
    this._add(this.logs, { category, message, detail });
    if (this.enabled) {
      console.log(`[HF ${category}] ${this._ts()} ${message}`, detail || '');
    }
  }

  // ── Dump full state ───────────────────────────────────────────────────
  dump() {
    const state = {
      enabled: this.enabled,
      uptime: this._ts(),
      counts: {
        logs: this.logs.length,
        authEvents: this.authEvents.length,
        edgeFunctionCalls: this.edgeFunctionCalls.length,
        errors: this.errors.length,
        queries: this.queryResults.length,
      },
      recentErrors: this.errors.slice(-10),
      recentAuth: this.authEvents.slice(-10),
      recentEdge: this.edgeFunctionCalls.slice(-10),
      recentQueries: this.queryResults.slice(-10),
    };
    console.table(state.counts);
    console.log('[HF Debug] Full state:', state);
    return state;
  }

  // ── Shorthand accessors ───────────────────────────────────────────────
  auth() {
    console.table(this.authEvents.slice(-20));
    return this.authEvents.slice(-20);
  }

  edge() {
    console.table(this.edgeFunctionCalls.slice(-20));
    return this.edgeFunctionCalls.slice(-20);
  }

  errs() {
    console.table(this.errors.slice(-20));
    return this.errors.slice(-20);
  }

  clear() {
    this.logs = [];
    this.authEvents = [];
    this.edgeFunctionCalls = [];
    this.errors = [];
    this.queryResults = [];
    console.log('[HF Debug] All logs cleared');
  }

  // ── Generate diagnostic report ────────────────────────────────────────
  report() {
    const r = {
      generated: new Date().toISOString(),
      uptime: this._ts(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      localStorage: {
        hasAuthToken: !!localStorage.getItem('sb-bfnudxyxgjhdqwlcqyar-auth-token'),
        tokenLength: localStorage.getItem('sb-bfnudxyxgjhdqwlcqyar-auth-token')?.length || 0,
      },
      errors: this.errors.slice(-20),
      authEvents: this.authEvents.slice(-20),
      edgeFunctionCalls: this.edgeFunctionCalls.slice(-20),
      failedQueries: this.queryResults.filter(q => q.error).slice(-20),
    };
    const json = JSON.stringify(r, null, 2);
    console.log('[HF Debug] Diagnostic report:\n' + json);
    // Copy to clipboard
    try {
      navigator.clipboard.writeText(json);
      console.log('[HF Debug] Report copied to clipboard');
    } catch { /* ignore */ }
    return r;
  }
}

// Singleton instance
const debug = new DebugSystem();

// Expose globally for console access
if (typeof window !== 'undefined') {
  window.__HF_DEBUG = debug;
}

export default debug;
