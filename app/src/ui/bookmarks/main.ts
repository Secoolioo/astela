import { Translator, pickLanguage } from '../i18n/i18n.ts';
import { BookmarksPage } from './bookmarks-page.ts';

const i18n = new Translator(pickLanguage(navigator.languages));
document.documentElement.lang = i18n.language;
document.title = i18n.t('bookmarks.title');
customElements.define('bookmarks-page', BookmarksPage);
const page = new BookmarksPage();
page.i18n = i18n;
page.bridge = window.bridge;
document.body.append(page);
