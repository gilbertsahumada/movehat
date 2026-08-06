import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Compiled package artifacts consumed by the SDK execution paths. */
export interface CompiledPackage {
  metadataBytes: Uint8Array;
  moduleBytecode: Uint8Array[];
}

/**
 * Read the compiled package a `movement move build --save-metadata` run
 * left under `<safeDir>/build/`.
 *
 * The root package's compiled output is the single directory under
 * `build/` that carries a `package-metadata.bcs`; dependency builds live
 * in nested `bytecode_modules/dependencies/` and have no metadata there.
 * Module bytecode is sorted by filename for a deterministic publish
 * order.
 */
export function readCompiledPackage(safeDir: string): CompiledPackage {
  const buildRoot = join(safeDir, "build");
  const pkgDirs = existsSync(buildRoot)
    ? readdirSync(buildRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(buildRoot, e.name))
        .filter((d) => existsSync(join(d, "package-metadata.bcs")))
    : [];
  if (pkgDirs.length !== 1) {
    throw new Error(
      `Expected exactly one compiled package under ${buildRoot}, found ${pkgDirs.length}.`
    );
  }
  const pkgDir = pkgDirs[0]!;

  const metadataBytes = new Uint8Array(
    readFileSync(join(pkgDir, "package-metadata.bcs"))
  );
  const modulesDir = join(pkgDir, "bytecode_modules");
  const moduleBytecode = readdirSync(modulesDir)
    .filter((f) => f.endsWith(".mv"))
    .sort()
    .map((f) => new Uint8Array(readFileSync(join(modulesDir, f))));
  if (moduleBytecode.length === 0) {
    throw new Error(`No compiled modules (*.mv) found in ${modulesDir}`);
  }

  return { metadataBytes, moduleBytecode };
}
