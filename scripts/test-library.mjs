// Checks how Google Drive files are classified and searched for.
// Run with: node scripts/test-library.mjs
import assert from 'node:assert/strict';
import { driveKind, driveQuery, googleEditUrl, storeType } from '../src/library/classify.ts';

const kind = (mimeType, name = 'x') => driveKind({ mimeType, name });
assert.equal(kind('application/vnd.google-apps.folder'), 'folder');
assert.equal(kind('application/vnd.google-apps.document'), 'gdoc');
assert.equal(kind('application/vnd.google-apps.spreadsheet'), 'gsheet');
assert.equal(kind('application/vnd.google-apps.presentation'), 'gslides');
assert.equal(kind('image/png'), 'image');
assert.equal(kind('image/jpeg'), 'image');
assert.equal(kind('image/heic'), 'other', 'an image type the workspace cannot show');
assert.equal(kind('application/pdf'), 'pdf');
assert.equal(kind('video/mp4'), 'video');
assert.equal(kind('video/quicktime'), 'other');
assert.equal(kind('application/octet-stream', 'Dragon.GLB'), 'model');
assert.equal(kind('model/stl', 'mini.stl'), 'model');
assert.equal(kind('text/plain', 'ship.obj'), 'model');
assert.equal(kind('application/zip', 'pack.zip'), 'other');
assert.equal(kind('application/vnd.google-apps.form'), 'other');

assert.deepEqual(googleEditUrl({ mimeType: 'application/vnd.google-apps.document', id: 'abc' }), {
  url: 'https://docs.google.com/document/d/abc/edit',
  label: 'Google Doc',
});
assert.equal(googleEditUrl({ mimeType: 'application/vnd.google-apps.spreadsheet', id: 'q' }).url, 'https://docs.google.com/spreadsheets/d/q/edit');
assert.equal(googleEditUrl({ mimeType: 'image/png', id: 'q' }), null);

assert.equal(storeType({ mimeType: 'application/octet-stream', name: 'a.glb' }), 'model/gltf-binary');
assert.equal(storeType({ mimeType: 'text/plain', name: 'a.OBJ' }), 'model/obj');
assert.equal(storeType({ mimeType: 'image/png', name: 'a.png' }), 'image/png');

assert.deepEqual(driveQuery('drive', 'root', ''), { q: "trashed = false and 'root' in parents", orderBy: 'folder,name' });
assert.deepEqual(driveQuery('drive', 'folder123', '  '), { q: "trashed = false and 'folder123' in parents", orderBy: 'folder,name' });
// Searching looks everywhere, not just in the open folder.
assert.equal(driveQuery('drive', 'folder123', 'dragon').q, "trashed = false and name contains 'dragon'");
assert.deepEqual(driveQuery('recent', 'root', ''), {
  q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
  orderBy: 'viewedByMeTime desc',
});
assert.equal(driveQuery('docs', 'root', '').q, "trashed = false and mimeType = 'application/vnd.google-apps.document'");
assert.equal(driveQuery('images', 'root', 'map').q, "trashed = false and mimeType contains 'image/' and name contains 'map'");
assert.match(driveQuery('models', 'root', '').q, /name contains '\.glb' or name contains '\.gltf' or name contains '\.stl' or name contains '\.obj'/);
// Quotes and backslashes in a search cannot break out of the query.
assert.equal(driveQuery('docs', 'root', "Hayden's \\ notes").q.endsWith("name contains 'Hayden\\'s \\\\ notes'"), true);

console.log('library: all checks passed');
