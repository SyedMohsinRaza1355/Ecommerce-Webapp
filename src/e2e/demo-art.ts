// Original, hand-drawn food illustrations for the demo store, written as SVG and turned into WebP pictures by the seed script.
// Everything is drawn here, so there is nothing to license and nothing to download.
let uid = 0;
const id = (p: string) => `${p}${++uid}`;

const grad = (gid: string, a: string, b: string, vertical = true) =>
  `<linearGradient id="${gid}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

/** A scene: soft background, floor shadow, and the drawing centred on x=400. */
function scene(inner: string, bgA = "#fff4e0", bgB = "#f7c98b", w = 800, h = 600): string {
  const g = id("bg"), bl = id("bl");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><radialGradient id="${g}" cx="50%" cy="42%" r="80%"><stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></radialGradient><filter id="${bl}"><feGaussianBlur stdDeviation="9"/></filter></defs><rect width="${w}" height="${h}" fill="url(#${g})"/><ellipse cx="${w / 2}" cy="${h * 0.86}" rx="${w * 0.3}" ry="${h * 0.055}" fill="#3b1d0a" opacity=".22" filter="url(#${bl})"/>${w === 800 ? `<g transform="translate(400 330) scale(1.16) translate(-400 -330)">${inner}</g>` : inner}</svg>`;
}

const seeds = (n: number, x0: number, x1: number, y0: number, y1: number) => {
  let s = "";
  for (let i = 0; i < n; i++) {
    const t = (i * 0.6180339) % 1, u = (i * 0.4142136 + 0.2) % 1;
    s += `<ellipse cx="${x0 + (x1 - x0) * t}" cy="${y0 + (y1 - y0) * u}" rx="9" ry="5" fill="#fff1c9" transform="rotate(${(i * 37) % 180} ${x0 + (x1 - x0) * t} ${y0 + (y1 - y0) * u})"/>`;
  }
  return s;
};

type BurgerOpts = { patties?: number; chicken?: boolean; veggie?: boolean; cheese?: boolean; bacon?: boolean; bbq?: boolean; lettuce?: boolean; tomato?: boolean; onion?: boolean };
/** A burger centred on x=400, sitting with its base at y=470. */
function burger(o: BurgerOpts = {}): string {
  const { patties = 1, chicken = false, veggie = false, cheese = false, bacon = false, bbq = false, lettuce = true, tomato = true, onion = false } = o;
  const bun = id("bun"), top = id("top"), pat = id("pat");
  let y = 470;
  let out = `<defs>${grad(bun, "#f0b65a", "#c97a25")}${grad(top, "#f6c36b", "#c27522")}${grad(pat, "#7a3b1d", "#3f1d0d")}</defs>`;
  out += `<path d="M175 ${y - 46} h450 a28 28 0 0 1 -28 46 h-394 a28 28 0 0 1 -28 -46z" fill="url(#${bun})"/>`;
  y -= 44;
  for (let i = 0; i < patties; i++) {
    if (chicken) {
      out += `<path d="M160 ${y} q-18 -44 40 -58 q120 -26 230 -10 q150 6 190 40 q22 30 -30 44 q-210 22 -430 -2 q-4 -6 0 -14z" fill="#d9942f"/><path d="M185 ${y - 12} q220 -34 430 -6" stroke="#f3c15c" stroke-width="10" fill="none" stroke-linecap="round" opacity=".7"/>`;
      for (let k = 0; k < 16; k++) out += `<circle cx="${200 + ((k * 53) % 400)}" cy="${y - 20 + ((k * 17) % 28)}" r="${4 + (k % 3)}" fill="#b57219" opacity=".7"/>`;
      y -= 52;
    } else if (veggie) {
      out += `<rect x="185" y="${y - 44}" width="430" height="46" rx="22" fill="#6e7d3a"/>`;
      for (let k = 0; k < 20; k++) out += `<circle cx="${205 + ((k * 61) % 390)}" cy="${y - 38 + ((k * 13) % 34)}" r="${4 + (k % 4)}" fill="${k % 2 ? "#a34a2a" : "#e0c15a"}" opacity=".85"/>`;
      y -= 44;
    } else {
      out += `<rect x="178" y="${y - 46}" width="444" height="48" rx="24" fill="url(#${pat})"/><path d="M200 ${y - 34} q200 -14 400 0" stroke="#9c5a33" stroke-width="6" fill="none" stroke-linecap="round" opacity=".6"/>`;
      y -= 44;
    }
    if (cheese || (patties > 1 && i < patties)) {
      out += `<path d="M170 ${y + 2} h460 l-34 30 l-30 -12 l-34 38 l-36 -34 l-60 22 l-30 -26 l-70 26 l-40 -30 l-60 18z" fill="#f7c928"/>`;
      y -= 16;
    }
  }
  if (bacon) {
    out += `<path d="M168 ${y} q40 -22 80 0 t80 0 t80 0 t80 0 t80 0 t74 0 l0 20 q-37 20 -74 0 t-80 0 t-80 0 t-80 0 t-80 0 t-80 0z" fill="#b8341f"/><path d="M168 ${y + 6} q40 -16 80 0 t80 0 t80 0 t80 0 t80 0 t74 0" stroke="#e58a6a" stroke-width="5" fill="none" opacity=".7"/>`;
    y -= 20;
  }
  if (bbq) { out += `<path d="M190 ${y + 6} q30 -26 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t50 0 v14 q-25 18 -50 0 t-60 0 t-60 0 t-60 0 t-60 0 t-60 0 t-60 0z" fill="#5a2410"/>`; y -= 20; }
  if (onion) { out += `<ellipse cx="400" cy="${y - 4}" rx="190" ry="14" fill="#e9d3f0"/><ellipse cx="400" cy="${y - 4}" rx="150" ry="8" fill="#c9a4d8"/>`; y -= 18; }
  if (tomato) {
    for (let k = 0; k < 4; k++) out += `<ellipse cx="${250 + k * 100}" cy="${y - 2}" rx="52" ry="15" fill="#d8321f"/><ellipse cx="${250 + k * 100}" cy="${y - 4}" rx="36" ry="7" fill="#f0684f"/>`;
    y -= 22;
  }
  if (lettuce) {
    let top = `M150 ${y + 8}`, bot = "";
    for (let k = 0; k < 10; k++) top += ` q25 -30 50 0`;
    top += " v22";
    for (let k = 0; k < 10; k++) bot += ` q-25 18 -50 0`;
    out += `<path d="${top}${bot}z" fill="#6cbf3c"/><path d="M165 ${y + 6} q30 -18 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0" stroke="#9be05f" stroke-width="5" fill="none" opacity=".8"/>`;
    y -= 26;
  }
  out += `<path d="M168 ${y + 8} C168 ${y - 170} 632 ${y - 170} 632 ${y + 8} q-6 16 -40 16 h-424 q-34 0 -0 -16z" fill="url(#${top})"/><path d="M230 ${y - 90} q60 -50 150 -56" stroke="#fde3a3" stroke-width="12" fill="none" stroke-linecap="round" opacity=".55"/>${seeds(26, 235, 565, y - 130, y - 30)}`;
  return out;
}

/** Fries in a red carton; `loaded` adds cheese sauce, bacon bits and spring onion. */
function fries(loaded = false): string {
  let out = "";
  const colours = ["#f6c844", "#efb92f", "#f9d96a"];
  for (let i = 0; i < 17; i++) {
    const a = -34 + i * 4.2, x = 290 + i * 14, h = 150 + ((i * 29) % 70);
    out += `<g transform="rotate(${a} ${x} 400)"><rect x="${x - 12}" y="${400 - h}" width="24" height="${h}" rx="6" fill="${colours[i % 3]}"/><rect x="${x - 12}" y="${400 - h}" width="8" height="${h}" rx="4" fill="#fff" opacity=".25"/></g>`;
  }
  out += `<path d="M262 380 h276 l-26 130 q-2 10 -12 10 h-200 q-10 0 -12 -10z" fill="#d8231a"/><path d="M262 380 h276 l-4 22 h-268z" fill="#ef4a3a"/><path d="M356 402 l-12 118 h40 l12 -118z" fill="#fff" opacity=".9"/><circle cx="440" cy="460" r="22" fill="#ffd23f"/>`;
  if (loaded) {
    out += `<path d="M250 372 q40 30 70 0 t70 6 t70 -6 t60 -2 v22 q-30 24 -60 0 t-70 4 t-70 -4 t-70 4z" fill="#f4a521"/>`;
    for (let k = 0; k < 14; k++) out += `<rect x="${270 + ((k * 47) % 250)}" y="${360 + ((k * 13) % 24)}" width="14" height="8" rx="3" fill="${k % 2 ? "#a3281a" : "#5fae33"}" transform="rotate(${k * 29} ${270 + ((k * 47) % 250)} 364)"/>`;
  }
  return out;
}

function rings(): string {
  let out = `<g>`;
  const ring = (cx: number, cy: number, r: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.55}" fill="none" stroke="#e3a431" stroke-width="${r * 0.42}"/><ellipse cx="${cx}" cy="${cy - 3}" rx="${r}" ry="${r * 0.55}" fill="none" stroke="#f6cd6a" stroke-width="${r * 0.14}" opacity=".7"/>`;
  out += ring(330, 440, 120) + ring(470, 420, 112) + ring(400, 370, 118) + ring(330, 350, 96);
  out += `<ellipse cx="590" cy="470" rx="62" ry="20" fill="#fff"/><path d="M528 470 q62 54 124 0z" fill="#fff"/><ellipse cx="590" cy="468" rx="50" ry="13" fill="#d83a2b"/></g>`;
  return out;
}

function nuggets(): string {
  let out = "";
  const blob = (x: number, y: number, r: number, rot: number) =>
    `<g transform="rotate(${rot} ${x} ${y})"><path d="M${x - r} ${y} q0 -${r * 0.9} ${r} -${r * 0.9} q${r * 1.1} 0 ${r * 1.1} ${r * 0.8} q0 ${r * 0.95} -${r * 0.9} ${r * 0.95} q-${r * 1.2} 0 -${r * 1.2} -${r * 0.85}z" fill="#dd9c34"/><path d="M${x - r * 0.6} ${y - r * 0.3} q${r * 0.6} -${r * 0.5} ${r * 1.2} -${r * 0.1}" stroke="#f6cf72" stroke-width="7" fill="none" stroke-linecap="round"/></g>`;
  [[300, 450, 62, 10], [430, 470, 66, -8], [540, 440, 58, 22], [360, 380, 64, -20], [480, 370, 60, 14], [410, 310, 56, 0]].forEach(([x, y, r, a]) => (out += blob(x, y, r, a)));
  out += `<g><rect x="590" y="420" width="90" height="64" rx="14" fill="#f4f0ea"/><ellipse cx="635" cy="422" rx="40" ry="11" fill="#d83a2b"/></g>`;
  return out;
}

function wings(): string {
  let out = "";
  const wing = (x: number, y: number, rot: number) =>
    `<g transform="rotate(${rot} ${x} ${y})"><path d="M${x - 90} ${y} q0 -72 90 -76 q92 -4 100 64 q6 66 -92 66 q-98 2 -98 -54z" fill="#b5381a"/><path d="M${x - 50} ${y - 36} q56 -30 112 -4" stroke="#e66a3c" stroke-width="9" fill="none" stroke-linecap="round" opacity=".8"/><rect x="${x + 86}" y="${y - 12}" width="60" height="22" rx="11" fill="#f1e8d6"/><circle cx="${x + 146}" cy="${y - 6}" r="15" fill="#f1e8d6"/><circle cx="${x + 146}" cy="${y + 12}" r="15" fill="#f1e8d6"/></g>`;
  out += wing(300, 400, -8) + wing(380, 300, 6) + wing(330, 480, 4);
  return out;
}

function strips(): string {
  let out = "";
  [[250, 430, -12], [330, 400, 4], [410, 440, 14], [300, 340, 8], [400, 330, -6], [480, 380, 22]].forEach(([x, y, a], i) => {
    out += `<g transform="rotate(${a} ${x} ${y})"><rect x="${x - 40}" y="${y - 150}" width="86" height="190" rx="36" fill="#dd9c34"/><rect x="${x - 26}" y="${y - 136}" width="20" height="150" rx="10" fill="#f6cf72" opacity=".7"/></g>`;
    void i;
  });
  return out;
}

function coleslaw(): string {
  let out = `<path d="M280 340 h240 l-24 170 h-192z" fill="#fbfaf7"/><path d="M280 340 h240 l-4 28 h-232z" fill="#e5e1d8"/><ellipse cx="400" cy="340" rx="120" ry="30" fill="#f0f5d8"/>`;
  for (let k = 0; k < 40; k++) out += `<ellipse cx="${300 + ((k * 43) % 200)}" cy="${326 + ((k * 11) % 24)}" rx="14" ry="5" fill="${["#dff0a8", "#c9a4d8", "#f5a56b", "#fff"][k % 4]}" transform="rotate(${k * 23} ${300 + ((k * 43) % 200)} 330)"/>`;
  return out;
}

type CupOpts = { liquid: string; label: string; lid?: string; straw?: string; lemon?: boolean; ice?: boolean };
function cup(o: CupOpts): string {
  const { liquid, label, lid = "#f4f4f4", straw = "#e63946", lemon = false, ice = true } = o;
  let out = `<rect x="380" y="150" width="22" height="120" rx="8" fill="${straw}" transform="rotate(12 391 270)"/><path d="M300 262 h200 l-30 252 q-2 10 -12 10 h-116 q-10 0 -12 -10z" fill="#ffffff" opacity=".9"/><path d="M308 320 h184 l-22 194 q-2 10 -12 10 h-116 q-10 0 -12 -10z" fill="${liquid}"/>`;
  if (ice) for (let k = 0; k < 4; k++) out += `<rect x="${330 + k * 34}" y="${326 + (k % 2) * 30}" width="40" height="40" rx="8" fill="#fff" opacity=".35" transform="rotate(${k * 14} ${350 + k * 34} 346)"/>`;
  out += `<path d="M330 330 l26 180" stroke="#fff" stroke-width="10" opacity=".25" stroke-linecap="round"/><rect x="292" y="244" width="216" height="26" rx="12" fill="${lid}"/><rect x="312" y="228" width="176" height="22" rx="11" fill="${lid}"/><path d="M322 400 h156 l-8 70 h-140z" fill="${label}" opacity=".95"/><circle cx="400" cy="435" r="20" fill="#fff" opacity=".9"/>`;
  if (lemon) {
    out += `<g transform="translate(500 290)"><circle r="44" fill="#f4d03f"/><circle r="36" fill="#fbe98a"/>${[0, 45, 90, 135].map((a) => `<line x1="0" y1="-36" x2="0" y2="36" stroke="#f4d03f" stroke-width="4" transform="rotate(${a})"/>`).join("")}</g>`;
    out += `<g fill="#3f9e4a"><path d="M300 250 q-40 -40 -10 -70 q40 10 38 60z"/><path d="M340 240 q-10 -60 30 -70 q30 30 -6 76z" fill="#52b85d"/></g>`;
  }
  return out;
}

function shake(flavour: string, cream = "#fff7ec"): string {
  return `<rect x="380" y="140" width="20" height="130" rx="8" fill="#e63946" transform="rotate(10 390 270)"/><path d="M290 250 h220 l-34 262 q-2 14 -16 14 h-120 q-14 0 -16 -14z" fill="#ffffff" opacity=".85"/><path d="M298 300 h204 l-28 212 q-2 14 -16 14 h-116 q-14 0 -16 -14z" fill="${flavour}"/><path d="M326 310 l22 190" stroke="#fff" stroke-width="12" opacity=".28" stroke-linecap="round"/><path d="M284 252 q16 -64 116 -70 q104 6 116 70 q-54 22 -116 22 t-116 -22z" fill="${cream}"/><path d="M330 214 q70 -30 140 0" stroke="#fff" stroke-width="10" fill="none" opacity=".7" stroke-linecap="round"/><circle cx="420" cy="170" r="22" fill="#c4122f"/><path d="M420 150 q12 -30 34 -34" stroke="#3f8f3f" stroke-width="5" fill="none"/>`;
}

function brownie(): string {
  return `<ellipse cx="400" cy="470" rx="250" ry="52" fill="#fff"/><ellipse cx="400" cy="462" rx="220" ry="40" fill="#f1ece4"/><path d="M270 380 l150 -40 l130 60 v70 l-150 44 l-130 -60z" fill="#3c1b0e"/><path d="M270 380 l150 -40 l130 60 l-150 44z" fill="#5b2c17"/><path d="M290 380 q60 -30 120 -34 M330 392 q60 20 120 40 M440 350 q40 14 80 36" stroke="#2a1209" stroke-width="7" fill="none" stroke-linecap="round" opacity=".7"/><path d="M300 372 q40 -6 52 18 t60 -4 t50 24 t40 -2" stroke="#f1e6d3" stroke-width="9" fill="none" stroke-linecap="round" opacity=".9"/><circle cx="470" cy="340" r="52" fill="#fff4dd"/><circle cx="470" cy="332" r="44" fill="#fffaf0"/><path d="M440 320 q30 -22 56 0" stroke="#f2e2c2" stroke-width="7" fill="none" stroke-linecap="round"/>`;
}

function sundae(): string {
  return `<path d="M300 300 h200 l-34 160 h-132z" fill="#ffffff" opacity=".82"/><path d="M360 460 h80 v36 h60 v22 h-200 v-22 h60z" fill="#ffffff" opacity=".9"/><circle cx="350" cy="290" r="62" fill="#fff4dd"/><circle cx="450" cy="290" r="62" fill="#f7a8b8"/><circle cx="400" cy="236" r="64" fill="#7a4326"/><path d="M340 250 q40 50 60 6 q30 46 60 -4 q20 30 10 60 h-130z" fill="#3c1b0e" opacity=".9"/><circle cx="400" cy="168" r="20" fill="#c4122f"/><path d="M400 150 q8 -26 30 -30" stroke="#3f8f3f" stroke-width="5" fill="none"/><rect x="470" y="170" width="26" height="110" rx="6" fill="#e9c98a" transform="rotate(24 483 225)"/><path d="M312 330 h176 l-22 110 h-132z" fill="#f7a8b8" opacity=".5"/>`;
}

const group = (inner: string, x: number, y: number, s: number) => `<g transform="translate(${x} ${y}) scale(${s}) translate(-400 -300)">${inner}</g>`;

export type Art = { file: string; svg: string; w: number; h: number };

export function allArt(): Art[] {
  const A: Art[] = [];
  const add = (file: string, inner: string, bgA?: string, bgB?: string, w = 800, h = 600) => A.push({ file, svg: scene(inner, bgA, bgB, w, h), w, h });
  add("classic-beef", burger({ patties: 1, cheese: true, onion: true }));
  add("double-smash", burger({ patties: 2, onion: true }), "#fff1dc", "#f2b36a");
  add("zinger", burger({ chicken: true, tomato: false }), "#fff0d6", "#f0a96b");
  add("cheese-melt", burger({ patties: 1, cheese: true, tomato: false, lettuce: false }), "#fff6d9", "#f4c45a");
  add("bbq-bacon", burger({ patties: 1, bacon: true, bbq: true, cheese: true, onion: true }), "#f9e6d2", "#c97d4c");
  add("veggie", burger({ veggie: true, cheese: true }), "#eef8e1", "#a9d57a");
  add("mighty-stack", group(burger({ patties: 3, bacon: true, cheese: true, onion: true }), 400, 300, 0.82), "#ffe9d2", "#e6985c");
  add("fries", fries(), "#fff3d4", "#f4c65b");
  add("loaded-fries", fries(true), "#ffeed2", "#f2b04f");
  add("onion-rings", rings(), "#fff1d9", "#efb766");
  add("nuggets", nuggets(), "#fff0d6", "#eeb25f");
  add("wings", wings(), "#fde5d4", "#e58b5c");
  add("strips", strips(), "#fff0d6", "#eeb25f");
  add("coleslaw", coleslaw(), "#f0f7e4", "#bcd98a");
  add("cola", cup({ liquid: "#3b1a0c", label: "#e63946" }), "#ffe9e6", "#f19a8e");
  add("lemonade", cup({ liquid: "#f3e16a", label: "#3f9e4a", lemon: true, straw: "#2aa876" }), "#f3f9dc", "#c7e07a");
  add("water", cup({ liquid: "#bfe6f7", label: "#2a7fd1", straw: "#2a7fd1", ice: false }), "#e8f5fb", "#9dd0ea");
  add("choc-shake", shake("#6b3a22"), "#f7e5da", "#c99274");
  add("mango-shake", shake("#f6b630", "#fff4cf"), "#fff3d0", "#f2c451");
  add("brownie", brownie(), "#f3e4d6", "#c59a76");
  add("sundae", sundae(), "#fde8ef", "#f3a9bf");
  // combos
  add("deal-lunch", group(burger({ patties: 1, cheese: true }), 270, 330, 0.62) + group(fries(), 560, 340, 0.55) + group(cup({ liquid: "#3b1a0c", label: "#e63946" }), 680, 350, 0.5), "#fff0d6", "#f0a24e");
  add("deal-family", group(burger({ patties: 2 }), 200, 330, 0.5) + group(burger({ chicken: true }), 400, 300, 0.5) + group(burger({ patties: 1, cheese: true }), 600, 330, 0.5) + group(fries(), 300, 440, 0.4) + group(nuggets(), 500, 450, 0.4) + group(cup({ liquid: "#3b1a0c", label: "#e63946" }), 660, 430, 0.38), "#ffead2", "#ee9a55");
  add("deal-duo", group(burger({ patties: 1, cheese: true }), 240, 320, 0.55) + group(burger({ chicken: true }), 540, 320, 0.55) + group(fries(true), 400, 450, 0.45) + group(shake("#f7a8b8"), 660, 430, 0.4), "#fde4e4", "#ec8a8a");
  add("deal-student", group(burger({ chicken: true, tomato: false }), 290, 330, 0.62) + group(fries(), 540, 350, 0.52), "#e7f0ff", "#8fb4ee");
  // wide banners and the logo
  const ban = (inner: string, a: string, b: string) => scene(inner, a, b, 1600, 640);
  A.push({ file: "hero-smash", w: 1600, h: 640, svg: ban(group(burger({ patties: 2, cheese: true, onion: true }), 800, 330, 1.1) + group(fries(), 330, 400, 0.7) + group(cup({ liquid: "#3b1a0c", label: "#e63946" }), 1280, 400, 0.7), "#3a1a0d", "#120805") });
  A.push({ file: "hero-deals", w: 1600, h: 640, svg: ban(group(burger({ patties: 1, cheese: true }), 380, 330, 0.8) + group(burger({ chicken: true }), 800, 320, 0.9) + group(wings(), 1220, 380, 0.75), "#4a2210", "#1a0b05") });
  A.push({ file: "hero-sweet", w: 1600, h: 640, svg: ban(group(shake("#6b3a22"), 520, 340, 0.95) + group(sundae(), 1080, 350, 0.95) + group(brownie(), 800, 420, 0.5), "#3b1530", "#150616") });
  const logo = id("lg");
  A.push({ file: "logo", w: 256, h: 256, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>${grad(logo, "#ff8a3d", "#e0451b")}</defs><rect width="256" height="256" rx="56" fill="url(#${logo})"/><path d="M58 128 C58 66 198 66 198 128z" fill="#ffd9a0"/><rect x="52" y="136" width="152" height="16" rx="8" fill="#5b2c17"/><path d="M56 158 h144 l-12 -6 l-14 10 l-18 -10 l-20 10 l-20 -10 l-18 10z" fill="#7ac943"/><path d="M60 168 h136 q0 26 -26 26 h-84 q-26 0 -26 -26z" fill="#ffd9a0"/></svg>` });
  return A;
}
