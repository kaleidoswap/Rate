import { buildKnowledgeToolSource } from './aiKnowledge';
const mockIngest = jest.fn();
const mockExecute = jest.fn();
jest.mock('@kaleidorg/mind', () => ({ Retriever: jest.fn().mockImplementation(() => ({ ingest: mockIngest })), createRagToolSource: () => ({ listTools: () => [], has: () => true, execute: mockExecute }) }));
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
