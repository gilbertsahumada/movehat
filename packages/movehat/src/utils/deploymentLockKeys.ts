import { realpathSync } from "node:fs";

export interface DeploymentLockKeyInput {
  packageDir: string;
  chainIdentity: string;
  moduleName: string;
  projectDir?: string | undefined;
}

export interface DeploymentLockKeys {
  canonicalPackageDir: string;
  canonicalProjectDir: string;
  keys: readonly [string, string];
}

/** Build collision-free lock keys shared by both deployment write paths. */
export function deploymentLockKeys(input: DeploymentLockKeyInput): DeploymentLockKeys {
  const canonicalPackageDir = realpathSync(input.packageDir);
  // Deployment persistence is rooted at process.cwd(). Include that canonical
  // project identity so unrelated repositories never contend merely because
  // they use the same chain and module names.
  const canonicalProjectDir = realpathSync(input.projectDir ?? process.cwd());
  return {
    canonicalPackageDir,
    canonicalProjectDir,
    keys: [
      JSON.stringify(["package", canonicalPackageDir]),
      JSON.stringify([
        "deployment",
        canonicalProjectDir,
        input.chainIdentity,
        input.moduleName,
      ]),
    ],
  };
}
