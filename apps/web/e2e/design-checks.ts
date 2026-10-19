import { expect, type Locator, type Page } from '@playwright/test';

export async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
export async function textContrast(locator: Locator) {
  const pair = await locator.evaluate((element) => {
    function background(node: Element | null): string {
      while (node) {
        const color = getComputedStyle(node).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent')
          return color;
        node = node.parentElement;
      }
      throw new Error('No opaque background for contrast check.');
    }
    return {
      foreground: getComputedStyle(element).color,
      background: background(element),
    };
  });
  const ratio = contrast(pair.foreground, pair.background);
  expect(
    ratio,
    `text ${pair.foreground} on ${pair.background}`,
  ).toBeGreaterThanOrEqual(4.5);
  return ratio;
}
export async function boundaryContrast(
  locator: Locator,
  property: 'borderTopColor' | 'outlineColor',
) {
  const pair = await locator.evaluate((element, property) => {
    const style = getComputedStyle(element);
    let parent = element.parentElement;
    let background = '';
    while (parent) {
      const color = getComputedStyle(parent).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
        background = color;
        break;
      }
      parent = parent.parentElement;
    }
    return {
      foreground: style[property],
      background,
      visible:
        property !== 'outlineColor' ||
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2),
    };
  }, property);
  expect(pair.visible, 'visible focus indicator').toBe(true);
  expect(
    contrast(pair.foreground, pair.background),
    `${property} on adjacent surface`,
  ).toBeGreaterThanOrEqual(3);
}
function contrast(a: string, b: string) {
  function luminance(color: string) {
    const channels = color.match(/[\d.]+/g)?.map(Number);
    if (
      !channels ||
      channels.length < 3 ||
      (channels.length === 4 && channels[3] !== 1)
    )
      throw new Error('Contrast check needs opaque RGB colors.');
    const [r, g, blue] = channels.slice(0, 3).map((value) => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return r! * 0.2126 + g! * 0.7152 + blue! * 0.0722;
  }
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high! + 0.05) / (low! + 0.05);
}
