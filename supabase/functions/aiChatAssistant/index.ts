import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { z } from 'npm:zod@4.6.5';
import { supabaseAdmin, corsHeaders, jsonResponse, getUser } from '../_shared/supabaseAdmin.ts';
import {
  BOOLEAN_FILTERS, PROPERTY_TYPES, STATUSES,
  getListing, searchListings, type ListingFilters,
} from '../_shared/listingSearch.ts';

/**
 * aiChatAssistant — Crandell Home Intelligence chat (Claude, streaming).
 *
 * POST { message, history?: [{role, content}], context?: { propertyId?, filters? } }
 * Responds with Server-Sent Events:
 *   text    { delta }                          streamed reply text
 *   search  { filters, count, listings }       search_listings ran — client shows Apply/Undo
 *   tour    { property, preferred_times, note } propose_tour ran — client shows confirm card
 *   error   { message }
 *   done    {}
 *
 * Open to signed-out visitors (most of the site's traffic) with a per-IP
 * daily cap; signed-in users get a higher per-user cap and their
 * conversations are saved. Nothing is ever submitted to the CRM from here —
 * propose_tour only shows a card; the buyer confirms it through
 * contactAgentForProperty.
 */

const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY_TURNS = 12;
const MAX_MESSAGE_CHARS = 2000;
const DAILY_LIMIT_ANON = 20;
const DAILY_LIMIT_USER = 60;

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

// ---------------------------------------------------------------------------
// System prompt — stable across requests so it stays in the prompt cache.
// Page context and the listing record go in the latest user turn instead.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the home-search assistant on Crandell Home Intelligence (search.crandellrealestate.com), the property search site of the Crandell Real Estate Team at Balboa Realty. The team — Tanner and Cailie Crandell — is based in Queen Creek and specializes in the East Valley of the Phoenix, Arizona metro (Queen Creek, San Tan Valley, Gilbert, Mesa, Chandler), though the site lists every active home in Arizona from ARMLS.

What you do:
- Help buyers find homes. When someone describes what they want, call search_listings with the matching filters, then reply with the count and one or two sentences on the results. The site shows the matching homes as cards with an Apply button, so don't list every home in text.
- Answer questions about a specific listing using only its record (from the page context or get_listing). If the record doesn't say, answer "The listing doesn't say — Tanner can find out," never guess.
- When a buyer wants to see a home or talk to someone, call propose_tour. The site then shows them a confirmation card; the request only goes to Tanner after they confirm, so never say a tour is booked or scheduled.

How to use search_listings:
- Only include filters the buyer actually asked for. Translate plain language: "under 600k" means max_price 600000; "at least 3 bedrooms" means bedrooms 3; "a pool" means private_pool true; "one story" means single_story true; "no HOA" means hoa_filter "no".
- Filters add to the buyer's current search (given in the page context) unless they clearly want to start over, in which case set replace to true.
- City names go in cities. Neighborhood or subdivision names go in subdivision. A street address or anything else goes in query_text.
- If a search returns 0 homes, say so and suggest the one filter most worth loosening.

Fair housing (required by law — follow exactly):
- Never describe, rank, or recommend areas by safety, crime, demographics, race, religion, national origin, disability, or familial status. Don't call anywhere "family-friendly", "good for kids", "safe", "up-and-coming", or "a good neighborhood".
- Don't steer a buyer toward or away from an area based on who they are or who lives there.
- Never rate schools. You may state the assigned schools from a listing's record, and point buyers to the Arizona School Report Cards (azreportcards.azed.gov) to research them.
- If asked about safety or demographics, say you can't characterize areas that way and suggest neutral sources: the local police department's crime map or the U.S. Census Bureau (data.census.gov).
- Only use the 55+ (age_restricted_55plus) filter when the buyer explicitly asks for a 55+ or age-restricted community.

Style:
- Short and conversational: two to four sentences, or a few short bullets. Plain text; no tables or headings.
- Prices like $549,900. No emoji.
- Don't give legal, tax, lending, or investment advice. For financing, suggest getting pre-approved and offer to connect them with Tanner.
- Listing information comes from ARMLS and is deemed reliable but not guaranteed; mention that the buyer should verify details when it matters (HOA rules, taxes, square footage).`;

// ---------------------------------------------------------------------------
// Tools. Inputs are validated with zod before running: with eager input
// streaming the API no longer validates them, and the SDK's tolerant parser
// can hand back a truncated object.
// ---------------------------------------------------------------------------
const booleanShape = Object.fromEntries(BOOLEAN_FILTERS.map((k) => [k, z.boolean().optional()]));
const FiltersInput = z.object({
  replace: z.boolean().optional(),
  status: z.enum(STATUSES).optional(),
  cities: z.array(z.string().max(60)).max(10).optional(),
  zip_code: z.string().max(10).optional(),
  subdivision: z.string().max(80).optional(),
  query_text: z.string().max(80).optional(),
  school_name: z.string().max(80).optional(),
  min_price: z.number().nonnegative().optional(),
  max_price: z.number().nonnegative().optional(),
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().min(0).max(20).optional(),
  min_sqft: z.number().int().nonnegative().optional(),
  min_lot_size: z.number().nonnegative().optional(),
  min_garage_spaces: z.number().int().min(0).max(20).optional(),
  min_year_built: z.number().int().min(1800).max(2100).optional(),
  max_year_built: z.number().int().min(1800).max(2100).optional(),
  property_types: z.array(z.enum(PROPERTY_TYPES)).max(6).optional(),
  hoa_filter: z.enum(['yes', 'no']).optional(),
  has_virtual_tour: z.boolean().optional(),
  ...booleanShape,
});
const GetListingInput = z.object({ property_id: z.string().uuid() });
const ProposeTourInput = z.object({
  property_id: z.string().uuid(),
  preferred_times: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
});

const booleanProps = Object.fromEntries(BOOLEAN_FILTERS.map((k) => [k, { type: 'boolean' }]));

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_listings',
    description:
      "Search active Arizona MLS listings. Returns the number of matching homes and the newest few. The site shows the buyer the results with an Apply button that updates their search. Only include filters the buyer asked for. Filters merge into the buyer's current search unless replace is true.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        replace: { type: 'boolean', description: "true to start a fresh search instead of adding to the buyer's current filters" },
        status: { type: 'string', enum: [...STATUSES], description: 'Defaults to active + coming soon' },
        cities: { type: 'array', items: { type: 'string' }, description: 'City names, e.g. ["Queen Creek", "Gilbert"]' },
        zip_code: { type: 'string' },
        subdivision: { type: 'string', description: 'Neighborhood / subdivision name' },
        query_text: { type: 'string', description: 'Free text matched against address, city and subdivision' },
        school_name: { type: 'string', description: 'Assigned school name (elementary, middle or high)' },
        min_price: { type: 'number' },
        max_price: { type: 'number' },
        bedrooms: { type: 'integer', description: 'Minimum bedrooms' },
        bathrooms: { type: 'number', description: 'Minimum bathrooms' },
        min_sqft: { type: 'integer' },
        min_lot_size: { type: 'number', description: 'Acres' },
        min_garage_spaces: { type: 'integer' },
        min_year_built: { type: 'integer' },
        max_year_built: { type: 'integer' },
        property_types: { type: 'array', items: { type: 'string', enum: [...PROPERTY_TYPES] } },
        hoa_filter: { type: 'string', enum: ['yes', 'no'], description: '"no" = no HOA' },
        has_virtual_tour: { type: 'boolean' },
        ...booleanProps,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_listing',
    description:
      "Get the full record for one listing (price, beds, baths, HOA, taxes, schools, features, description). Use it to answer questions about a home from search results. Only answer from what it returns.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { property_id: { type: 'string', description: 'Listing id (uuid)' } },
      required: ['property_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_tour',
    description:
      "Show the buyer a confirmation card to request a showing of a home with Tanner Crandell. Nothing is sent until the buyer confirms on the card, so never tell them the tour is booked. Use when they want to see a home, tour it, or talk to an agent about it.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        property_id: { type: 'string', description: 'Listing id (uuid)' },
        preferred_times: { type: 'string', description: 'When the buyer said they are available, if they did' },
        note: { type: 'string', description: 'Anything the buyer wants Tanner to know' },
      },
      required: ['property_id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------
const HistoryTurn = z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) });
const RequestBody = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(HistoryTurn).max(50).optional(),
  context: z.object({
    propertyId: z.string().uuid().optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
});

// Keep the last turns, starting on a user turn, with roles alternating.
function trimHistory(history: z.infer<typeof HistoryTurn>[]): Anthropic.MessageParam[] {
  const recent = history.filter((t) => t.content.trim()).slice(-MAX_HISTORY_TURNS);
  const out: Anthropic.MessageParam[] = [];
  for (const turn of recent) {
    if (out.length === 0 && turn.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`;
    else out.push({ role: turn.role, content: turn.content });
  }
  // The new message is a user turn, so history must end on assistant.
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return out;
}

async function hashIp(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`crandell-chat:${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 12)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Current filters from the Search page, reduced to what search_listings understands.
function currentFilters(raw: Record<string, unknown> | undefined): ListingFilters {
  const parsed = FiltersInput.safeParse(raw ?? {});
  if (!parsed.success) return {};
  const { replace: _replace, ...filters } = parsed.data;
  return filters as ListingFilters;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const parsedBody = RequestBody.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return jsonResponse({ error: 'Invalid request' }, 400);
  const { message, history = [], context = {} } = parsedBody.data;

  const user = await getUser(req);
  const limitKey = user ? `chat:user:${user.id}` : `chat:ip:${await hashIp(req)}`;
  const { data: withinLimit, error: limitError } = await supabaseAdmin.rpc('ai_usage_hit', {
    p_key: limitKey,
    p_limit: user ? DAILY_LIMIT_USER : DAILY_LIMIT_ANON,
  });
  if (limitError) console.error('[aiChatAssistant] rate limit check failed:', limitError);
  if (withinLimit === false) {
    return jsonResponse({
      error: user
        ? "You've reached today's chat limit. Call or text Tanner at (480) 544-1539 anytime."
        : "You've reached today's chat limit. Sign in for more, or call Tanner at (480) 544-1539.",
    }, 429);
  }

  const baseFilters = currentFilters(context.filters);
  const pageListing = context.propertyId ? await getListing(context.propertyId).catch(() => null) : null;

  // Page context rides in the latest user turn (not the system prompt) so the
  // cached prefix stays identical across pages and visitors.
  const contextLines = [
    `Buyer is ${user ? 'signed in' : 'not signed in'}.`,
    Object.keys(baseFilters).length
      ? `Current search filters: ${JSON.stringify(baseFilters)}`
      : 'No search filters are set.',
    pageListing ? `They are viewing this listing:\n${JSON.stringify(pageListing)}` : null,
  ].filter(Boolean).join('\n');

  const messages: Anthropic.MessageParam[] = [
    ...trimHistory(history),
    {
      role: 'user',
      content: [
        { type: 'text', text: `<page_context>\n${contextLines}\n</page_context>` },
        { type: 'text', text: message },
      ],
    },
  ];

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      let replyText = '';
      let lastSearch: Record<string, unknown> | null = null;
      let jsonRetries = 0;

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const stream = client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            output_config: { effort: 'low' },
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            tools: TOOLS,
            messages,
          });
          stream.on('text', (delta) => {
            replyText += delta;
            send('text', { delta });
          });

          let final: Anthropic.Message;
          try {
            final = await stream.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            // Only a tool input that couldn't be parsed at all is retried.
            if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
            round--;
            continue;
          }

          if (final.stop_reason === 'refusal') {
            send('text', { delta: "Sorry, I can't help with that one. Tanner can — call (480) 544-1539." });
            break;
          }

          const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
          if (toolUses.length === 0) break;
          if (final.stop_reason === 'max_tokens') break; // truncated tool input: don't run it

          messages.push({ role: 'assistant', content: final.content });
          const results: Anthropic.ToolResultBlockParam[] = [];

          for (const tool of toolUses) {
            results.push(await runTool(tool, baseFilters, send, (s) => { lastSearch = s; }));
          }
          messages.push({ role: 'user', content: results });
          // Keep the visible reply readable when the model talks both before and after a tool call.
          if (replyText && !replyText.endsWith('\n')) {
            replyText += '\n\n';
            send('text', { delta: '\n\n' });
          }
        }
      } catch (err) {
        console.error('[aiChatAssistant] error:', err);
        send('error', {
          message: err instanceof Anthropic.RateLimitError
            ? 'The assistant is busy right now. Please try again in a moment.'
            : 'The assistant is unavailable right now. Call Tanner at (480) 544-1539.',
        });
      }

      if (user && replyText.trim()) {
        const { error } = await supabaseAdmin.from('chat_messages').insert([
          { user_id: user.id, role: 'user', content: message },
          { user_id: user.id, role: 'assistant', content: replyText.trim(), metadata: lastSearch ? { search: lastSearch } : null },
        ]);
        if (error) console.error('[aiChatAssistant] chat save failed:', error);
      }

      send('done', {});
      controller.close();
    },
  });

  return new Response(body, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
});

async function runTool(
  tool: Anthropic.ToolUseBlock,
  baseFilters: ListingFilters,
  send: (event: string, data: unknown) => void,
  onSearch: (search: Record<string, unknown>) => void,
): Promise<Anthropic.ToolResultBlockParam> {
  const invalid = (): Anthropic.ToolResultBlockParam => ({
    type: 'tool_result',
    tool_use_id: tool.id,
    is_error: true,
    content: JSON.stringify({ INVALID_JSON: JSON.stringify(tool.input) }),
  });
  const ok = (content: unknown): Anthropic.ToolResultBlockParam => ({
    type: 'tool_result',
    tool_use_id: tool.id,
    content: JSON.stringify(content),
  });

  try {
    if (tool.name === 'search_listings') {
      const parsed = FiltersInput.safeParse(tool.input);
      if (!parsed.success) return invalid();
      const { replace, ...changes } = parsed.data;
      const filters = { ...(replace ? {} : baseFilters), ...changes } as ListingFilters;
      const { count, listings } = await searchListings(filters, 5);
      const search = { filters, count, listings };
      onSearch({ filters, count });
      send('search', search);
      return ok({
        count,
        newest: listings.map((l) => ({
          id: l.id, address: `${l.address}, ${l.city}`, price: l.price,
          beds: l.bedrooms, baths: l.bathrooms, sqft: l.square_feet,
        })),
      });
    }

    if (tool.name === 'get_listing') {
      const parsed = GetListingInput.safeParse(tool.input);
      if (!parsed.success) return invalid();
      const listing = await getListing(parsed.data.property_id);
      return listing ? ok(listing) : ok({ error: 'Listing not found or no longer active' });
    }

    if (tool.name === 'propose_tour') {
      const parsed = ProposeTourInput.safeParse(tool.input);
      if (!parsed.success) return invalid();
      const listing = await getListing(parsed.data.property_id);
      if (!listing) return ok({ error: 'Listing not found or no longer active' });
      send('tour', {
        property: {
          id: listing.id, address: listing.address, city: listing.city, price: listing.price,
          bedrooms: listing.bedrooms, bathrooms: listing.bathrooms,
        },
        preferred_times: parsed.data.preferred_times ?? '',
        note: parsed.data.note ?? '',
      });
      return ok({ shown: 'The buyer now sees a confirmation card. The request goes to Tanner only if they confirm it.' });
    }

    return { type: 'tool_result', tool_use_id: tool.id, is_error: true, content: `Unknown tool ${tool.name}` };
  } catch (err) {
    console.error(`[aiChatAssistant] tool ${tool.name} failed:`, err);
    return { type: 'tool_result', tool_use_id: tool.id, is_error: true, content: 'Search is temporarily unavailable.' };
  }
}
