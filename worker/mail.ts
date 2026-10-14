import type { MailDigest } from './workspaceEngine';

/** A link that opens a comment thread in the app. */
export const threadLink = (appUrl: string, planId: string, threadId: string) =>
  `${appUrl.replace(/\/+$/, '')}/#comment=${encodeURIComponent(planId)}/${encodeURIComponent(threadId)}`;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A header-safe single line. */
const line = (s: string, max = 200) => s.replace(/[\r\n]+/g, ' ').slice(0, max);

/** The email telling someone they were mentioned (one or several times). */
export function mentionEmail(d: MailDigest, appUrl: string): { subject: string; text: string; html: string } {
  const first = d.items[0];
  const others = new Set(d.items.map((i) => i.actorName)).size;
  const subject = line(
    d.items.length === 1
      ? `${first.actorName} mentioned you in ${first.planName}`
      : `You were mentioned ${d.items.length} times${others === 1 ? ` by ${first.actorName}` : ''}`,
  );
  const off = 'To stop these emails, open Mentions in the app and turn off “Email me when I’m mentioned”.';
  const text = [
    ...d.items.map((i) =>
      [`${i.actorName} mentioned you on ${i.label} (${i.planName}):`, `  ${i.text}`, `  ${threadLink(appUrl, i.planId, i.threadId)}`].join('\n'),
    ),
    off,
  ].join('\n\n');
  const html = `<!doctype html><html><body style="font-family: system-ui, sans-serif; color: #1f2933; line-height: 1.45">
${d.items
  .map(
    (i) => `<div style="margin: 0 0 20px">
  <div><strong>${escape(i.actorName)}</strong> mentioned you on <strong>${escape(i.label)}</strong> <span style="color:#667">(${escape(i.planName)})</span></div>
  <blockquote style="margin: 8px 0; padding: 4px 12px; border-left: 3px solid #c8d1dc; color: #333; white-space: pre-wrap">${escape(i.text)}</blockquote>
  <a href="${escape(threadLink(appUrl, i.planId, i.threadId))}">Open the thread</a>
</div>`,
  )
  .join('\n')}
<p style="color:#667; font-size: 12px">${escape(off)}</p>
</body></html>`;
  return { subject, text, html };
}
