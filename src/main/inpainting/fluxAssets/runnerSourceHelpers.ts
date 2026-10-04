import { basename } from "node:path";

type LocalRunnerSourceShape = {
  dirName: string;
  label: string;
  path: string;
};

export function resolveBundledNativeRunnerSource<
  T extends LocalRunnerSourceShape,
>(
  computeCapability: string,
  targetDirName: string,
  generic: T | null,
): T | null {
  if (!computeCapability || !generic) return null;
  return {
    ...generic,
    dirName: targetDirName,
    label: `${targetDirName}/${basename(generic.path)}`,
  };
}

export function isTruthyEnv(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(
    (value || "").trim().toLowerCase(),
  );
}
