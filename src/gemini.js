'use strict';

/**
 * Minimal Gemini API client (Google AI Studio key, REST, no SDK dependency).
 *
 * Built to degrade gracefully:
 *  - tries a short list of Flash models, newest first, and remembers the one that works
 *  - asks for JSON mode, and retries without it if the model rejects the config
 *  - every call has a hard deadline so the UI never hangs
 * The API key stays on the server and is sent in a header, never in a URL.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

let workingModel = null;

class AIError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AIError';
    this.code = code;
  }
}

function apiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function isConfigured() {
  return apiKey().length > 0;
}

function modelList() {
  const fromEnv = (process.env.GEMINI_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = [...fromEnv, ...DEFAULT_MODELS];
  if (workingModel) list.unshift(workingModel);
  return [...new Set(list)];
}

function currentModel() {
  return workingModel || modelList()[0];
}

/** Pull a JSON object out of model text, tolerating code fences and stray prose. */
function parseJsonLoose(text) {
  const stripped = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new AIError('The model did not return valid JSON.', 'bad_json');
  }
}

function extractText(payload) {
  if (payload.promptFeedback && payload.promptFeedback.blockReason) {
    throw new AIError(`Request blocked by the model (${payload.promptFeedback.blockReason}).`, 'blocked');
  }
  const parts = (((payload.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text.trim()) throw new AIError('The model returned an empty answer.', 'empty');
  return text;
}

/**
 * @param {{system: string, user: string, timeoutMs?: number}} request
 * @param {typeof fetch} [fetchImpl] injectable for tests
 * @returns {Promise<{data: object, model: string}>}
 */
async function generateJson({ system, user, timeoutMs = 50000 }, fetchImpl = fetch) {
  if (!isConfigured()) throw new AIError('GEMINI_API_KEY is not set.', 'not_configured');
  const deadline = Date.now() + timeoutMs;
  const base = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
  };
  const variants = [{ ...base, generationConfig: { responseMimeType: 'application/json' } }, base];
  let lastError = new AIError('No Gemini model was reachable.', 'unreachable');

  for (const model of modelList()) {
    for (const body of variants) {
      const remaining = deadline - Date.now();
      if (remaining < 2000) throw new AIError('The model took too long to answer.', 'timeout');
      let response;
      try {
        response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(remaining),
        });
      } catch (err) {
        lastError = new AIError(err.name === 'TimeoutError' ? 'The model took too long to answer.' : 'Could not reach the Gemini API.', 'network');
        break;
      }
      if (response.ok) {
        try {
          const data = parseJsonLoose(extractText(await response.json()));
          workingModel = model;
          return { data, model };
        } catch (err) {
          lastError = err instanceof AIError ? err : new AIError('Unreadable model response.', 'bad_json');
          continue;
        }
      }
      if (response.status === 401 || response.status === 403) {
        throw new AIError('The Gemini API key was rejected. Check GEMINI_API_KEY.', 'auth');
      }
      lastError = new AIError(`Gemini API returned HTTP ${response.status} for ${model}.`, `http_${response.status}`);
      if (response.status !== 400) break; // 404 / 429 / 5xx: move on to the next model
    }
  }
  throw lastError;
}

function resetForTests() {
  workingModel = null;
}

module.exports = { generateJson, isConfigured, currentModel, parseJsonLoose, AIError, resetForTests, DEFAULT_MODELS };
