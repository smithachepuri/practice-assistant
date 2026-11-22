export interface KnowledgeDocument {
  /** File name without extension, e.g. "insurance-and-payment". */
  name: string;
  text: string;
}

export interface KnowledgeChunk {
  id: string;
  document: string;
  title: string;
  text: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Splits a Markdown document into one chunk per "## " section. Text before the
 * first section heading becomes an "Overview" chunk.
 */
export function chunkDocument(document: KnowledgeDocument): KnowledgeChunk[] {
  const lines = document.text.split(/\r?\n/);
  let documentTitle = document.name;
  let heading = "Overview";
  let buffer: string[] = [];
  const chunks: KnowledgeChunk[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) {
      chunks.push({
        id: `${document.name}#${slugify(heading)}`,
        document: document.name,
        title: `${documentTitle}: ${heading}`,
        text,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const title = /^#\s+(.+)$/.exec(line);
    const section = /^##\s+(.+)$/.exec(line);
    if (title) {
      documentTitle = title[1].trim();
    } else if (section) {
      flush();
      heading = section[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}

export function chunkDocuments(documents: KnowledgeDocument[]): KnowledgeChunk[] {
  return documents.flatMap(chunkDocument);
}
