import { applyGradient, gradients, shouldUseColor, colors } from '../ui/index.js';

/**
 * MOVEHAT ASCII art banner lines
 */
const bannerLines = [
  " ███╗   ███╗ ██████╗ ██╗   ██╗███████╗██╗  ██╗ █████╗ ████████╗",
  " ████╗ ████║██╔═══██╗██║   ██║██╔════╝██║  ██║██╔══██╗╚══██╔══╝",
  " ██╔████╔██║██║   ██║██║   ██║█████╗  ███████║███████║   ██║   ",
  " ██║╚██╔╝██║██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██║██╔══██║   ██║   ",
  " ██║ ╚═╝ ██║╚██████╔╝ ╚████╔╝ ███████╗██║  ██║██║  ██║   ██║   ",
  " ╚═╝     ╚═╝ ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ",
];

/**
 * Divider line below the banner
 */
const dividerLine = "━".repeat(68);

/**
 * Tagline describing Movehat
 */
const tagline = "  A powerful testing framework for Move smart contracts";

/**
 * Render the Movehat banner with gradient colors
 * Uses the UI module's gradient system for consistency
 *
 * @returns Formatted banner string ready for console output
 *
 * @example
 * const banner = renderMovehatBanner();
 * console.log(banner);
 */
export const renderMovehatBanner = (): string => {
  if (!shouldUseColor()) {
    return `${bannerLines.join("\n")}\n${dividerLine}\n${tagline}`;
  }

  // Apply Movehat brand gradient to each line with varying offsets
  const coloredLines = bannerLines.map((line, idx) =>
    applyGradient(line, gradients.movehat, idx * 2)
  );

  // Apply gradient to divider line
  const coloredDivider = applyGradient(dividerLine, gradients.movehat, 0);

  // Dim the tagline for subtle appearance
  const coloredTagline = colors.dim(tagline);

  return `${coloredLines.join("\n")}\n${coloredDivider}\n${coloredTagline}`;
};

/**
 * Print the Movehat banner to console
 * Convenience function that renders and logs the banner
 *
 * @example
 * printMovehatBanner();
 */
export const printMovehatBanner = (): void => {
  console.log(renderMovehatBanner());
};
