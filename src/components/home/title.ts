// The house name as the stacked display title of the start page: "Dům / pod ořechem", "Walnut / House". The first line is the first
// word, set in Geist; the rest is the second line in the accent voice. Pure, so the server splits the name and the unit tests pin it.

/**
 * Splits a name after its first word. A one-letter word (a Czech preposition or conjunction: "v", "k", "a") never ends the first
 * line, it is glued to the word after it ("V sadu u lesa" -> ["V sadu", "u lesa"]). Only a plain space breaks: a no-break space
 * written by nb() keeps its words together. A one-word name returns an empty second part.
 */
export function splitTitle(name: string): [string, string] {
  const text = name.trim();
  // the first plain space that does not follow a one-letter word (start of the text or whitespace, then a single letter)
  const m = /^(.+?)(?<!(?:^|\s)\p{L}) +(\S.*)$/su.exec(text);
  return m ? [m[1], m[2]] : [text, ""];
}
