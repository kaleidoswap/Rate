import { buildKnowledge, buildKnowledgeToolSource, isConceptQuestion } from './aiKnowledge';
import { CONCEPT_DOCS } from './knowledge/concepts';
const mockIngest = jest.fn();
const mockExecute = jest.fn();
const mockSearch = jest.fn(async () => [{ text: 'RGB is a protocol' }]);
jest.mock('@kaleidorg/mind', () => ({ Retriever: jest.fn().mockImplementation(() => ({ ingest: mockIngest, search: mockSearch })), createRagToolSource: () => ({ listTools: () => [], has: () => true, execute: mockExecute }) }));
jest.mock('@kaleidorg/mind/knowledge', () => ({ BITCOIN_COPILOT_DOCS: [] }));
it('reports failed ingestion and retries instead of keeping an empty index', async () => {
  mockIngest.mockRejectedValueOnce(new Error('Download failed')).mockResolvedValueOnce(undefined);
  mockExecute.mockResolvedValue({ hits: ['Bitcoin'] });
  const source = buildKnowledgeToolSource({ embed: jest.fn() } as any);
  await expect(source.execute('search_knowledge', {})).rejects.toThrow('Download failed');
  expect(mockExecute).not.toHaveBeenCalled();
  await expect(source.execute('search_knowledge', {})).resolves.toEqual({ hits: ['Bitcoin'] });
  expect(mockIngest).toHaveBeenCalledTimes(2);
});

it('indexes the app’s concept passages with the shared corpus', async () => {
  mockIngest.mockReset().mockResolvedValue(undefined);
  await buildKnowledgeToolSource({ embed: jest.fn() } as any).execute('search_knowledge', {});
  expect(mockIngest).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'rgb-what' }), expect.objectContaining({ id: 'lightning-routing' })]));
});

it('puts passages in the prompt only for concept questions, so wallet actions never wait for embeddings', async () => {
  mockIngest.mockReset().mockResolvedValue(undefined);
  mockSearch.mockClear();
  const { retriever } = buildKnowledge({ embed: jest.fn() } as any);
  await expect(retriever.search('send 500 sats to Walter', 3)).resolves.toEqual([]);
  expect(mockIngest).not.toHaveBeenCalled();
  await expect(retriever.search('cos’è RGB?', 3)).resolves.toEqual([{ text: 'RGB is a protocol' }]);
  expect(mockSearch).toHaveBeenCalledWith('cos’è RGB?', 3);
});

it('tells concept questions apart, in English and Italian', () => {
  for (const q of ['What is RGB?', 'how does Lightning work', 'explain the mempool', 'cos\'è un HTLC?', 'Come funziona Lightning?', 'che cos’è il seed?', 'perché le fee sono alte?'])
    expect(isConceptQuestion(q)).toBe(true);
  for (const q of ['send 1000 sats to Anna', 'pay this invoice', 'show my balance'])
    expect(isConceptQuestion(q)).toBe(false);
  expect(CONCEPT_DOCS.every(d => d.text.length < 800)).toBe(true); // one chunk each
});
