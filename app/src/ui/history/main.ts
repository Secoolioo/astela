import { Translator, pageLanguage } from '../i18n/i18n.ts';
import { HistoryPage } from './history-page.ts';

const i18n = new Translator(pageLanguage());
document.documentElement.lang = i18n.language;
document.title = i18n.t('history.title');
customElements.define('history-page', HistoryPage);
const page = new HistoryPage();
page.i18n = i18n;
page.bridge = window.bridge;
document.body.append(page);
