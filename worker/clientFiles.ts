import type { ClientFiles } from './assets';
// The built app (scripts/client-files.mjs, run by the build); `{}` before the first build.
import files from './client-files.generated.json';

export const clientFiles: ClientFiles = files as ClientFiles;
