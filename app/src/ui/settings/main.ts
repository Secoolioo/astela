import { Translator, pickLanguage } from '../i18n/i18n.ts';
import { SettingsPage } from './settings-page.ts';

const i18n = new Translator(pickLanguage(navigator.languages));
document.documentElement.lang = i18n.language;
document.title = i18n.t('settings.title');
customElements.define('settings-page', SettingsPage);
const page = new SettingsPage();
page.i18n = i18n;
page.bridge = window.bridge;
document.body.append(page);
