import type { QWElement } from '@qualweb/qw-element';
import { ElementExists, ElementIsHTMLElement, ElementIsNot, ElementIsVisible } from '@qualweb/util/applicability';
import { Test, Verdict } from '@qualweb/core/evaluation';
import { AtomicRule } from '../lib/AtomicRule.object';
import Color from 'colorjs.io';

interface RGBColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface NonSolidEvaluation {
  test: Test;
  element: QWElement;
  background: string;
  text: string;
}

interface RenderedText {
  text: string;
  pseudoStyle: '::placeholder' | null;
  styleElement?: QWElement;
}

interface RenderedStyles {
  foreground: string;
  fontSize: string;
  fontWeight: string;
  opacity: number;
  textShadow: string;
}

/** Result of resolving an element's effective solid background. */
type BackgroundResolution =
  | { kind: 'color'; background: RGBColor; foreground: RGBColor }
  | { kind: 'cantTell'; resultCode: 'W2' | 'W3' };

const WHITE: RGBColor = { red: 255, green: 255, blue: 255, alpha: 1 };
const TRANSPARENT: RGBColor = { red: 0, green: 0, blue: 0, alpha: 0 };
const LARGE_BOLD_TEXT_PX = (14 * 96) / 72;
const LARGE_TEXT_PX = (18 * 96) / 72;
const NON_TEXT_INPUT_TYPES = new Set(['hidden', 'range', 'color', 'checkbox', 'radio', 'image']);
const PLACEHOLDER_INPUT_TYPES = new Set(['text', 'search', 'tel', 'url', 'email', 'password', 'number']);
const PLACEHOLDER_STYLE_PROPERTIES = ['color', 'opacity', 'font-size', 'font-weight', 'text-shadow'];

/** Concrete WAI-ARIA roles whose superclass is group or widget. */
const GROUP_OR_WIDGET_ROLES = new Set([
  'group',
  'button',
  'checkbox',
  'columnheader',
  'combobox',
  'grid',
  'gridcell',
  'link',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'progressbar',
  'radio',
  'radiogroup',
  'row',
  'rowheader',
  'scrollbar',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'tablist',
  'textbox',
  'toolbar',
  'tree',
  'treegrid',
  'treeitem'
]);

/**
 * QW-ACT-R37 — text has sufficient colour contrast.
 *
 * The implementation resolves solid foreground/background pixels through
 * ancestor opacity groups. Image and gradient backgrounds produce a warning
 * because the painted pixels behind the text cannot be inferred reliably. In
 * addition to afw4f7's text-node targets, rendered form-control text is checked
 * to cover the values and placeholders that WCAG 1.4.3 also requires.
 */
class QW_ACT_R37 extends AtomicRule {
  /** Memoised accessible-name roots for disabled widgets. */
  private disabledLabelCache?: { source: unknown; selectors: Set<string> };

  @ElementExists
  @ElementIsHTMLElement
  @ElementIsNot(['html', 'head', 'body', 'script', 'style', 'meta'])
  @ElementIsVisible
  execute(element: QWElement): void {
    if (!window.DomUtils.isElementVisible(element)) return;

    const renderedText = this.getRenderedText(element);
    if (renderedText.text === '') return;

    if (!element.isElementHTMLElement()) return;

    if (this.hasDisabledAncestorOrLabel(element, window.disabledWidgets)) return;

    const renderedStyles = this.getRenderedStyles(element, renderedText);
    const fgColor = renderedStyles.foreground;
    const bgColor = this.getBackground(element);
    const opacity = this.parseOpacity(element.getElementStyleProperty('opacity', null));
    const pseudoOpacity = renderedStyles.opacity;
    const fontSize = renderedStyles.fontSize;
    const fontWeight = renderedStyles.fontWeight;
    const textShadow = renderedStyles.textShadow;

    const test = new Test();

    // Text shadow that could obscure contrast → cannot be evaluated automatically.
    if (this.hasDisqualifyingShadow(textShadow, parseFloat(fontSize))) {
      this.emit(test, element, Verdict.WARNING, 'W1');
      return;
    }

    // Fully transparent text (color alpha × opacity === 0) is not visible —
    // per the ACT definition of visibility, making it fully transparent
    // changes no rendered pixels — so the rule is inapplicable. This is the
    // common screen-reader-only technique from issue #262. Checked after the
    // text-shadow warning because a shadow can still render such text legible.
    const parsedFG = this.parseRGBString(fgColor);
    if (parsedFG && parsedFG.alpha * pseudoOpacity * opacity === 0) return;

    if (
      this.evaluateNonSolidBackground({
        test,
        element,
        background: bgColor,
        text: renderedText.text
      })
    )
      return;

    // Solid background.
    if (!parsedFG) return;
    parsedFG.alpha *= pseudoOpacity;
    const colors = this.resolveSolidColors(element, parsedFG);
    if (colors.kind === 'cantTell') {
      this.emit(test, element, Verdict.WARNING, colors.resultCode);
      return;
    }

    // NOTE: when fg === bg (contrast 1:1) the original rule emits no result.
    // Preserved intentionally; flip to an explicit F1 here if that contract
    // should change.
    if (this.equals(colors.background, colors.foreground)) return;

    if (!this.isHumanLanguage(renderedText.text)) {
      this.emit(test, element, Verdict.PASSED, 'P2');
      return;
    }

    const contrastRatio = this.getContrast(colors.background, colors.foreground);
    const isValid = this.hasValidContrastRatio(contrastRatio, fontSize, this.isBold(fontWeight));
    this.emit(test, element, isValid ? Verdict.PASSED : Verdict.FAILED, isValid ? 'P1' : 'F1');
  }

  // ---------------------------------------------------------------------------
  // Applicability helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the text that is currently painted by the element. Form controls
   * expose their rendered text through DOM properties rather than text-node
   * children, so values changed at runtime are intentionally preferred over
   * their original attributes.
   */
  private getRenderedText(element: QWElement): RenderedText {
    const nodeName = element.getElementTagName();

    if (nodeName === 'input') return this.getInputText(element);
    if (nodeName === 'textarea') return this.getTextAreaText(element);
    if (nodeName === 'select') return this.getSelectText(element);
    return { text: element.getElementOwnText().trim(), pseudoStyle: null };
  }

  private getInputText(element: QWElement): RenderedText {
    const inputType = (element.getElementProperty('type') || 'text').toLowerCase();
    if (NON_TEXT_INPUT_TYPES.has(inputType)) return { text: '', pseudoStyle: null };

    const value = element.getElementProperty('value').trim();
    if (value !== '') return { text: value, pseudoStyle: null };

    if (inputType === 'submit') return { text: 'Submit', pseudoStyle: null };
    if (inputType === 'reset') return { text: 'Reset', pseudoStyle: null };

    const placeholder = element.getElementAttribute('placeholder')?.trim() ?? '';
    return PLACEHOLDER_INPUT_TYPES.has(inputType) && placeholder !== ''
      ? { text: placeholder, pseudoStyle: '::placeholder' }
      : { text: '', pseudoStyle: null };
  }

  private getTextAreaText(element: QWElement): RenderedText {
    const value = element.getElementProperty('value').trim();
    if (value !== '') return { text: value, pseudoStyle: null };

    const placeholder = element.getElementAttribute('placeholder')?.trim() ?? '';
    return placeholder !== '' ? { text: placeholder, pseudoStyle: '::placeholder' } : { text: '', pseudoStyle: null };
  }

  private getSelectText(element: QWElement): RenderedText {
    const selectedOption = element.getElement('option:checked');
    const selectedText = selectedOption
      ? (selectedOption.getElementProperty('label') || selectedOption.getElementText()).trim()
      : '';
    return { text: selectedText, pseudoStyle: null, styleElement: selectedOption ?? undefined };
  }

  private getRenderedStyles(element: QWElement, renderedText: RenderedText): RenderedStyles {
    const pseudoStyles = renderedText.pseudoStyle
      ? element.getElementPseudoStyleProperties(PLACEHOLDER_STYLE_PROPERTIES, renderedText.pseudoStyle)
      : undefined;
    const styleElement = renderedText.styleElement ?? element;
    return {
      foreground: this.getRenderedStyleProperty(styleElement, pseudoStyles, 'color'),
      fontSize: this.getRenderedStyleProperty(styleElement, pseudoStyles, 'font-size'),
      fontWeight: this.getRenderedStyleProperty(styleElement, pseudoStyles, 'font-weight'),
      opacity: renderedText.pseudoStyle ? this.getPseudoOpacity(element, pseudoStyles) : 1,
      textShadow: this.getRenderedStyleProperty(styleElement, pseudoStyles, 'text-shadow')
    };
  }

  private getRenderedStyleProperty(
    element: QWElement,
    pseudoStyles: Record<string, string> | undefined,
    property: string
  ): string {
    const pseudoValue = pseudoStyles?.[property]?.trim();
    return pseudoValue &&
      !['currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(pseudoValue.toLowerCase())
      ? pseudoValue
      : element.getElementStyleProperty(property, null);
  }

  private getPseudoOpacity(element: QWElement, pseudoStyles: Record<string, string> | undefined): number {
    const value = pseudoStyles?.opacity?.trim().toLowerCase();
    if (value === 'inherit') {
      return this.parseOpacity(element.getElementStyleProperty('opacity', null));
    }
    if (!value || ['initial', 'unset', 'revert', 'revert-layer'].includes(value)) return 1;
    return this.parseOpacity(value);
  }

  private getDisabledLabelSelectors(widgets: QWElement[] | undefined): Set<string> {
    const cache = this.disabledLabelCache;
    if (cache && cache.source === widgets) {
      return cache.selectors;
    }

    const selectors = new Set<string>();
    for (const widget of widgets ?? []) {
      const accNameSelectors = window.AccessibilityUtils.getAccessibleNameSelector(widget) as
        | string
        | string[]
        | undefined;

      if (typeof accNameSelectors === 'string') {
        selectors.add(accNameSelectors);
      } else if (Array.isArray(accNameSelectors)) {
        for (const selector of accNameSelectors) selectors.add(selector);
      }
    }

    this.disabledLabelCache = { source: widgets, selectors };
    return selectors;
  }

  private hasDisabledAncestorOrLabel(element: QWElement, widgets: QWElement[] | undefined): boolean {
    const disabledLabels = this.getDisabledLabelSelectors(widgets);
    let current: QWElement | null = element;

    while (current) {
      if (disabledLabels.has(current.getElementSelector()) || this.isDisabledGroupOrWidget(current)) return true;
      current = current.getElementParent();
    }
    return false;
  }

  private isDisabledGroupOrWidget(element: QWElement): boolean {
    const role = window.AccessibilityUtils.getElementRole(element);
    if (!role || !GROUP_OR_WIDGET_ROLES.has(role)) return false;
    const disabled = element.getElementAttribute('disabled') !== null;
    const ariaDisabled = element.getElementAttribute('aria-disabled') === 'true';
    return disabled || ariaDisabled;
  }

  /**
   * Returns true for a text-shadow large/blurry enough that it may affect the
   * effective contrast and therefore can't be judged automatically.
   *
   * Handles every comma-separated shadow layer (not just the first), shadows
   * given without a blur radius (e.g. "3px 3px"), and px/em/rem length units.
   * Colour functions such as rgba(...) — whose commas would otherwise split a
   * layer apart — are respected.
   */
  private hasDisqualifyingShadow(textShadow: string | null, fontSizePx: number): boolean {
    if (!textShadow) return false;
    const trimmed = textShadow.trim();
    if (trimmed === '' || trimmed === 'none') return false;

    for (const layer of this.splitShadowLayers(trimmed)) {
      const lengths = layer.split(/\s+/).filter((token) => /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em)$/.test(token));
      // A valid shadow needs at least offset-x and offset-y; blur is optional.
      if (!lengths || lengths.length < 2) continue;

      const horizontal = Math.abs(this.shadowLengthToPx(lengths[0], fontSizePx));
      const vertical = Math.abs(this.shadowLengthToPx(lengths[1], fontSizePx));
      const blur = lengths[2] ? this.shadowLengthToPx(lengths[2], fontSizePx) : 0;

      if (blur > 0 || horizontal > 1 || vertical > 1) return true;
    }
    return false;
  }

  /** Splits a text-shadow value into layers on top-level commas only. */
  private splitShadowLayers(value: string): string[] {
    const layers: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of value) {
      if (char === '(') depth++;
      else if (char === ')') depth = Math.max(0, depth - 1);

      if (char === ',' && depth === 0) {
        layers.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) layers.push(current.trim());
    return layers;
  }

  /** Converts a px/em/rem length to pixels. Computed styles are usually already
   *  in px; em uses the element font-size, rem assumes a 16px root. */
  private shadowLengthToPx(length: string, fontSizePx: number): number {
    const numeric = parseFloat(length);
    if (length.endsWith('rem')) return numeric * 16;
    if (length.endsWith('em')) return numeric * (Number.isFinite(fontSizePx) ? fontSizePx : 16);
    return numeric;
  }

  // ---------------------------------------------------------------------------
  // Background resolution
  // ---------------------------------------------------------------------------

  /** Resolves the rendered text and background pixels through ancestor opacity groups. */
  private resolveSolidColors(element: QWElement, textColor: RGBColor): BackgroundResolution {
    let background = { ...TRANSPARENT };
    let foreground = { ...textColor };
    let current: QWElement | null = element;
    let isTarget = true;

    while (current) {
      const layer = this.getBackground(current);
      if (this.isImage(layer)) return { kind: 'cantTell', resultCode: 'W2' };
      if (this.isGradient(layer)) return { kind: 'cantTell', resultCode: 'W3' };

      const layerColor = this.parseRGBString(layer);
      if (!layerColor) return { kind: 'cantTell', resultCode: 'W3' };

      if (isTarget) {
        background = layerColor;
        foreground = this.compositeColors(foreground, layerColor);
        isTarget = false;
      } else {
        background = this.compositeColors(background, layerColor);
        foreground = this.compositeColors(foreground, layerColor);
      }

      const opacity = this.parseOpacity(current.getElementStyleProperty('opacity', null));
      background.alpha *= opacity;
      foreground.alpha *= opacity;
      current = current.getElementParent();
    }

    return {
      kind: 'color',
      background: this.compositeColors(background, WHITE),
      foreground: this.compositeColors(foreground, WHITE)
    };
  }

  private getBackground(element: QWElement): string {
    const bgImg = element.getElementStyleProperty('background-image', null);
    if (bgImg && bgImg !== 'none' && bgImg !== '') return bgImg;
    const bgColor = element.getElementStyleProperty('background-color', null);
    return bgColor && bgColor !== '' && bgColor !== 'transparent'
      ? bgColor
      : element.getElementStyleProperty('background', null);
  }

  private isImage(background: string): boolean {
    const lower = background.toLowerCase();
    return lower.includes('.jpg') || lower.includes('.png') || lower.includes('.svg') || lower.includes('url(');
  }

  private isGradient(background: string): boolean {
    return background.toLowerCase().includes('gradient(');
  }

  private parseOpacity(value: string | null): number {
    const opacity = parseFloat(value ?? '1');
    return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  }

  private evaluateNonSolidBackground(options: NonSolidEvaluation): boolean {
    if (this.isImage(options.background)) {
      this.emit(options.test, options.element, Verdict.WARNING, 'W2');
      return true;
    }
    if (!this.isGradient(options.background)) return false;

    const humanLanguage = this.isHumanLanguage(options.text);
    this.emit(
      options.test,
      options.element,
      humanLanguage ? Verdict.WARNING : Verdict.PASSED,
      humanLanguage ? 'W3' : 'P2'
    );
    return true;
  }

  // ---------------------------------------------------------------------------
  // Colour maths
  // ---------------------------------------------------------------------------

  private parseRGBString(colorString: string): RGBColor | undefined {
    if (!colorString || colorString === 'transparent' || colorString === 'none') {
      return { red: 0, green: 0, blue: 0, alpha: 0 };
    }

    try {
      const srgb = new Color(colorString).to('srgb');
      return {
        red: srgb.coords[0] * 255,
        green: srgb.coords[1] * 255,
        blue: srgb.coords[2] * 255,
        alpha: srgb.alpha ?? 1
      };
    } catch {
      return undefined;
    }
  }

  private compositeColors(fg: RGBColor, bg: RGBColor): RGBColor {
    const alpha = fg.alpha + bg.alpha * (1 - fg.alpha);
    if (alpha === 0) return { ...TRANSPARENT };
    return {
      red: (fg.red * fg.alpha + bg.red * bg.alpha * (1 - fg.alpha)) / alpha,
      green: (fg.green * fg.alpha + bg.green * bg.alpha * (1 - fg.alpha)) / alpha,
      blue: (fg.blue * fg.alpha + bg.blue * bg.alpha * (1 - fg.alpha)) / alpha,
      alpha
    };
  }

  private getContrast(bg: RGBColor, fg: RGBColor): number {
    const finalFG = fg.alpha < 1 ? this.compositeColors(fg, bg) : fg;
    const L1 = this.getLuminance(bg);
    const L2 = this.getLuminance(finalFG);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  }

  private getLuminance(c: RGBColor): number {
    const [r, g, b] = [c.red, c.green, c.blue].map((value) => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }

  private hasValidContrastRatio(contrast: number, fontSize: string, isBold: boolean): boolean {
    const size = parseFloat(fontSize);
    const threshold = (isBold && size >= LARGE_BOLD_TEXT_PX) || size >= LARGE_TEXT_PX ? 3 : 4.5;
    return contrast >= threshold;
  }

  private isBold(fontWeight: string): boolean {
    const numericWeight = Number.parseFloat(fontWeight);
    return Number.isFinite(numericWeight) ? numericWeight >= 700 : ['bold', 'bolder'].includes(fontWeight);
  }

  private equals(c1: RGBColor, c2: RGBColor): boolean {
    return c1.red === c2.red && c1.green === c2.green && c1.blue === c2.blue && c1.alpha === c2.alpha;
  }

  // ---------------------------------------------------------------------------
  // DomUtils passthroughs
  // ---------------------------------------------------------------------------

  private isHumanLanguage(text: string): boolean {
    return window.DomUtils.isHumanLanguage(text);
  }

  // ---------------------------------------------------------------------------
  // Result emission
  // ---------------------------------------------------------------------------

  private emit(test: Test, element: QWElement, verdict: Verdict, resultCode: string): void {
    test.verdict = verdict;
    test.resultCode = resultCode;
    test.addElement(element);
    this.addTestResult(test);
  }
}

export { QW_ACT_R37 };
