import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const fixturesDir = resolve(here, '..', 'fixtures');
export const moveV1Dir = resolve(fixturesDir, 'move', 'v1');
export const moveV2Dir = resolve(fixturesDir, 'move', 'v2');
export const noopScriptDir = resolve(fixturesDir, 'scripts');
export const noopScriptPath = resolve(noopScriptDir, 'scripts', 'noop.move');
// Pre-compiled bytecode of `noop.move`. The Movement CLI's
// `move run-script --script-path` path fails to resolve the
// `AptosFramework` dep on this version of the CLI (uses
// `aptos-move/framework` instead of `aptos-move/framework/aptos-
// framework`). The `.mv` branch (`--compiled-script-path`) works,
// so the integration test routes through that. Regenerate via
// `cd fixtures/scripts && mkdir -p sources && movement move compile`
// then copy `build/.../bytecode_scripts/main.mv` here.
export const noopBytecodePath = resolve(noopScriptDir, 'bytecode', 'noop.mv');
