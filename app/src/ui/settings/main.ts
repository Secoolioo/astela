import { Translator, pickLanguage } from '../i18n/i18n.ts';
import { BrowserImport } from '../ui-kit/browser-import.ts';
import { DefaultBrowser } from '../ui-kit/default-browser.ts';
import { SettingsPage } from './settings-page.ts';

const i18n = new Translator(pickLanguage(navigator.languages));
document.documentElement.lang = i18n.language;
document.title = i18n.t('settings.title');
customElements.define('browser-import', BrowserImport);
customElements.define('default-browser', DefaultBrowser);
customElements.define('settings-page', SettingsPage);
const page = new SettingsPage();
page.i18n = i18n;
page.bridge = window.bridge;
document.body.append(page);
