import type { KnowledgeChunk } from "./loader";

export interface RetrievalHit {
  chunk: KnowledgeChunk;
  score: number;
}

export interface Retriever {
  search(query: string, limit?: number): RetrievalHit[];
}

const STOPWORDS = new Set(
  (
    "a an and are as at be by can do does for from has have how i if in is it me my of on or " +
    "our so that the their there this to was we what when where which who will with you your"
  ).split(" "),
);

/**
 * A deliberately small stemmer: enough for "payment" to match "pay" and "cancelling"
 * to match "cancel". It only has to be consistent between queries and documents.
 */
function stem(token: string): string {
  let word = token;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) word = word.slice(0, -1);
  let stripped = false;
  if (word.length > 6 && word.endsWith("ment")) {
    word = word.slice(0, -4);
  } else if (word.length > 5 && word.endsWith("ing")) {
    word = word.slice(0, -3);
    stripped = true;
  } else if (word.length > 4 && word.endsWith("ed")) {
    word = word.slice(0, -2);
    stripped = true;
  }
  // "cancelling" -> "cancell" -> "cancel"
  if (stripped && word.length > 4 && /([dglmnprt])\1$/.test(word)) word = word.slice(0, -1);
  return word;
}

/** Lowercases, drops stopwords and stems, so "cleanings" matches "cleaning" and "clean". */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => !STOPWORDS.has(token))
    .map(stem);
}

/**
 * Keyword retrieval using BM25 scoring. It needs no embedding API, runs in memory,
 * and is deterministic, which keeps tests and evaluations repeatable. The Retriever
 * interface lets a vector store replace it without touching the rest of the module.
 */
export class Bm25Retriever implements Retriever {
  private readonly k1 = 1.5;
  private readonly b = 0.75;
  private readonly documents: { chunk: KnowledgeChunk; counts: Map<string, number>; length: number }[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(chunks: KnowledgeChunk[]) {
    this.documents = chunks.map((chunk) => {
      // The title is counted twice so a match on the section heading ranks higher.
      const tokens = tokenize(`${chunk.title} ${chunk.title} ${chunk.text}`);
      const counts = new Map<string, number>();
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
      for (const token of counts.keys()) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
      return { chunk, counts, length: tokens.length };
    });
    const total = this.documents.reduce((sum, doc) => sum + doc.length, 0);
    this.averageLength = this.documents.length ? total / this.documents.length : 0;
  }

  search(query: string, limit = 3): RetrievalHit[] {
    const terms = [...new Set(tokenize(query))];
    const count = this.documents.length;
    const hits: RetrievalHit[] = [];

    for (const doc of this.documents) {
      let score = 0;
      for (const term of terms) {
        const frequency = doc.counts.get(term);
        if (!frequency) continue;
        const containing = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (count - containing + 0.5) / (containing + 0.5));
        const norm = 1 - this.b + this.b * (doc.length / (this.averageLength || 1));
        score += idf * ((frequency * (this.k1 + 1)) / (frequency + this.k1 * norm));
      }
      if (score > 0) hits.push({ chunk: doc.chunk, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
