// Optional: ask Claude to rank layout suggestions for a page.
//
// This is off unless ANTHROPIC_API_KEY is set, and even then it runs only when
// someone clicks "Ask Claude to rank these". Each call sends the start of the
// page's text and a description of each suggestion to Anthropic, and is billed
// to that API key. The app's built-in ranking needs none of this.
import { z } from 'zod';

const MODEL = 'claude-opus-5-5';

export const aiAvailable = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const Ranking = z.object({
  ranking: z.array(
    z.object({
      name: z.string().describe('The suggestion name, exactly as given'),
      reason: z.string().describe('One short sentence, under 15 words, on why it sits at this rank'),
    }),
  ),
});

const SYSTEM = `You are an experienced book designer who lays out tabletop roleplaying game books: rulebooks, setting books and adventures.

You will be given one page's content and a set of candidate arrangements for it, each already placed precisely on the page by a layout engine. Rank the candidates from best to worst for this page.

Judge as a designer would: whether the art's shape suits where it is placed, whether the text fits and has a comfortable line length, whether the page's role (a chapter opener, a rules reference, a lore spread) is served, and the conventions of well-made game books in the stated theme. You cannot change the arrangements, only order them.

Include every candidate exactly once, using its name exactly as given. Give each a reason in one short plain sentence that a non-designer would understand.`;

let client = null;

/** Thrown with a message that is safe to show to the person using the app. */
export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} input the page and its candidate arrangements, as sent by the app
 * @returns {Promise<Array<{ name: string, reason: string }>>}
 */
export async function rankLayouts(input) {
  if (!aiAvailable()) throw new AiError('Claude ranking is not set up on this server.', 501);
  const suggestions = Array.isArray(input?.suggestions) ? input.suggestions.slice(0, 12) : [];
  if (suggestions.length < 2) throw new AiError('There is nothing to rank.', 400);
  const names = new Set(suggestions.map((s) => String(s.name)));

  // Loaded only when used, so the server starts without the SDK being exercised.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
  client ??= new Anthropic();

  const page = {
    size: `${input.page?.widthIn} x ${input.page?.heightIn} inches${input.page?.facing ? ', facing pages' : ''}`,
    theme: String(input.theme ?? 'Plain'),
    text_length_characters: Number(input.textChars) || 0,
    text_opens_with_a_heading: !!input.startsWithHeading,
    text_continues_on_the_next_page: !!input.continuesOnNextPage,
    images: Array.isArray(input.images)
      ? input.images.slice(0, 12).map((i) => ({ width_divided_by_height: Number(i.aspect) || 1 }))
      : [],
    text_opening: String(input.textSample ?? '').slice(0, 1500),
  };
  const candidates = suggestions.map((s) => ({ name: String(s.name), arrangement: String(s.description).slice(0, 600) }));

  let response;
  try {
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(Ranking) },
      messages: [
        {
          role: 'user',
          content: `Page:\n${JSON.stringify(page, null, 2)}\n\nCandidate arrangements:\n${JSON.stringify(candidates, null, 2)}`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('The Anthropic API key was rejected.', 502);
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiError('The Anthropic API key is not allowed to use this model.', 502);
    if (err instanceof Anthropic.RateLimitError) throw new AiError('Anthropic is rate-limiting this key. Try again shortly.', 429);
    if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic returned an error (${err.status ?? 'network'}).`, 502);
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new AiError('Claude declined to rank this page.', 502);
  const ranking = response.parsed_output?.ranking;
  if (!ranking) throw new AiError('Claude did not return a ranking.', 502);
  // Keep only names that were actually offered, once each.
  const seen = new Set();
  return ranking.filter((r) => names.has(r.name) && !seen.has(r.name) && seen.add(r.name));
}
