import html from './app.generated.json';
export const APP_URI = 'ui://capacity-planning/workspace.html';
export const APP_MIME = 'text/html;profile=mcp-app';
/** No remote scripts, network access or permissions: tools go through the authenticated host bridge. */
export const APP_META = { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } };
export { html as appHtml };
