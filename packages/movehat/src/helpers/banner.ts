type Rgb = [number, number, number];

// Warm yellow-to-amber palette for a subtle gradient.
const gradientPalette: Rgb[] = [
  [255, 239, 150],
  [255, 223, 88],
  [255, 207, 64],
  [255, 181, 45],
  [255, 160, 30],
];

const bannerLines = [
  " ███╗   ███╗ ██████╗ ██╗   ██╗███████╗██╗  ██╗ █████╗ ████████╗",
  " ████╗ ████║██╔═══██╗██║   ██║██╔════╝██║  ██║██╔══██╗╚══██╔══╝",
  " ██╔████╔██║██║   ██║██║   ██║█████╗  ███████║███████║   ██║   ",
  " ██║╚██╔╝██║██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██║██╔══██║   ██║   ",
  " ██║ ╚═╝ ██║╚██████╔╝ ╚████╔╝ ███████╗██║  ██║██║  ██║   ██║   ",
  " ╚═╝     ╚═╝ ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ",
];

const reset = "\x1b[0m";

const shouldColorize = () => process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);

const toAnsi = ([r, g, b]: Rgb) => `\x1b[38;2;${r};${g};${b}m`;

const applyGradient = (line: string, offset: number) => {
  let painted = "";
  for (let i = 0; i < line.length; i++) {
    const color = gradientPalette[(i + offset) % gradientPalette.length];
    painted += `${toAnsi(color)}${line[i]}`;
  }
  return painted;
};

export const renderMovehatBanner = () => {
  if (!shouldColorize()) {
    return bannerLines.join("\n");
  }

  const coloredLines = bannerLines.map((line, idx) => applyGradient(line, idx * 2));
  return `${coloredLines.join("\n")}${reset}`;
};

export const printMovehatBanner = () => {
  console.log(renderMovehatBanner());
};
