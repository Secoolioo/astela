import { Translator, pickLanguage } from '../i18n/i18n.ts';
import { OverlayPage } from './overlay-page.ts';

const i18n = new Translator(pickLanguage(navigator.languages));
document.documentElement.lang = i18n.language;
customElements.define('overlay-page', OverlayPage);
const page = new OverlayPage();
page.i18n = i18n;
page.bridge = window.bridge;
document.body.append(page);
