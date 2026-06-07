// On-device RAG: the "search_knowledge" tool over the Bitcoin-copilot corpus.
//
// QVAC does the embeddings (EmbeddingGemma-300M, on-device) and kaleido-mind
// owns the vector store + retrieval — "QVAC ships embeddings, not a store".
// Ingests lazily on the first query so the embeddings model only loads when the
// user actually asks a knowledge question (keeps the wallet flows fast).

import {
  Retriever,
  createRagToolSource,
  BITCOIN_COPILOT_DOCS,
  type EmbeddingProvider,
  type ToolSource,
} from '@kaleidorg/mind';
import type QVACService from './QVACService';

export function buildKnowledgeToolSource(qvac: QVACService): ToolSource {
  const embeddings: EmbeddingProvider = {
    dimension: 768, // EmbeddingGemma-300M
    embed: (texts) => qvac.embed(texts),
  };
  const retriever = new Retriever({ embeddings });
  const inner = createRagToolSource(retriever, {
    k: 4,
    description:
      'Search the Bitcoin, Lightning and RGB knowledge base for relevant ' +
      'passages. Use this before answering a "what is / how does / explain" ' +
      'question about Bitcoin, Lightning, RGB, channels, or KaleidoSwap.',
  });

  // Lazy, once: embed + index the corpus on the first search_knowledge call.
  let ingested: Promise<unknown> | null = null;
  return {
    id: 'knowledge',
    listTools: () => inner.listTools(),
    has: (name) => inner.has(name),
    execute: async (name, args) => {
      if (!ingested) ingested = retriever.ingest(BITCOIN_COPILOT_DOCS).catch(() => undefined);
      await ingested;
      return inner.execute(name, args);
    },
  };
}
