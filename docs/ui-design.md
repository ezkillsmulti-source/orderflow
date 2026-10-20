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
Pagination buttons stay mounted and focusable while results load, at page boundaries,
and after read failures. They expose aria-disabled and guard activation until a valid
page allows the requested move. This preserves keyboard position without allowing
extra requests or exceeding bounds. No row range is shown while results are unavailable.
Detail and form pages retain hash routes and browser history rather than introducing
drawers or nested dialogs. Full pages leave room for long product names, maximum prices, and validation feedback on mobile.
Archival and image removal use native modal confirmations; only one can open at a time.

Details put the product name and permitted actions above a text status/context row,
then group SKU/description and the exact ARS price in separate panels. OPERATOR and
archived records explicitly explain read-only availability. Names, SKUs, and descriptions
wrap without truncating the record. On mobile the price panel comes before lengthy
record information so the price remains discoverable even with a full description.
Create/edit use labeled Product identity and Pricing fieldsets, descriptive help, and a consistent Cancel/primary-save footer. Required
fields have native required semantics; validation announces a summary, associates
individual errors with inputs, and focuses the first invalid field in visual order.
Recoverable API errors preserve entered values; unchanged edits cannot be submitted.
Concurrency policy belongs in the API documentation, not normal form copy.

Archive confirmation names the product, explains permanent read-only availability,
and initially focuses Keep product active. Escape and cancellation restore the opener;
keyboard focus remains inside the native modal with explicit Tab/Shift+Tab wrapping
between its action buttons (including Chromium’s browser-chrome edge case).
If the archive response is lost,
Keep product active becomes Check product status: that deliberate action closes the
modal and performs a read, never replays the write or claims the product stayed active.
Busy confirmation cannot be dismissed. Successful archival reloads the server record.

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
panels, and layout. Small PageHeader, BackLink, WorkspaceState, and LoadingState
components serve the existing screens; status badges and archive confirmation remain
focused catalog components. Extract React components only when current screens share a
concrete responsibility. Keep the existing session store, hooks, and hash navigation;
no component library, router, or state dependency is required.

## Accessibility and responsive decisions

Use semantic header/navigation/main landmarks and a skip link that focuses main
without altering the hash route. Navigation and status are labeled in text rather
than relying on color. Controls have visible focus; buttons and form inputs have
at least 44px height.
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
[modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), and
the [HTML dialog specification](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element).
The dialog itself has no tabindex; focus targets its action buttons.

## Verification and limitations

Initial inspection used Playwright with the real API and random migrated test
databases on a separate PostgreSQL container; no local application data was used.
Before captures covered login, catalog, details, create/edit, and archive confirmation
at 1280x900 and 390x844. Concrete issues were left-aligned prices, absent application
navigation, an empty state without an administrator creation path, and ungrouped form
content with technical concurrency copy.

Final checks passed: 43 web tests, 30 real-API Chromium browser checks, root
formatting/lint/typecheck, and API/web builds. Rendered login, catalog, detail,
create/edit, and confirmation were inspected at desktop and narrow mobile sizes.
Token contrast checks run in the web unit suite. Browser checks measure computed
foreground/background combinations, control borders, and visible focus outlines;
they exercise keyboard filters, error associations, modal focus/restoration, long
content, maximum money, and page reflow down to 320px.
The token suite checks 18 text combinations and 12 control/focus combinations,
using unrounded relative luminance. Representative measured combinations:

| Foreground / background           | Contrast |
| --------------------------------- | -------- |
| Primary text / canvas             | 13.04:1  |
| Muted text / surface              | 6.02:1   |
| Muted text / soft (disabled text) | 5.30:1   |
| Brand text/focus / surface        | 8.86:1   |
| On-brand text / hover brand       | 10.75:1  |
| Control border / surface          | 3.99:1   |
| Control border / rose             | 3.38:1   |
| Success / success surface         | 6.83:1   |
| Warning / warning surface         | 6.02:1   |
| Error / error surface             | 6.59:1   |

Browser assertions additionally check actual computed styles on login controls,
normal/hover primary actions, alerts, filter selection/focus, catalog text, form
labels/help/errors, input boundaries/focus, the table scroll region, and archive
warning/actions. Decorative separators do not identify required controls.
Private synthetic captures stay outside Git and are never CI artifacts. This work
does not claim full accessibility compliance, screen-reader certification, support
for every browser/device, or production hosting.

No applicable frontend-design/UI/UX skill was available in this environment. The
implementation uses local code, Playwright, and W3C references; no skill was installed.

## Review feedback

The user inspected the isolated local preview and reported that the design looks
good and works correctly. This is user feedback from manual use, recorded separately
from the automated verification above; it is not an additional test run, a complete
acceptance audit, or proof of accessibility compliance.

## Primary image display (milestone 4A)

Catalog pictures occupy a reserved 56px square beside the linked product name,
without adding columns or hiding SKU/price/status/actions. Details reserve a 4:3
frame, with contain sizing to preserve the actual image aspect ratio. A muted icon
and explicit accessible labels distinguish No image from Image unavailable. Loading
reserves the same frame. Images use descriptive alt text and authenticated,
application-relative URLs; malformed/foreign descriptor URLs are rejected before
rendering. Administrator image management is described below. Existing burgundy
colors, focus treatment, table scroll region, and hash navigation are retained.

## Administrator image management

Active ADMIN details place the current image beside a labeled file chooser and
limits, stacking these on mobile. Selection creates a separate, smaller local
preview; Upload selected image is the explicit confirmation. Client MIME/size
checks are usability aids (unknown/octet-stream types reach server validation),
not a substitute for content/dimension/animation checks. Recoverable errors keep
selection; field errors describe the input and focus it after the request. A failed
local preview has explicit text and does not falsely claim server validation.

Object URLs are view-owned and revoked on replacement, discard, navigation, logout,
role/session boundaries, and confirmed mutation. Files/URLs/tokens are never stored
persistently. Uncertain upload outcomes disable image mutations and selection until
Check image status performs a deliberate read. There is no mutation replay.

Removal uses a native modal with initial focus on Keep image, a bounded action-button
Tab loop, Escape cancellation and opener restoration. An uncertain removal or archival conflict changes
the safe action to Check image status and disables repeated removal. Confirmed
mutations refresh the server record and focus the product heading. Archived products
and OPERATOR keep the complete image display without management controls. No nested
dialog, gallery, remote URL import, crop editor, or extra navigation is added.

Image frontend verification passed locally: 58 web tests and all 52 real-API browser
cases (20 image cases) at desktop/mobile viewports. Actual image decoding, keyboard
modal actions/restoration, upload error focus, computed helper/action/error text and
focus contrast, and 320px reflow were asserted. Private synthetic captures of the
catalog, details, fallbacks, selection, validation and removal modal were inspected
at 1280x900 and 390x844. Existing burgundy/semantic tokens are reused. This is not a
full accessibility audit or proof for untested browser engines/devices.
