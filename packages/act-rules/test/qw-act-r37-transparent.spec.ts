import { expect } from 'chai';
import { launchBrowser } from './util';
import { LocaleFetcher } from '@qualweb/locale';
import { Browser } from 'puppeteer';

interface EvaluationReport {
  assertions: Record<string, { metadata: { outcome: string; warning: number } }>;
}

/**
 * Regression tests for https://github.com/qualweb/qualweb/issues/262
 *
 * Text with a fully transparent foreground (color alpha × opacity === 0) is
 * not visible per the ACT definition of visibility, so QW-ACT-R37 must not
 * report a contrast failure for it. This covers the common screen-reader-only
 * technique of hiding text with `color: transparent` (and `opacity: 0`, which
 * additionally exercises the fixed opacity check in DomUtils.isElementVisible).
 */
describe('QW-ACT-R37 transparent text (issue #262)', function () {
  let browser: Browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    await browser.close();
  });

  async function evaluate(sourceCode: string): Promise<EvaluationReport> {
    const incognito = await browser.createBrowserContext();
    const page = await incognito.newPage();

    try {
      await page.setContent(sourceCode, { waitUntil: 'load' });

      await page.addScriptTag({
        path: require.resolve('@qualweb/qw-page')
      });

      await page.addScriptTag({
        path: require.resolve('@qualweb/util')
      });

      await page.addScriptTag({
        path: require.resolve('../dist/__webpack/act.bundle.js')
      });

      return (await page.evaluate(
        (locale, sourceCode) => {
          // @ts-expect-error: ACTRulesRunner will be defined within the puppeteer execution context.
          window.act = new ACTRulesRunner({ include: ['QW-ACT-R37'] }, { translate: locale, fallback: locale });
          // @ts-expect-error: window.act has been defined earlier.
          window.act.configure({ include: ['QW-ACT-R37'] });
          // @ts-expect-error: window.act has been defined earlier.
          window.act.test({ sourceHtml: sourceCode });
          // @ts-expect-error: window.act has been defined earlier.
          return window.act.getReport();
        },
        LocaleFetcher.get('en'),
        sourceCode
      )) as EvaluationReport;
    } finally {
      await incognito.close();
    }
  }

  async function outcomeOf(snippet: string): Promise<{ outcome: string; warning: number }> {
    const report = await evaluate(
      `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body>${snippet}</body></html>`
    );
    const rule = report.assertions['QW-ACT-R37'];
    return { outcome: rule.metadata.outcome, warning: rule.metadata.warning };
  }

  it('is inapplicable for text with color: transparent', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(`<p style="color: transparent">Invisible but screen-reader accessible</p>`);
    expect(outcome).to.equal('inapplicable');
  });

  it('is inapplicable for text with color: rgba(0, 0, 0, 0)', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(`<p style="color: rgba(0,0,0,0)">Invisible but screen-reader accessible</p>`);
    expect(outcome).to.equal('inapplicable');
  });

  it('is inapplicable for text that inherits a transparent color', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(`<div style="color: transparent"><span>Inherited invisible text</span></div>`);
    expect(outcome).to.equal('inapplicable');
  });

  it('is inapplicable for text hidden with opacity: 0', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(`<p style="opacity: 0">Invisible via opacity</p>`);
    expect(outcome).to.equal('inapplicable');
  });

  it('still warns for transparent text with a text-shadow that may render it legible', async function () {
    this.timeout(0);
    const { warning } = await outcomeOf(
      `<p style="color: transparent; text-shadow: 2px 2px 4px #000">Shadow-rendered text</p>`
    );
    expect(warning).to.equal(1);
  });

  it('still fails genuinely low-contrast text', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<p style="color: #999; background-color: #fff">Genuinely low contrast text</p>`
    );
    expect(outcome).to.equal('failed');
  });

  it('still passes high-contrast text', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(`<p style="color: #000; background-color: #fff">High contrast text</p>`);
    expect(outcome).to.equal('passed');
  });

  it('is inapplicable when a form field has no text-node child', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(`<input placeholder="Rendered placeholder" />`);
    expect(outcome).to.equal('inapplicable');
  });

  it('is inapplicable for deeply nested text in a disabled widget', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<button disabled style="color:#aaa;background:#fff"><span><em>Disabled text</em></span></button>`
    );
    expect(outcome).to.equal('inapplicable');
  });

  it('is inapplicable for descendant text in a disabled semantic group', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<div role="group" aria-disabled="true" style="color:#aaa;background:#fff"><span>Disabled text</span></div>`
    );
    expect(outcome).to.equal('inapplicable');
  });

  it('is inapplicable for descendant text in a disabled role derived from group and widget', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<div role="row" aria-disabled="true" style="color:#aaa;background:#fff"><span>Disabled row text</span></div>`
    );
    expect(outcome).to.equal('inapplicable');
  });

  it('composites a semi-transparent background over its actual ancestor', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<div style="background:#000"><p style="color:#fff;background:rgba(255,255,255,.5)">Low contrast text</p></div>`
    );
    expect(outcome).to.equal('failed');
  });

  it('applies element opacity to text and its background as one group', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<div style="background:#000"><p style="color:#fff;background:#fff;opacity:.5">Invisible text</p></div>`
    );
    expect(outcome).to.equal('inapplicable');
  });

  it('does not round a contrast ratio below 4.5 up to the threshold', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<p style="color:rgb(46.588% 46.588% 46.588%);background:#fff">Borderline contrast</p>`
    );
    expect(outcome).to.equal('failed');
  });

  it('treats 14pt text with a variable weight of 750 as large bold text', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<p style="color:#000;background:#666;font-size:14pt;font-weight:750">Large bold text</p>`
    );
    expect(outcome).to.equal('passed');
  });

  it('does not treat 18.66px bold text as meeting the exact 14pt threshold', async function () {
    this.timeout(0);
    const { outcome } = await outcomeOf(
      `<p style="color:#000;background:#666;font-size:18.66px;font-weight:700">Not quite large text</p>`
    );
    expect(outcome).to.equal('failed');
  });

  it('warns when a gradient is too complex to evaluate reliably', async function () {
    this.timeout(0);
    const { warning } = await outcomeOf(
      `<p style="color:#000;background:linear-gradient(to right,#fff,#000,#fff)">Complex gradient</p>`
    );
    expect(warning).to.equal(1);
  });

  it('warns for a horizontal gradient that appears to have sufficient contrast', async function () {
    this.timeout(0);
    const { warning } = await outcomeOf(
      `<p style="color:#333;background:linear-gradient(to right,#fff,#00f);width:500px">Some text in English</p>`
    );
    expect(warning).to.equal(1);
  });

  it('warns for a horizontal gradient that appears to have insufficient contrast', async function () {
    this.timeout(0);
    const { warning } = await outcomeOf(
      `<p style="color:#aaa;background:linear-gradient(to right,#fff,#00f);width:300px">Some text in English</p>`
    );
    expect(warning).to.equal(1);
  });
});
