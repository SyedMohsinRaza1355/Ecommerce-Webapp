import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { allArt } from "./demo-art";

// Preview helper: ART_OUT=<folder> npx vitest run src/e2e/render-art.test.ts writes every picture as a PNG so it can be looked at.
describe.skipIf(!process.env.ART_OUT)("render demo art", () => {
  it("writes the pictures", async () => {
    const out = process.env.ART_OUT!;
    mkdirSync(out, { recursive: true });
    for (const a of allArt()) writeFileSync(`${out}/${a.file}.png`, await sharp(Buffer.from(a.svg)).resize(Math.min(a.w, 400)).png().toBuffer());
    // contact sheet of the 4:3 pictures
    const tiles = allArt().filter((a) => a.w === 800);
    const cols = 6, tw = 260, th = 195;
    const comps = await Promise.all(tiles.map(async (a, i) => ({ input: await sharp(Buffer.from(a.svg)).resize(tw, th).png().toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })));
    writeFileSync(`${out}/sheet.png`, await sharp({ create: { width: cols * tw, height: Math.ceil(tiles.length / cols) * th, channels: 3, background: "#fff" } }).composite(comps).png().toBuffer());
  });
});
