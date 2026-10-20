import { validateModelDownload } from './qvacDownloadValidation';

test('accepts only a complete successful model response', () => {
  expect(() => validateModelDownload(200, 1024, 1024)).not.toThrow();
});
test.each([403, 404, 500, 206, undefined])('rejects HTTP status %s even if the byte count matches', status => {
  expect(() => validateModelDownload(status, 1024, 1024)).toThrow('Model download failed');
});
test.each([0, 512, 2048])('rejects an incomplete or unexpected model of %s bytes', bytes => {
  expect(() => validateModelDownload(200, bytes, 1024)).toThrow('incomplete');
});
test('rejects invalid expected-size metadata', () => {
  expect(() => validateModelDownload(200, 0, 0)).toThrow('size is unavailable');
});
