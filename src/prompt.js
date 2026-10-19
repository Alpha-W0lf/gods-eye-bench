/**
 * The one task prompt every harness receives. Changing its wording changes
 * results, so any change bumps PROMPT_VERSION, which every run records.
 */

export const PROMPT_VERSION = 2;

/** How each answer type is asked for. */
function answerRule({ type, unit }) {
  const inUnit = unit ? ` in ${unit}` : '';
  if (type === 'integer') return `"answer" must be a whole number${inUnit}.`;
  if (type === 'number') return `"answer" must be a number${inUnit}.`;
  return '"answer" must be a string, spelled as the tools give it.';
}

/** The full prompt for a question. */
export function buildPrompt(question) {
  return [
    'Answer this question about the world using only the God\'s Eye View tools (the "gev" MCP server). Do not use any other tool, website or prior knowledge for the data.',
    '',
    `Question: ${question.prompt}`,
    '',
    'End your reply with exactly one line in this form, with nothing after it:',
    'ANSWER: {"answer": <your answer, or null if the data is unavailable>, "data_status": "complete" | "stale" | "unavailable"}',
    '',
    answerRule(question.answer),
    'data_status is "complete" if the tools returned the data you needed and did not say it may be out of date; "stale" if they returned it but said it may be out of date (still give the answer); "unavailable" if they could not return it, for example because of an error, a missing key or a feed that is down (then "answer" is null).',
    'If the tools returned the data and it shows that what the question asks about does not exist, "answer" is null and data_status is "complete".',
  ].join('\n');
}
