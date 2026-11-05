/** `text` as the end of a sentence: a full stop is added unless it already ends in . ? or !. */
export function endSentence(text) {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}
