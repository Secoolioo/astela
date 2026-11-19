import type { Request, Session } from 'electron';

/**
 * Lets Chromium decide about every certificate that the connections of a session present, and
 * then hands what it checked to a note, such as the log of site information (ADR 0059). The
 * answer comes first and at once: `-3` keeps Chromium's own result, with Certificate
 * Transparency, which `0` would turn off; a note that fails changes nothing about it, and a
 * connection never waits for the note. A session has one such function: one that is set later
 * takes its place.
 * @param session - A session of web content.
 * @param note - Takes what Chromium checked; it must not change the decision.
 */
export function answerWithChromium(session: Session, note: (request: Request) => void): void {
  session.setCertificateVerifyProc((request, callback) => {
    callback(-3);
    try {
      note(request);
    } catch {
      // The note only records; Chromium has decided already.
    }
  });
}
