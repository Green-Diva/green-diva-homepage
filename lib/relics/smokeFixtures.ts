// Lazy fs fixtures for Test-Run smoke ctxs that reference files on disk.
//
// Some scene sampleCtxs (e.g. relic.network-image-search) require a real
// file path because their bound skills read pixels via `imagePathsField`
// (the Gemini handler reads from disk, not from base64). ensureSmokeFixtures()
// is called by the Test-Run endpoint before executeAgent; it writes the
// fixture PNG(s) idempotently so repeated test runs find the file already
// in place.

import "server-only";
import { promises as fs } from "fs";
import path from "path";

// 1×1 transparent PNG.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P//PwAFBwIAnwEYjwAAAABJRU5ErkJggg==";

export const SMOKE_REF_IMAGE_PATH = "/tmp/_smoke-test-ref.png";

// 128×128 JPEG: red circle on light gray. Used by relic.enhance2d /
// relic.create3d sampleCtx — fal.ai BiRefNet and Meshy both reject the
// 1×1 PNG above as unloadable, so we need a real image with a clearly
// segmentable foreground subject. JPEG (not PNG) because both endpoints
// accept it and it's ~half the bytes for the same dimensions.
export const SMOKE_PHOTO_DATA_URI =
  "data:image/jpeg;base64,/9j/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCACAAIADASIAAhEBAxEB/8QAGwABAAMBAQEBAAAAAAAAAAAAAAYHCAUEAgP/xAAuEAABAwMBBQcFAQEAAAAAAAAAAQIDBAURBhIhMUFRIkJhcYGhwRMUJKKxkdH/xAAaAQEAAwEBAQAAAAAAAAAAAAAAAgMFBAYB/8QAJBEAAwEAAQMDBQEAAAAAAAAAAAECAwQFERIiMfFBUaGx0SH/2gAMAwEAAhEDEQA/ALwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIlqDX1us7309Mn3lW3crWOwxi+LvhPYjVzK70y3LHTavHNd2S0FJXHXN+uLl/MWmjXuU/Yx68fc4MtVUVDtqaeWRV5veq/05q5c/RGrn0XRr10l+f4aLBnSKqqKd21DPLGqc2PVP4d63a5v9ucn5i1MadyoTbz68fcTy5+qGnRdEvRSf4/pdoIlp/X1uvD209Sn2dU7cjXuyx6+DuvgvuS06ZuaXeWZWuOmNeOi7MAAkVAAAAAAAAiWvtQOs9nSmp37NVV5a1UXexneX49fAjdKZdMtxyrbRZz7sj2ttbPlkktVqlVsTezNOxd715tavTqvPy416AZOmjt92ex4/HjCPCPkA9cNsrKiPbigcrV4Kqomf8ATzywyQSKyVjmOTkqEezLlSb7JnwAD4fQWFonWz4pIrVdZdqJ2GwTuXexeTXL06Ly8uFegnno4fdFHI48bx4X8GkARLQOoHXizrTVD9qqpMNcqrvezur8eniS01opVKpHjtsqx0ede6AAJFQAAAKS1zcVuOq6vtZjp1+gxOmzx/bJdpnSqlWoq5pnb1kkc9fVcnJy69KRtdFzT0q/sv38H5HrtkLKi4wxPTLVdlU64TPweQ+4ZXwTMlYuHMXKHAvc9FSbTSJ5wTCHKv8AAyS3LKqJtxqmF81xgQX+jkjRZVdE/mitVf8AMHLu12StakMKKkSLlVXi5f8AhdVLscGWVq1/hyQAUGgAAASPQ1xW3arpO1iOoX6D067XD9sF2mdKWVaerhmauFjka9PRcmizQ4lelo851rNLSb+6/XyAAdZigAAAzpVRLT1c0LtyxyOYvouDRZSWubctu1XV9nEdQv12L12uP7ZOTlz6Uza6LolpUfdfr5I4ADPPRgAAAAAAAAH60sS1FXDC1MrJI1ieq4NFlJaGty3HVdJ2cx06/XevTZ4ftgu00OJPpbPOda0T0mPsv38AAHWYoAAAIlr7T7rxZ0qadm1V0mXNRE3vZ3k+U8vEloI3KqXLLcdax0Wk+6M3gsLW2iXxSyXW1RK6J3amgYm9q83NTp1Tl5cK9MnTNw+zPY8fkRvHnHwAAQLwAAAAWFonRL5ZYrrdYlbE3tQQPTe9eTnJ06Jz8uM883b7Io5HIjCPO/kkOgdPus9nWpqGbNVV4c5FTexndT59fAloBrRKmVKPHba1to9K92AASKgAAAAAARLUGgbdeHvqKZfs6t29XMblj18W/Ke5LQRqJpdqRbltpjXlm+zKSuWhr9bnL+GtTGnfpl28+nH2ODLS1FO7ZmgljVOT2Kn9NFg5q4k/Rmrn1rRL1yn+P6Z0ipaiodswwSyKvJjFX+Het2hr/cXJ+GtNGvF9Quxj04+xdoE8Sfqxp1rRr0Sl+f4RLT+gbdZ3NqKlfvKpu9HPbhjF8G/K+xLQDpmJldpRla7abV5aPuwACRUAAAAAAAAAAAAAAAAAAAAAAAAAAAf/2Q==";

export async function ensureSmokeFixtures(): Promise<void> {
  try {
    await fs.access(SMOKE_REF_IMAGE_PATH);
    return; // already exists
  } catch {
    // not present — write
  }
  const buf = Buffer.from(ONE_PIXEL_PNG_BASE64, "base64");
  await fs.mkdir(path.dirname(SMOKE_REF_IMAGE_PATH), { recursive: true });
  await fs.writeFile(SMOKE_REF_IMAGE_PATH, buf);
}
