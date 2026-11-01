import { brand } from '../../shared/brand.ts';
import { Translator, pickLanguage } from '../i18n/i18n.ts';
import { BrowserImport } from '../ui-kit/browser-import.ts';
import { SetupGuide } from './setup-guide.ts';

const i18n = new Translator(pickLanguage(navigator.languages));
document.documentElement.lang = i18n.language;
document.title = i18n.t('setup.title', { product: brand.productName });
customElements.define('browser-import', BrowserImport);
customElements.define('setup-guide', SetupGuide);
const guide = new SetupGuide();
guide.i18n = i18n;
guide.bridge = window.bridge;
document.body.append(guide);
