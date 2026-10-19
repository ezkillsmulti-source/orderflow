import { useEffect, useRef, useState } from 'react';
import { ApiError, Cancelled, session, type Identity } from './api';
import { ErrorNotice, useCooldown } from './feedback';
import {
  listLink,
  listing,
  pageFrom,
  type Listing,
  type Page,
} from './catalog-data';
import { ArchiveDialog } from './ArchiveDialog';
import { EditProduct, ProductForm } from './ProductForm';
import { useProduct } from './use-product';
import { formatPrice } from './money';
import {
  BackLink,
  LoadingState,
  PageHeader,
  WorkspaceState,
} from './workspace';

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#products');
  useEffect(() => {
    const change = () => setHash(window.location.hash || '#products');
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  function navigate(next: string) {
    setHash(next);
    window.location.hash = next;
  }
  return [hash, navigate] as const;
}
export function Status({ active }: { active: boolean }) {
  return (
    <span className={`badge ${active ? '' : 'archived'}`}>
      {active ? 'Active' : 'Archived'}
    </span>
  );
}
function ReadError({
  error,
  retry,
  inline = false,
}: {
  error: ApiError;
  retry: () => void;
  inline?: boolean;
}) {
  const blocked = useCooldown(error);
  const title =
    error.status === 404
      ? 'Product not found'
      : error.status === 403
        ? 'Access restricted'
        : error.status === 400
          ? 'Check the catalog link'
          : error.status === 429
            ? 'Requests paused'
            : 'Products unavailable';
  return (
    <WorkspaceState
      title={title}
      headingLevel={inline ? 2 : 1}
      actions={
        <>
          {error.status !== 404 && (
            <button onClick={retry} disabled={blocked}>
              Try again
            </button>
          )}
          <a href="#products">Back to products</a>
        </>
      }
    >
      <ErrorNotice error={error} />
    </WorkspaceState>
  );
}

function ProductDetail({
  id,
  back,
  admin,
}: {
  id: string;
  back: string;
  admin: boolean;
}) {
  const [archive, setArchive] = useState(false);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const state = useProduct(id, revision);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [state.data?.id]);
  if (state.error)
    return (
      <ReadError
        error={state.error}
        retry={() => setRevision((value) => value + 1)}
      />
    );
  if (!state.data) return <LoadingState>Loading product…</LoadingState>;
  const data = state.data;
  return (
    <>
      <BackLink href={back}>Back to products</BackLink>
      <PageHeader
        title={data.name}
        eyebrow="Product details"
        headingRef={heading}
        actions={
          admin && data.active ? (
            <>
              <a className="button primary" href={`#products/${data.id}/edit`}>
                Edit product
              </a>
              <button className="danger" onClick={() => setArchive(true)}>
                Archive product
              </button>
            </>
          ) : undefined
        }
      />
      <div className="detail-context">
        <Status active={data.active} />
        {!data.active ? (
          <p className="help">
            Archived · Available to read. Editing and reactivation are
            unavailable.
          </p>
        ) : !admin ? (
          <p className="help">
            Read-only access · Your team’s administrators manage product
            details.
          </p>
        ) : (
          <p className="help">Available in the active catalog.</p>
        )}
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {archive && admin && data.active && (
        <ArchiveDialog
          data={data}
          close={(refresh = false) => {
            setArchive(false);
            if (refresh) setRevision((value) => value + 1);
          }}
          archived={() => {
            setArchive(false);
            setNotice('Product archived.');
            setRevision((value) => value + 1);
          }}
        />
      )}
      <div className="detail-grid">
        <section className="card" aria-labelledby="identity-title">
          <h2 id="identity-title">Product information</h2>
          <dl className="product-facts">
            <div>
              <dt>SKU</dt>
              <dd>
                <code>{data.sku}</code>
              </dd>
            </div>
          </dl>
          <h3>Description</h3>
          <p className="description">
            {data.description ?? 'No description provided.'}
          </p>
        </section>
        <section className="card price-card" aria-labelledby="price-title">
          <h2 id="price-title">Price</h2>
          <p className="detail-price">{formatPrice(data.priceMinor)}</p>
          <p className="help">ARS · Argentine pesos</p>
        </section>
      </div>
    </>
  );
}
function ProductList({
  page,
  back,
  remember,
  admin,
  navigate,
}: {
  page: Page;
  back: string;
  remember: (back: string) => void;
  admin: boolean;
  navigate: (next: string) => void;
}) {
  const [state, setState] = useState<{ data?: Listing; error?: ApiError }>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState({});
    const params = new URLSearchParams({
      status: page.status,
      limit: String(page.limit),
      offset: String(page.offset),
    });
    void session
      .request<unknown>(`/products?${params}`)
      .then(listing)
      .then((data) => {
        if (active) setState({ data });
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof Cancelled))
          setState({
            error: error instanceof ApiError ? error : new ApiError(502),
          });
      });
    return () => {
      active = false;
    };
  }, [page.status, page.limit, page.offset, revision]);
  function change(next: Page) {
    navigate(listLink(next));
  }
  const title =
    page.status === 'all'
      ? 'All products'
      : page.status === 'archived'
        ? 'Archived products'
        : 'Active products';
  return (
    <>
      <PageHeader
        title="Products"
        description={
          admin
            ? 'Manage the details, prices and records your team works with.'
            : 'Browse your team’s catalog, including archived records.'
        }
        actions={
          admin ? (
            <a
              className="button primary"
              href="#products/new"
              onClick={() => remember(back)}
            >
              <span aria-hidden="true">+</span>Create product
            </a>
          ) : (
            <span className="read-only-label">Read-only access</span>
          )
        }
      />
      <div className="catalog-toolbar">
        <fieldset className="status-filter">
          <legend>Product status</legend>
          <div className="filter-options">
            {(['active', 'archived', 'all'] as const).map((status) => (
              <label key={status}>
                <input
                  type="radio"
                  name="product-status"
                  value={status}
                  checked={page.status === status}
                  onChange={() => change({ ...page, status, offset: 0 })}
                />
                <span>
                  {page.status === status && <span aria-hidden="true">✓ </span>}
                  {status === 'all'
                    ? 'All products'
                    : status === 'active'
                      ? 'Active'
                      : 'Archived'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field page-size">
          <label htmlFor="page-size">Products per page</label>
          <select
            id="page-size"
            value={page.limit}
            onChange={(event) =>
              change({ ...page, limit: Number(event.target.value), offset: 0 })
            }
          >
            {[...new Set([10, 25, 50, 100, page.limit])]
              .sort((a, b) => a - b)
              .map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
          </select>
        </div>
        <button onClick={() => setRevision((value) => value + 1)}>
          Refresh products
        </button>
      </div>
      <section className="results-panel" aria-label="Product results">
        <div className="results-heading">
          <h2>{title}</h2>
          {Boolean(state.data?.items.length) && (
            <p className="help mobile-hint" id="table-scroll-help">
              Scroll the table horizontally to see all columns.
            </p>
          )}
        </div>
        {state.error ? (
          <ReadError
            inline
            error={state.error}
            retry={() => setRevision((value) => value + 1)}
          />
        ) : !state.data ? (
          <LoadingState>Loading products…</LoadingState>
        ) : (
          <>
            {state.data.items.length ? (
              <div
                className="table-scroll"
                role="region"
                aria-label="Product catalog"
                aria-describedby="table-scroll-help"
                tabIndex={0}
              >
                <table>
                  <caption className="sr-only">
                    {title}. Prices in Argentine pesos.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Product name</th>
                      <th scope="col">SKU</th>
                      <th scope="col" className="price">
                        Price (ARS)
                      </th>
                      <th scope="col">Status</th>
                      <th scope="col" className="row-actions">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.items.map((data) => (
                      <tr key={data.id}>
                        <td className="name-cell">
                          <a
                            className="product-name"
                            href={`#products/${data.id}`}
                            onClick={() => remember(back)}
                          >
                            {data.name}
                          </a>
                        </td>
                        <td className="sku-cell">
                          <code>{data.sku}</code>
                        </td>
                        <td className="price">
                          {formatPrice(data.priceMinor)}
                        </td>
                        <td>
                          <Status active={data.active} />
                        </td>
                        <td>
                          <div className="row row-actions">
                            <a
                              href={`#products/${data.id}`}
                              aria-label={`View ${data.name}`}
                              onClick={() => remember(back)}
                            >
                              View
                            </a>
                            {admin && data.active && (
                              <a
                                href={`#products/${data.id}/edit`}
                                aria-label={`Edit ${data.name}`}
                                onClick={() => remember(back)}
                              >
                                Edit
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <WorkspaceState
                title={
                  page.status === 'archived'
                    ? 'No archived products'
                    : 'No products to show'
                }
                actions={
                  <>
                    {admin && page.status !== 'archived' && (
                      <a className="button primary" href="#products/new">
                        Create a product
                      </a>
                    )}
                    {page.status !== 'all' && (
                      <a
                        className="button"
                        href={listLink({ ...page, status: 'all', offset: 0 })}
                      >
                        View all products
                      </a>
                    )}
                    {page.status === 'all' && !admin && (
                      <button onClick={() => setRevision((value) => value + 1)}>
                        Check again
                      </button>
                    )}
                  </>
                }
              >
                <p>
                  {page.status === 'archived'
                    ? 'Archived products stay here for reference. You can read them at any time.'
                    : admin
                      ? 'Add a product to keep its name, SKU and price in one place, or choose another status filter.'
                      : 'Choose another status filter or check back when your team adds products.'}
                </p>
              </WorkspaceState>
            )}
            <div className="row between pagination">
              <p className="help" role="status">
                {state.data.items.length
                  ? `Showing ${page.offset + 1}–${page.offset + state.data.items.length}`
                  : 'This page is empty.'}
              </p>
              <nav className="row" aria-label="Product pages">
                <button
                  disabled={page.offset === 0}
                  onClick={() =>
                    change({
                      ...page,
                      offset: Math.max(0, page.offset - page.limit),
                    })
                  }
                >
                  Previous
                </button>
                <button
                  disabled={
                    !state.data.pagination.hasMore ||
                    page.offset + page.limit > 10000
                  }
                  onClick={() =>
                    change({ ...page, offset: page.offset + page.limit })
                  }
                >
                  Next
                </button>
              </nav>
            </div>
            {state.data.pagination.hasMore &&
              page.offset + page.limit > 10000 && (
                <p className="pagination-limit">
                  The catalog navigation limit has been reached. Choose a status
                  filter to narrow the list.
                </p>
              )}
          </>
        )}
      </section>
    </>
  );
}
export function Catalog({ user }: { user: Identity }) {
  const admin = user.role === 'ADMIN';
  const [hash, navigate] = useHash();
  const container = useRef<HTMLDivElement>(null);
  const [back, remember] = useState('#products');
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  useEffect(() => {
    document.title = 'Products · OrderFlow';
    container.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [path]);
  let content;
  try {
    if (path === 'products')
      content = (
        <ProductList
          page={pageFrom(query)}
          back={hash}
          remember={remember}
          admin={admin}
          navigate={navigate}
        />
      );
    else if (path === 'products/new')
      content = admin ? (
        <ProductForm />
      ) : (
        <ReadError
          error={new ApiError(403)}
          retry={() => {
            window.location.hash = '#products';
          }}
        />
      );
    else if (/^products\/[0-9a-f-]{36}\/edit$/i.test(path ?? ''))
      content = admin ? (
        <EditProduct key={path} id={path!.split('/')[1]!} />
      ) : (
        <ReadError
          error={new ApiError(403)}
          retry={() => {
            window.location.hash = '#products';
          }}
        />
      );
    else if (/^products\/[0-9a-f-]{36}$/i.test(path ?? ''))
      content = (
        <ProductDetail
          key={path}
          id={path!.split('/')[1]!}
          back={back}
          admin={admin}
        />
      );
    else
      content = (
        <ReadError
          error={new ApiError(404)}
          retry={() => {
            window.location.hash = '#products';
          }}
        />
      );
  } catch (error) {
    content = (
      <ReadError
        error={error instanceof ApiError ? error : new ApiError(400)}
        retry={() => {
          window.location.hash = '#products';
        }}
      />
    );
  }
  return <div ref={container}>{content}</div>;
}
