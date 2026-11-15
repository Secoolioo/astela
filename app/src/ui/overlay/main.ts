import { Translator, pageLanguage } from '../i18n/i18n.ts';
import { OverlayBookmark } from './overlay-bookmark.ts';
import { OverlayMenu } from './overlay-menu.ts';
import { OverlayPage } from './overlay-page.ts';

const i18n = new Translator(pageLanguage());
document.documentElement.lang = i18n.language;
customElements.define('overlay-menu', OverlayMenu);
customElements.define('overlay-bookmark', OverlayBookmark);
customElements.define('overlay-page', OverlayPage);
const page = new OverlayPage();
page.i18n = i18n;
page.bridge = window.bridge;
document.body.append(page);
