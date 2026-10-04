import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const { assertPortableKoharuPtx, koharuCudaBuildEnv } =
  require("../scripts/prepare-koharu-cuda-runner.cjs") as {
    assertPortableKoharuPtx: (binary: Buffer) => void;
    koharuCudaBuildEnv: (
      root: string,
      env: NodeJS.ProcessEnv,
    ) => NodeJS.ProcessEnv;
  };
describe("portable Koharu CUDA build", () => {
  it("checks the actual committed Windows artifact, not just synthetic PTX", () => {
    const path = join(
      __dirname,
      "..",
      "tools",
      "mgt-koharu-inpaint-runner",
      "mgt-koharu-inpaint-runner.exe",
    );
    expect(() => assertPortableKoharuPtx(readFileSync(path))).not.toThrow();
    expect(
      readPeImports(readFileSync(path)).filter((name) =>
        /^(nvcuda|cudart|cublas|curand)/i.test(name),
      ),
    ).toEqual([]);
  });
  it.each(["75", "86", "89", "120"])(
    "does not inherit build-host target %s",
    (hostTarget) => {
      const env = koharuCudaBuildEnv("C:/build", {
        CUDA_COMPUTE_CAP: hostTarget,
        USERPROFILE: "C:/user",
        KEEP_ME: "yes",
      });
      expect(env.CUDA_COMPUTE_CAP).toBe("75");
      expect(env.CARGO_ENCODED_RUSTFLAGS).toContain(
        "--remap-path-prefix=C:/build=/src",
      );
      expect(env.KEEP_ME).toBe("yes");
      expect(env.CARGO_TARGET_DIR).toMatch(/koharu-sm75$/);
      expect(env.CARGO_ENCODED_RUSTFLAGS).toContain(
        "--remap-path-prefix=C:/user=/user",
      );
    },
  );
  it("accepts the portable target even with multiple PTX modules", () => {
    expect(() =>
      assertPortableKoharuPtx(Buffer.from(".target sm_75\n.target sm_75")),
    ).not.toThrow();
  });
  it.each([
    "",
    ".target sm_89",
    ".target sm_120",
    ".target sm_75a",
    ".target sm_75\n.target sm_89",
  ])("rejects nonportable or missing PTX: %s", (value) => {
    expect(() => assertPortableKoharuPtx(Buffer.from(value))).toThrow(
      "portable sm_75 PTX",
    );
  });
});

// Inspect the PE loader table, not arbitrary DLL strings used by lazy loading.
function readPeImports(binary: Buffer): string[] {
  const pe = binary.readUInt32LE(0x3c);
  expect(binary.toString("ascii", pe, pe + 4)).toBe("PE\0\0");
  const optional = pe + 24;
  expect(binary.readUInt16LE(optional)).toBe(0x20b);
  const sections = optional + binary.readUInt16LE(pe + 20);
  const fileOffset = (rva: number) => {
    for (let i = 0; i < binary.readUInt16LE(pe + 6); i++) {
      const section = sections + i * 40;
      const virtualAddress = binary.readUInt32LE(section + 12);
      const size = Math.max(
        binary.readUInt32LE(section + 8),
        binary.readUInt32LE(section + 16),
      );
      if (rva >= virtualAddress && rva < virtualAddress + size)
        return binary.readUInt32LE(section + 20) + rva - virtualAddress;
    }
    throw new Error("PE import outside sections");
  };
  const imports = [];
  let descriptor = fileOffset(binary.readUInt32LE(optional + 120));
  while (binary.readUInt32LE(descriptor + 12)) {
    const name = fileOffset(binary.readUInt32LE(descriptor + 12));
    imports.push(binary.toString("ascii", name, binary.indexOf(0, name)));
    descriptor += 20;
  }
  return imports;
}
