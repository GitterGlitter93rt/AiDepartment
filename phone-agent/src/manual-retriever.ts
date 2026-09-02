import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManualRetriever } from './strategy.js';

interface Chunk { id: string; text: string; tokens: Set<string>; }

export class FileManualRetriever implements ManualRetriever {
  private chunks?: Chunk[];
  constructor(private readonly rootDir: string) {}

  async retrieve(query: string, limit = 6): Promise<Array<{ id: string; text: string }>> {
    const chunks = await this.load();
    const queryTokens = tokenize(query);
    return chunks
      .map((chunk) => ({ chunk, score: overlap(queryTokens, chunk.tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ chunk }) => ({ id: chunk.id, text: chunk.text }));
  }

  private async load(): Promise<Chunk[]> {
    if (this.chunks) return this.chunks;
    const files = (await readdir(this.rootDir)).filter((name) => name.startsWith('module-') && name.endsWith('.md')).sort();
    const chunks: Chunk[] = [];
    for (const file of files) {
      const text = await readFile(join(this.rootDir, file), 'utf8');
      const sections = text.split(/\n(?=#{1,3}\s)/g).filter(Boolean);
      sections.forEach((section, index) => chunks.push({
        id: `${file}#${index + 1}`,
        text: section.slice(0, 4500),
        tokens: tokenize(section),
      }));
    }
    this.chunks = chunks;
    return chunks;
  }
}

function tokenize(input: string): Set<string> {
  return new Set(input.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function overlap(a: Set<string>, b: Set<string>): number {
  let score = 0;
  for (const token of a) if (b.has(token)) score += 1;
  return score;
}
