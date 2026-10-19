import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const colors = Object.fromEntries(
  [...css.matchAll(/--color-([\w-]+):\s*(#[a-f\d]{6})/gi)].map((match) => [
    match[1],
    match[2]!,
  ]),
);
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
}
function contrast(foreground: string, background: string) {
  const [low, high] = [
    luminance(colors[foreground]!),
    luminance(colors[background]!),
  ].sort((a, b) => a - b);
  return (high! + 0.05) / (low! + 0.05);
}
it('keeps actual design-token text combinations above AA normal-text contrast', () => {
  for (const background of ['canvas', 'surface', 'soft', 'rose']) {
    for (const foreground of ['text', 'muted', 'brand'])
      expect(
        contrast(foreground, background),
        `${foreground}/${background}`,
      ).toBeGreaterThanOrEqual(4.5);
  }
  for (const background of ['brand', 'brand-hover', 'brand-pressed'])
    expect(contrast('on-brand', background), background).toBeGreaterThanOrEqual(
      4.5,
    );
  for (const semantic of ['success', 'warning', 'error'])
    expect(
      contrast(semantic, `${semantic}-soft`),
      semantic,
    ).toBeGreaterThanOrEqual(4.5);
});
it('keeps required control and focus boundaries above 3:1 on workspace surfaces', () => {
  for (const background of ['canvas', 'surface', 'soft', 'rose']) {
    for (const foreground of ['control', 'brand', 'error'])
      expect(
        contrast(foreground, background),
        `${foreground}/${background}`,
      ).toBeGreaterThanOrEqual(3);
  }
});
