/**
 * Loads with Hub UI after global JSZip (UMD). Exposes one namespace for `hub.js`.
 */
import {
  buildImportZipBlobWithJsZip,
  DEFAULT_HUB_IMPORT_ZIP_LIMITS,
  getHubImportFileMode,
  HUB_IMPORT_SEQUENTIAL_MULTI_SOURCE_TYPES,
  HUB_IMPORT_ZIP_BULK_SOURCE_TYPES,
  assertSingleFileWithinLimit,
} from './hub-client-import-zip.mjs';

function getJSZipCtor() {
  const C = globalThis.JSZip;
  if (typeof C !== 'function') {
    throw new Error('JSZip is not loaded. Expected script before hub-import-zip-shim.mjs.');
  }
  return C;
}

const knowtationHubImportZip = {
  get limits() {
    return DEFAULT_HUB_IMPORT_ZIP_LIMITS;
  },
  HUB_IMPORT_SEQUENTIAL_MULTI_SOURCE_TYPES,
  HUB_IMPORT_ZIP_BULK_SOURCE_TYPES,
  getHubImportFileMode,
  buildImportZipBlob: (fileList, opts) =>
    buildImportZipBlobWithJsZip(getJSZipCtor(), fileList, DEFAULT_HUB_IMPORT_ZIP_LIMITS, opts),
  assertSingleFileWithinLimit: (f) => assertSingleFileWithinLimit(f, DEFAULT_HUB_IMPORT_ZIP_LIMITS),
};

Object.defineProperty(globalThis, 'knowtationHubImportZip', {
  value: knowtationHubImportZip,
  enumerable: true,
  configurable: true,
});

export { knowtationHubImportZip };
