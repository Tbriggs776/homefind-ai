import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { X, Send, Loader2, Sparkles, CalendarCheck, Undo2, Check, Search as SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase, invokeFunction, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/api/supabaseClient';
import { createPageUrl } from '@/utils';
import { sparkPhoto, PHOTO_PLACEHOLDER } from '@/lib/listingPhotos';

// ============================================================================
// AI home-search assistant (Claude, streamed from the aiChatAssistant edge
// function). Available to everyone; signed-out visitors can request a tour by
// leaving contact details on the confirmation card.
//
// Server-sent events from the function:
//   text   { delta }                       — reply text, appended as it streams
//   search { filters, count, listings }    — results card with Apply / Undo
//   tour   { property, preferred_times, note } — confirmation card
//   error  { message }, done {}
// ============================================================================

const STORAGE_KEY = 'crandell_ai_chat_v2';
const SEARCH_SESSION_KEY = 'search_state'; // Search.jsx session state
const MAX_HISTORY = 12;

const SEARCH_PROMPTS = [
  '4 bedrooms with a pool under $600k in Queen Creek',
  'Single-story homes in Gilbert with an RV garage',
  'New construction in San Tan Valley under $450k',
];
const LISTING_PROMPTS = [
  'What are the HOA fees and property taxes?',
  'Which schools is this home assigned to?',
  'Can I tour this home this weekend?',
];

// No Tailwind typography plugin in this project, so style markdown directly.
const MARKDOWN_COMPONENTS = {
  p: (props) => <p className="my-1 first:mt-0 last:mb-0" {...props} />,
  ul: (props) => <ul className="my-1 list-disc pl-5 space-y-0.5" {...props} />,
  ol: (props) => <ol className="my-1 list-decimal pl-5 space-y-0.5" {...props} />,
  a: (props) => <a className="text-primary underline" target="_blank" rel="noopener noreferrer" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
};

const formatPrice = (n) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
    : '';

// search_listings filters → the shape Search.jsx keeps in state.
function toSearchPageFilters(f) {
  const out = { ...f };
  if (Array.isArray(f.cities) && f.cities.length) {
    out.cities = f.cities;
    out.cities_label = f.cities.join(', ');
    out.city = '';
  }
  return out;
}

function summarizeFilters(f) {
  const parts = [];
  if (f.cities?.length) parts.push(f.cities.join(', '));
  if (f.subdivision) parts.push(f.subdivision);
  if (f.zip_code) parts.push(f.zip_code);
  if (f.min_price && f.max_price) parts.push(`${formatPrice(f.min_price)}–${formatPrice(f.max_price)}`);
  else if (f.max_price) parts.push(`under ${formatPrice(f.max_price)}`);
  else if (f.min_price) parts.push(`${formatPrice(f.min_price)}+`);
  if (f.bedrooms) parts.push(`${f.bedrooms}+ bd`);
  if (f.bathrooms) parts.push(`${f.bathrooms}+ ba`);
  if (f.property_types?.length) parts.push(f.property_types.map((t) => t.replace(/_/g, ' ')).join('/'));
  if (f.private_pool) parts.push('pool');
  if (f.single_story) parts.push('single story');
  if (f.rv_garage) parts.push('RV garage');
  if (f.hoa_filter === 'no') parts.push('no HOA');
  return parts.join(' · ');
}

function loadConversation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token || SUPABASE_ANON_KEY;
  return { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
}

// Minimal SSE reader over fetch — EventSource can't POST.
async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) {
        try { yield { event, data: JSON.parse(data) }; } catch { /* ignore malformed chunk */ }
      }
    }
  }
}

export default function AIAssistant({ user, filters, propertyId, onApplyFilters }) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(loadConversation);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30))); } catch { /* storage full/blocked */ }
  }, [messages]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Focus management + Escape to close; lock page scroll while full-screen on phones.
  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const prevOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  const updateLast = useCallback((fn) => {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }, []);

  const send = async (text) => {
    const message = text.trim();
    if (!message || isStreaming) return;
    setInput('');

    const history = messages
      .filter((m) => m.text)
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.text }));

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', text: message },
      { id: crypto.randomUUID(), role: 'assistant', text: '', cards: [] },
    ]);
    setIsStreaming(true);

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/aiChatAssistant`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          message,
          history,
          context: { ...(propertyId ? { propertyId } : {}), ...(filters ? { filters } : {}) },
        }),
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        updateLast((m) => ({ ...m, text: err.error || 'The assistant is unavailable right now. Call Tanner at (480) 544-1539.', error: true }));
        return;
      }

      for await (const { event, data } of readEvents(response)) {
        if (event === 'text') updateLast((m) => ({ ...m, text: m.text + data.delta }));
        else if (event === 'search') updateLast((m) => ({ ...m, cards: [...m.cards, { type: 'search', ...data }] }));
        else if (event === 'tour') updateLast((m) => ({ ...m, cards: [...m.cards, { type: 'tour', ...data }] }));
        else if (event === 'error') updateLast((m) => ({ ...m, text: m.text || data.message, error: !m.text }));
      }
    } catch {
      updateLast((m) => ({ ...m, text: m.text || 'Connection lost. Please try again.', error: !m.text }));
    } finally {
      setIsStreaming(false);
    }
  };

  const setCard = (messageId, cardIndex, patch) =>
    setMessages((prev) => prev.map((m) =>
      m.id !== messageId ? m : { ...m, cards: m.cards.map((c, i) => (i === cardIndex ? { ...c, ...patch } : c)) },
    ));

  const applySearch = (messageId, cardIndex, card) => {
    const next = toSearchPageFilters(card.filters);
    if (onApplyFilters) {
      setCard(messageId, cardIndex, { applied: true, previous: filters ?? {} });
      onApplyFilters(next);
      if (window.matchMedia('(max-width: 767px)').matches) close();
    } else {
      try { sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify({ filters: next, currentPage: 1 })); } catch { /* ignore */ }
      navigate(createPageUrl('Search'));
    }
  };

  const undoSearch = (messageId, cardIndex, card) => {
    onApplyFilters?.(card.previous ?? {});
    setCard(messageId, cardIndex, { applied: false });
  };

  const prompts = propertyId ? LISTING_PROMPTS : SEARCH_PROMPTS;
  const firstName = user?.full_name?.split(' ')[0];

  if (!isOpen) {
    return (
      <button
        ref={openerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed right-4 md:right-6 z-40 h-12 md:h-14 pl-4 pr-5 rounded-full bg-secondary text-secondary-foreground shadow-2xl flex items-center gap-2 hover:bg-[var(--crandell-charcoal-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        style={{ bottom: `calc(env(safe-area-inset-bottom) + ${propertyId ? '5.5rem' : '4rem'})` }}
        aria-label="Open the AI home search assistant"
      >
        <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        <span className="text-sm font-medium uppercase tracking-[0.08em]">Ask AI</span>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI home search assistant"
      className="fixed z-[60] inset-0 md:inset-auto md:right-6 md:bottom-16 md:w-[26rem] md:h-[min(40rem,calc(100dvh-8rem))] bg-white md:rounded-xl md:border md:border-border shadow-2xl flex flex-col"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-secondary text-secondary-foreground md:rounded-t-xl" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-5 w-5 text-primary flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium leading-tight">Home Search Assistant</p>
            <p className="text-xs text-white/60 truncate">Crandell Real Estate Team</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && !isStreaming && (
            <button type="button" onClick={() => setMessages([])} className="text-xs text-white/70 hover:text-white px-2 py-1">
              New chat
            </button>
          )}
          <button type="button" onClick={close} aria-label="Close assistant" className="p-2 rounded-md hover:bg-white/10">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={logRef} role="log" aria-live="polite" className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-muted/40">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Hi{firstName ? ` ${firstName}` : ''}! {propertyId
                ? 'Ask me anything about this home — HOA, taxes, schools, features — or ask to see it in person.'
                : 'Describe the home you want and I\'ll search every active Arizona listing for you.'}
            </p>
            <div className="flex flex-col gap-2">
              {prompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => send(p)}
                  className="text-left text-sm px-3 py-2 rounded-lg border border-border bg-white hover:border-primary hover:text-primary transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'space-y-2'}>
            {m.role === 'user' ? (
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">{m.text}</p>
            ) : (
              <>
                {(m.text || isStreaming) && (
                  <div className={`max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm bg-white border border-border ${m.error ? 'text-destructive' : 'text-foreground'}`}>
                    {m.text ? (
                      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{m.text}</ReactMarkdown>
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Thinking" />
                    )}
                  </div>
                )}
                {m.cards?.map((card, i) =>
                  card.type === 'search' ? (
                    <SearchCard
                      key={i}
                      card={card}
                      canApplyInPlace={!!onApplyFilters}
                      onApply={() => applySearch(m.id, i, card)}
                      onUndo={() => undoSearch(m.id, i, card)}
                    />
                  ) : (
                    <TourCard key={i} card={card} user={user} onDone={(patch) => setCard(m.id, i, patch)} />
                  ),
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="border-t border-border bg-white px-3 py-3 md:rounded-b-xl"
      >
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={propertyId ? 'Ask about this home…' : 'Describe your ideal home…'}
            maxLength={2000}
            disabled={isStreaming}
            aria-label="Message the assistant"
            className="flex-1"
          />
          <Button type="submit" variant="brand" size="icon" disabled={isStreaming || !input.trim()} aria-label="Send">
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          AI can make mistakes. Listing data from ARMLS, deemed reliable but not guaranteed.
        </p>
      </form>
    </div>
  );
}

function SearchCard({ card, canApplyInPlace, onApply, onUndo }) {
  const summary = summarizeFilters(card.filters);
  return (
    <div className="max-w-[92%] rounded-xl border border-border bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <p className="text-sm font-medium text-foreground">
          {card.count.toLocaleString()} {card.count === 1 ? 'home matches' : 'homes match'}
        </p>
        {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
      </div>
      {card.listings?.slice(0, 3).map((l) => (
        <Link
          key={l.id}
          to={`${createPageUrl('PropertyDetail')}?id=${l.id}`}
          className="flex gap-3 px-3 py-2 hover:bg-muted/60 border-b border-border last:border-b-0"
        >
          <img
            src={sparkPhoto(l.primary_photo_url || PHOTO_PLACEHOLDER, 'thumb')}
            alt=""
            loading="lazy"
            className="h-12 w-16 rounded object-cover bg-muted flex-shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{formatPrice(l.price)}</p>
            <p className="text-xs text-muted-foreground truncate">
              {l.bedrooms} bd · {l.bathrooms} ba{l.square_feet ? ` · ${l.square_feet.toLocaleString()} sqft` : ''} · {l.city}
            </p>
          </div>
        </Link>
      ))}
      {card.count > 0 && (
        <div className="px-3 py-2 bg-muted/40">
          {card.applied ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground flex items-center gap-1"><Check className="h-3.5 w-3.5 text-primary" /> Applied to your search</span>
              <button type="button" onClick={onUndo} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
            </div>
          ) : (
            <Button variant="brand" size="sm" className="w-full" onClick={onApply}>
              <SearchIcon className="h-4 w-4" />
              {canApplyInPlace ? 'Apply to my search' : `See all ${card.count.toLocaleString()}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function TourCard({ card, user, onDone }) {
  const [name, setName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const { property } = card;

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const note = [card.preferred_times && `Availability: ${card.preferred_times}`, card.note].filter(Boolean).join('\n');
      const res = await invokeFunction('contactAgentForProperty', {
        property: { id: property.id },
        intent: 'tour',
        message: note,
        source: 'ai_chat',
        ...(user ? {} : { contact: { name, email, phone } }),
      });
      if (res?.success) onDone({ sent: true });
      else setError(res?.error || "We couldn't send that. Please call (480) 544-1539.");
    } catch (err) {
      const body = await err?.context?.json?.().catch(() => null);
      setError(body?.error || "We couldn't send that. Please call (480) 544-1539.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-[92%] rounded-xl border-2 border-primary bg-white p-3 space-y-2">
      <div className="flex items-start gap-2">
        <CalendarCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">Tour {property.address}, {property.city}</p>
          <p className="text-xs text-muted-foreground">
            {formatPrice(property.price)}{card.preferred_times ? ` · ${card.preferred_times}` : ''}
          </p>
        </div>
      </div>

      {card.sent ? (
        <p className="text-sm text-green-800 bg-green-50 rounded-md px-3 py-2">Sent to Tanner. He'll reach out to set up a time.</p>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          {!user && (
            <>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required maxLength={100} aria-label="Your name" />
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required maxLength={200} aria-label="Email" />
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" maxLength={30} aria-label="Phone (optional)" />
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" variant="brand" size="sm" className="w-full" disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
            Request this tour
          </Button>
          <p className="text-[11px] text-muted-foreground">Goes to Tanner Crandell, Crandell Real Estate Team · Balboa Realty.</p>
        </form>
      )}
    </div>
  );
}
