# Product workspace design

Milestone 3 redesigns the existing React product workspace. The API, session/CSRF
client, exact monetary conversion, permissions, pagination bounds, and mutation
retry policy remain authoritative and unchanged. Inventory and orders are later
milestones; navigation must contain working destinations only.

## Direction and hierarchy

Use a warm off-white canvas, near-white panels, fine borders, restrained shadows,
and burgundy for primary actions, current navigation, links, and focus. Status
semantics remain separate: green success, amber warning, red error, neutral archive.
No gradients, decorative metrics, runtime fonts, tracking, or external assets.

The application header groups the OrderFlow home link, Products navigation, and
signed-in email/role/logout. It reflows into labeled rows on narrow screens without
hiding identity or actions. Login uses system sans-serif controls and a locally
available Georgia editorial heading. Normal product screens use the system stack.

Page title/actions, always-visible native status radios, page-size selection, and
refresh precede a named results panel. Prices are right aligned with tabular digits;
SKU uses a local monospace stack and wraps long values. Each row has a View action;
ADMIN additionally sees Edit for active rows. There are no action menus. Pagination
uses only the API's hasMore and visible row range, with the existing bounds. Empty
states offer creation to ADMIN and real filter/refresh actions to both roles.
OPERATOR has an explicit read-only label. Loading uses a static status indicator;
unavailable, forbidden, missing, and invalid-link states have distinct headings.

Query-only navigation retains focus on filters/page controls; changing screen paths
moves focus to the destination heading. Native radio arrow keys remain usable.
Details and grouped forms are refined in the remaining increment. Detail and form pages retain hash routes
and browser history rather than introducing drawers or nested dialogs. Full pages
leave room for long product names, maximum prices, and validation feedback on mobile.
Only archival uses a native modal confirmation.

## Tokens and current primitives

All shared tokens are CSS custom properties in `apps/web/src/styles.css`.

| Category  | Tokens / values                                                                    |
| --------- | ---------------------------------------------------------------------------------- |
| Brand     | `--color-brand` #7A3045; hover #68263A; pressed #501D2E                            |
| Surfaces  | canvas #F8F6F3; surface #FFFDFC; soft #F3EEEA; rose #F3E8EB                        |
| Text      | primary #302A2C; muted #686063; on-brand #FFFDFC                                   |
| Borders   | fine #DED4D6 for decoration; control #8B7A80 for required boundaries               |
| Success   | #285C48 on #EAF3ED                                                                 |
| Warning   | #86511B on #FFF4E4                                                                 |
| Error     | #A32724 on #FFF0ED                                                                 |
| Type      | system UI stack, Georgia login heading; 12/14/16/18/24px and responsive page title |
| Spacing   | 4/8/12/16/20/24/32/40/48/64px                                                      |
| Shape     | 4px small radius, 6px controls, 10px panels                                        |
| Elevation | subtle panel shadow; stronger modal shadow                                         |
| Focus     | 3px solid brand outline with a 3px offset                                          |

Shared classes cover buttons/links, labeled fields, help/errors, status badges,
panels, and layout. Extract React components only when current screens share a
concrete responsibility. Keep the existing session store, hooks, and hash navigation;
no component library, router, or state dependency is required.

## Accessibility and responsive decisions

Use semantic header/navigation/main landmarks and a skip link that focuses main
without altering the hash route. Navigation and status are labeled in text rather
than relying on color. Controls have visible focus and at least 44px height.
Required input boundaries and focus indicators target 3:1 against adjacent surfaces;
normal text targets 4.5:1, including muted and status text. Disabled controls retain
readable text even though inactive controls are exempt from non-text contrast.

Shared grids use `minmax(0, ...)`, wrapping text, and constrained inputs. Wide catalog
tables may scroll within an explicitly named, focusable region; the page itself must
reflow at 320px. Modal height is bounded by the viewport with internal scrolling.
Reduced-motion preferences disable animation, transitions, and smooth scrolling;
the design has no essential animation or sticky overlays.

References: W3C [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html),
[reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), and
[modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## Verification and limitations

Initial inspection used Playwright with the real API and random migrated test
databases on a separate PostgreSQL container; no local application data was used.
Before captures covered login, catalog, details, create/edit, and archive confirmation
at 1280x900 and 390x844. Concrete issues were left-aligned prices, absent application
navigation, an empty state without an administrator creation path, and ungrouped form
content with technical concurrency copy.

Token contrast checks run in the web unit suite; rendered-screen contrast, keyboard,
long-content, and narrow reflow checks will accompany the workspace increments.
Private synthetic captures stay outside Git and are never CI artifacts. This work
does not claim full accessibility compliance, screen-reader certification, support
for every browser/device, or production hosting.

No applicable frontend-design/UI/UX skill was available in this environment. The
implementation uses local code, Playwright, and W3C references; no skill was installed.
