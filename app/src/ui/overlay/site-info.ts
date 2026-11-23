import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type { CertificateSummary, SiteInformation } from '../../shared/ipc/overlay-contracts.ts';
import type { Translator } from '../i18n/i18n.ts';
import { switchStyles } from '../ui-kit/choice-styles.ts';
import { fingerprintText } from '../ui-kit/fingerprint.ts';
import { popoverStyles } from '../ui-kit/popover-styles.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';
import { placePopover } from './placement.ts';
import { enter } from './popover-motion.ts';

type MessageKey = Parameters<Translator['t']>[0];

/** The title of each connection. */
const titles = {
  secure: 'shell.secure',
  insecure: 'shell.notSecure',
  local: 'shell.localPage',
  certificate: 'shell.notSecure',
  accepted: 'shell.notSecure',
  'allowed-http': 'shell.notSecure',
} as const satisfies Record<SiteInformation['connection'], MessageKey>;

/** What each connection means, in a regular and in a private window. */
const notes = {
  secure: ['overlay.site.secureNote', 'overlay.site.secureNote'],
  insecure: ['overlay.site.insecureNote', 'overlay.site.insecureNote'],
  local: ['overlay.site.localNote', 'overlay.site.localNote'],
  certificate: ['overlay.site.certificateNote', 'overlay.site.certificateNote'],
  accepted: ['overlay.site.acceptedNote', 'overlay.site.acceptedNotePrivate'],
  'allowed-http': ['overlay.site.allowedHttpNote', 'overlay.site.allowedHttpNotePrivate'],
} as const satisfies Record<SiteInformation['connection'], readonly [MessageKey, MessageKey]>;

/** Why a certificate is not trusted. */
const reasons = {
  authority: 'overlay.site.reason.authority',
  date: 'overlay.site.reason.date',
  name: 'overlay.site.reason.name',
  other: 'overlay.site.reason.other',
} as const satisfies Record<NonNullable<SiteInformation['reason']>, MessageKey>;

/** The names of the permissions and of pop-ups, as the settings page names them. */
const permissionNames = {
  camera: 'settings.permission.camera',
  microphone: 'settings.permission.microphone',
  location: 'settings.permission.location',
  notifications: 'settings.permission.notifications',
  clipboard: 'settings.permission.clipboard',
  popups: 'settings.permission.popups',
} as const satisfies Record<SiteInformation['permissions'][number]['name'], MessageKey>;

/**
 * Site information at the chip of the connection in the address bar: how the page is
 * connected and why that is secure or not, the certificate of the site, the permissions that
 * it was given or refused, its cookies and data, which it deletes after a question in place,
 * and the content blocker on it. A warning shows only its connection and certificate. The
 * popover takes the focus itself, Tab stays inside it, and Escape or a click next to it closes
 * it. Below the chip, at its start (ADR 0059).
 */
export class SiteInfoPopover extends LitElement {
  static override properties = {
    content: { attribute: false },
    confirming: { state: true },
  };

  /** Styles of the popover, scoped to its shadow root. */
  static override styles = [
    popoverStyles,
    switchStyles,
    css`
      :host {
        display: contents;
      }
      section.popover {
        position: fixed;
        top: 0;
        left: 0;
        width: 320px;
        max-width: calc(100vw - 2 * var(--space-2));
        padding: var(--space-3);
        overflow-y: auto;
      }
      section.popover:focus-visible {
        outline: none;
      }
      h2 {
        margin: 0;
        font-size: var(--font-size-larger);
        font-weight: var(--font-weight-strong);
        overflow-wrap: anywhere;
      }
      h3 {
        margin: 0 0 var(--space-1);
        font-size: inherit;
        font-weight: var(--font-weight-strong);
      }
      p {
        margin: 0 0 var(--space-1);
        overflow-wrap: anywhere;
      }
      .part {
        margin-top: var(--space-3);
        padding-top: var(--space-3);
        border-top: 1px solid var(--line-1);
      }
      .connection {
        display: flex;
        gap: var(--space-2);
        margin-top: var(--space-2);
      }
      .connection .mark {
        display: grid;
        flex: none;
        color: var(--text-2);
      }
      .connection[data-safe='false'] .mark,
      .connection[data-safe='false'] .title {
        color: var(--danger);
      }
      .title {
        font-weight: var(--font-weight-medium);
      }
      .note {
        color: var(--text-2);
      }
      svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      details {
        margin-top: var(--space-1);
      }
      summary {
        cursor: default;
      }
      .fingerprint {
        display: block;
        margin: 0 0 var(--space-1);
        font-family: ui-monospace, monospace;
        font-size: var(--font-size-small);
        overflow-wrap: anywhere;
        user-select: text;
      }
      ul {
        margin: 0 0 var(--space-1);
        padding-inline-start: var(--space-4);
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        padding: var(--space-1) 0;
      }
      .count strong {
        font-weight: var(--font-weight-strong);
      }
      button {
        margin-top: var(--space-2);
        padding: var(--space-1) var(--space-2);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-2);
        color: inherit;
        font: inherit;
        text-align: start;
      }
      button:hover {
        background: var(--surface-hover);
      }
      button.danger {
        border-color: var(--danger);
        color: var(--danger);
      }
      .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      :focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 1px;
      }
    `,
  ];

  declare content: SiteInformation | undefined;
  /** Whether the popover asks whether to delete the cookies and data of the site. */
  declare confirming: boolean;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  /** Whether the popover only leaves the page, so that it takes no focus and changes nothing. */
  leaving = false;
  /** Whether the popover entered the page already. */
  private entered = false;
  /** Whether the button that asks gets the focus back, as the question went once deleted. */
  private focusAsk = false;

  constructor() {
    super();
    this.content = undefined;
    this.confirming = false;
  }

  /** The surface of the popover, which leaves the page when it closes. */
  surfaces(): HTMLElement[] {
    const surface = this.renderRoot.querySelector<HTMLElement>('section.popover');
    return surface === null ? [] : [surface];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // The question about deleting ends once a deletion is done, or another page shows; any other
    // change, such as a count of the content blocker, leaves it open.
    if (!changed.has('content')) return;
    const previous = changed.get('content');
    const deleted = previous?.cleared !== true && this.content?.cleared === true;
    if (deleted || previous?.id !== this.content?.id) {
      this.focusAsk = this.confirming && deleted;
      this.confirming = false;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    const surface = this.renderRoot.querySelector<HTMLElement>('section.popover');
    const content = this.content;
    if (surface === null || content === undefined) return;
    const placement = placePopover(
      content.anchor,
      { width: surface.offsetWidth, height: surface.scrollHeight },
      { width: innerWidth, height: innerHeight },
      { align: 'start' },
    );
    surface.style.left = `${placement.x}px`;
    surface.style.top = `${placement.y}px`;
    surface.style.maxHeight = `${placement.maxHeight}px`;
    surface.toggleAttribute('data-above', placement.above);
    if (this.focusAsk) {
      this.focusAsk = false;
      // Delete went with the question; its focus goes to the button that asks, unless people
      // moved it meanwhile.
      if ((this.shadowRoot?.activeElement ?? null) === null && !this.leaving) {
        this.renderRoot.querySelector<HTMLElement>('button.ask')?.focus();
      }
    }
    if (this.entered || this.leaving || !changed.has('content')) return;
    this.entered = true;
    enter(surface, placement.above);
    // The dialog takes the focus, not one of its controls, so that a key meant for the page
    // changes nothing; Tab reaches its controls.
    surface.focus();
  }

  override render(): TemplateResult | typeof nothing {
    const content = this.content;
    if (content === undefined) return nothing;
    return html`<section
      class="popover"
      role="dialog"
      tabindex="-1"
      aria-label=${this.t('shell.siteInfo')}
      @keydown=${this.onKey}
    >
      <h2>${content.host}</h2>
      ${this.renderConnection(content)} ${this.renderCertificate(content)}
      ${
        content.page
          ? html`${this.renderPermissions(content)} ${this.renderCookies(content)}
              ${this.renderBlocker(content)}
              <div class="part">
                <button type="button" @click=${() => this.invoke('overlay.openSiteSettings', {})}>
                  ${this.t('overlay.site.settings')}
                </button>
              </div>`
          : nothing
      }
    </section>`;
  }

  /** How the page is connected, what that means, and the way back to the warning. */
  private renderConnection(content: SiteInformation): TemplateResult {
    const { connection } = content;
    const safe = connection === 'secure' || connection === 'local';
    const id = { id: content.id };
    return html`<div class="connection" data-safe=${String(safe)}>
      <span class="mark" aria-hidden="true">${marks[connection]}</span>
      <div>
        <p class="title">${this.t(titles[connection])}</p>
        <p class="note">${this.t(notes[connection][content.private ? 1 : 0])}</p>
        ${
          content.reason === null
            ? nothing
            : html`<p class="note">${this.t(reasons[content.reason], { code: content.code })}</p>`
        }
        ${
          connection === 'accepted' || connection === 'allowed-http'
            ? html`<button type="button" @click=${() => this.invoke('overlay.restoreWarnings', id)}>
                ${this.t(
                  connection === 'accepted'
                    ? 'overlay.site.restoreWarnings'
                    : 'overlay.site.useHttps',
                )}
              </button>`
            : nothing
        }
      </div>
    </div>`;
  }

  /** The certificate of an https page or of a warning about one. */
  private renderCertificate(content: SiteInformation): TemplateResult | typeof nothing {
    const { connection, certificate } = content;
    if (connection !== 'secure' && connection !== 'certificate' && connection !== 'accepted') {
      return nothing;
    }
    return html`<div class="part">
      <h3>${this.t('overlay.site.certificate')}</h3>
      ${
        certificate === null
          ? html`<p class="note">${this.t('overlay.site.certificateUnknown')}</p>`
          : this.renderCertificateDetails(certificate)
      }
    </div>`;
  }

  private renderCertificateDetails(certificate: CertificateSummary): TemplateResult {
    const fingerprint = fingerprintText(certificate.fingerprint);
    return html`<p>
        ${this.t('overlay.site.issuedTo', {
          name: named(certificate.subject, certificate.subjectOrganization),
        })}
      </p>
      <p>
        ${this.t('overlay.site.issuedBy', {
          name: named(certificate.issuer, certificate.issuerOrganization),
        })}
      </p>
      <p>${this.t('overlay.site.validUntil', { date: this.date(certificate.validUntil) })}</p>
      <details>
        <summary>${this.t('problem.details')}</summary>
        <p>${this.t('overlay.site.validFrom', { date: this.date(certificate.validFrom) })}</p>
        ${
          fingerprint === ''
            ? nothing
            : html`<p class="note">${this.t('overlay.site.fingerprint')}</p>
                <code class="fingerprint">${fingerprint}</code>`
        }
        ${
          certificate.chain.length === 0
            ? nothing
            : html`<p class="note">${this.t('overlay.site.chain')}</p>
                <ul>
                  ${certificate.chain.map((name) => html`<li>${name}</li>`)}
                </ul>`
        }
      </details>
      ${
        certificate.knownRoot === false
          ? html`<p class="note">${this.t('overlay.site.addedRoot')}</p>`
          : nothing
      }`;
  }

  /** The permissions that were decided for the site, and its pop-ups, each with its switch. */
  private renderPermissions(content: SiteInformation): TemplateResult {
    const id = content.id;
    return html`<div class="part">
      <h3>${this.t('overlay.site.permissions')}</h3>
      ${
        content.permissions.length === 0
          ? html`<p class="note">${this.t('overlay.site.permissionsNone')}</p>`
          : content.permissions.map(
              (row) =>
                html`<label class="row">
                  <span>${this.t(permissionNames[row.name])}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    .checked=${row.allowed}
                    ?disabled=${content.managed}
                    @change=${(event: Event) =>
                      this.invoke('overlay.setSitePermission', {
                        id,
                        permission: row.name,
                        allowed: event.target instanceof HTMLInputElement && event.target.checked,
                      })}
                  />
                </label>`,
            )
      }
      ${content.managed ? html`<p class="note">${this.t('settings.managed')}</p>` : nothing}
      ${
        content.permissions.length > 0 && !content.managed
          ? html`<button
              type="button"
              @click=${() => this.invoke('overlay.resetSitePermissions', { id })}
            >
              ${this.t('overlay.site.permissionsReset')}
            </button>`
          : nothing
      }
      ${
        content.changed
          ? html`<p class="note" role="status">${this.t('overlay.site.reloadNote')}</p>
              <button type="button" @click=${() => this.invoke('overlay.reloadTab', { id })}>
                ${this.t('overlay.site.reload')}
              </button>`
          : nothing
      }
      ${
        content.private
          ? html`<p class="note">${this.t('overlay.site.permissionsPrivate')}</p>`
          : nothing
      }
    </div>`;
  }

  /** How many cookies the site has, and the deletion of its cookies and data. */
  private renderCookies(content: SiteInformation): TemplateResult {
    const site = { site: content.site };
    return html`<div class="part">
      <h3>${this.t('overlay.site.cookies')}</h3>
      ${
        content.cookies === null
          ? nothing
          : html`<p>${this.t('overlay.site.cookieCount', { count: String(content.cookies) })}</p>`
      }
      ${
        content.cleared
          ? html`<p class="note" role="status">${this.t('overlay.site.cookiesDeleted', site)}</p>`
          : nothing
      }
      ${
        this.confirming
          ? html`<p role="alert">${this.t('overlay.site.cookiesConfirm', site)}</p>
              <div class="buttons">
                <button type="button" @click=${() => (this.confirming = false)}>
                  ${this.t('overlay.cancel')}
                </button>
                <button
                  type="button"
                  class="danger"
                  @click=${() => this.invoke('overlay.clearSiteData', { id: content.id })}
                >
                  ${this.t('overlay.site.cookiesDeleteNow')}
                </button>
              </div>`
          : html`<button type="button" class="ask" @click=${this.confirm}>
              ${this.t('overlay.site.cookiesDelete')}
            </button>`
      }
    </div>`;
  }

  /**
   * The switch of the content blocker for the site, which a policy that sets the sites without
   * blocking locks, and what it blocked on the page.
   */
  private renderBlocker(content: SiteInformation): TemplateResult | typeof nothing {
    const blocker = content.blocker;
    if (blocker === null) return nothing;
    return html`<div class="part">
      <h3>${this.t('shell.blocker')}</h3>
      <label class="row">
        <span>${this.t('overlay.blockOnSite', { site: blocker.site })}</span>
        <input
          type="checkbox"
          role="switch"
          .checked=${live(blocker.on)}
          ?disabled=${!blocker.available || blocker.managed}
          @change=${() => this.invoke('overlay.toggleSiteBlocking', { id: content.id })}
        />
      </label>
      <p class="count">
        <strong>${blocker.blocked}</strong> <span>${this.t('overlay.blocked')}</span>
      </p>
      ${
        blocker.failed
          ? html`<p class="note" role="alert">${this.t('settings.contentBlockerFailed')}</p>`
          : !blocker.available
            ? html`<p class="note">${this.t('overlay.blockerOff')}</p>`
            : blocker.managed
              ? html`<p class="note">${this.t('settings.managed')}</p>`
              : nothing
      }
    </div>`;
  }

  /** Asks in place whether to delete the cookies and data, with the focus on Delete. */
  private readonly confirm = (): void => {
    if (this.leaving) return;
    this.confirming = true;
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>('button.danger')?.focus(),
    );
  };

  /** Sends a request of the popover, unless it only leaves the page. */
  private invoke(
    channel:
      | 'overlay.setSitePermission'
      | 'overlay.resetSitePermissions'
      | 'overlay.clearSiteData'
      | 'overlay.restoreWarnings'
      | 'overlay.reloadTab'
      | 'overlay.toggleSiteBlocking'
      | 'overlay.openSiteSettings',
    request: Record<string, unknown>,
  ): void {
    if (!this.leaving) void this.bridge?.invoke(channel, request);
  }

  /** A date as people of the page's language read it, such as `Mar 4, 2027`. */
  private date(seconds: number): string {
    return new Intl.DateTimeFormat(this.i18n?.language, { dateStyle: 'medium' }).format(
      new Date(seconds * 1000),
    );
  }

  /** Tab goes round inside the popover. */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const stops = [
      ...this.renderRoot.querySelectorAll<HTMLElement>('button, input, summary'),
    ].filter((stop) => !stop.matches(':disabled') && stop.offsetParent !== null);
    const first = stops[0];
    const last = stops.at(-1);
    const at = this.shadowRoot?.activeElement;
    if (event.shiftKey && (at === first || at === null) && last !== undefined) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === last && first !== undefined) {
      event.preventDefault();
      first.focus();
    }
  };

  private t(key: MessageKey, params?: Readonly<Record<string, string>>): string {
    return this.i18n?.t(key, params) ?? key;
  }
}

/** A name of a certificate with its organization, when it has one. */
function named(name: string, organization: string): string {
  return organization === '' || organization === name ? name : `${name} (${organization})`;
}

/** The mark of each connection, drawn after Lucide (ISC license). */
const lock = html`<svg viewBox="0 0 24 24">
  <rect width="16" height="11" x="4" y="11" rx="2" />
  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
</svg>`;
const warning = html`<svg viewBox="0 0 24 24">
  <path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3" />
  <path d="M12 9v4M12 17h.01" />
</svg>`;
const info = html`<svg viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="10" />
  <path d="M12 16v-4M12 8h.01" />
</svg>`;
const marks = {
  secure: lock,
  insecure: warning,
  local: info,
  certificate: warning,
  accepted: warning,
  'allowed-http': warning,
} as const satisfies Record<SiteInformation['connection'], TemplateResult>;
