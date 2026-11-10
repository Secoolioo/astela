import { brand } from '../../shared/brand.ts';
import { Translator, pageLanguage } from '../i18n/i18n.ts';
import { BrowserImport } from '../ui-kit/browser-import.ts';
import { DefaultBrowser } from '../ui-kit/default-browser.ts';
import { SetupGuide } from './setup-guide.ts';

const i18n = new Translator(pageLanguage());
document.documentElement.lang = i18n.language;
document.title = i18n.t('setup.title', { product: brand.productName });
customElements.define('browser-import', BrowserImport);
customElements.define('default-browser', DefaultBrowser);
customElements.define('setup-guide', SetupGuide);
const guide = new SetupGuide();
guide.i18n = i18n;
guide.bridge = window.bridge;
document.body.append(guide);
