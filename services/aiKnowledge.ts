// On-device RAG: the "search_knowledge" tool over the Bitcoin-copilot corpus
// plus the app's concept passages (services/knowledge/concepts.ts).
//
// QVAC does the embeddings (EmbeddingGemma-300M, on-device) and kaleido-mind
// owns the vector store + retrieval — "QVAC ships embeddings, not a store".
// Ingests lazily on the first query so the embeddings model only loads when the
// user actually asks a knowledge question (keeps the wallet flows fast).

import {
  Retriever,
  createRagToolSource,
  type EmbeddingProvider,
  type ToolSource,
} from '@kaleidorg/mind';
import { BITCOIN_COPILOT_DOCS } from '@kaleidorg/mind/knowledge';
import { CONCEPT_DOCS } from './knowledge/concepts';
import type QVACService from './QVACService';

/**
 * A "what is / how does / explain" question, in English or Italian. Only these get
 * knowledge passages pasted into the prompt, so wallet actions never wait for the
 * embeddings model.
 */
const CONCEPT_QUESTION = /\b(what(['’]s| is| are| does)|how (does|do|is|are|can)|why|explain|difference between|meaning of|cos['’ ]?[eè]|che cos|cosa (sono|significa|vuol)|come funzion|perch[eé]|spiega|differenza)/i;
export function isConceptQuestion(text: string): boolean {
  return CONCEPT_QUESTION.test(text);
}

export interface Knowledge {
  /** The search_knowledge tool the model can call. */
  source: ToolSource;
  /** For the Funnel's auto-inject: passages for concept questions, nothing otherwise. */
  retriever: Retriever;
}

export function buildKnowledge(qvac: QVACService): Knowledge {
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

  // Lazy, once: embed + index the corpus on first use (tool call or concept question).
  let ingested: Promise<unknown> | null = null;
  const ensureIngested = () => {
    if (!ingested) ingested = retriever.ingest([...CONCEPT_DOCS, ...BITCOIN_COPILOT_DOCS]).catch(error => { ingested = null; throw error; });
    return ingested;
  };
  const source: ToolSource = {
    id: 'knowledge',
    listTools: () => inner.listTools(),
    has: (name) => inner.has(name),
    execute: async (name, args) => {
      await ensureIngested();
      return inner.execute(name, args);
    },
  };
  // The Funnel only calls search(); a failure there is logged and the turn goes on without passages.
  const conceptRetriever = {
    search: async (query: string, k?: number) => {
      if (!isConceptQuestion(query)) return [];
      await ensureIngested();
      return retriever.search(query, k);
    },
  } as unknown as Retriever;
  return { source, retriever: conceptRetriever };
}

export function buildKnowledgeToolSource(qvac: QVACService): ToolSource {
  return buildKnowledge(qvac).source;
}
