import { useEffect, useRef, useState } from 'react';
import { ApiError, Cancelled, session, type Identity } from './api';
import { ErrorNotice, useCooldown } from './feedback';
import {
  listLink,
  listing,
  pageFrom,
  product,
  type Listing,
  type Page,
  type Product,
} from './catalog-data';
import { formatPrice } from './money';

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#products');
  useEffect(() => {
    const change = () => setHash(window.location.hash || '#products');
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return hash;
}
export function Status({ active }: { active: boolean }) {
  return (
    <span className={`badge ${active ? '' : 'archived'}`}>
      {active ? 'Active' : 'Archived'}
    </span>
  );
}
function ReadError({ error, retry }: { error: ApiError; retry: () => void }) {
  const blocked = useCooldown(error);
  return (
    <section className="card stack">
      <ErrorNotice error={error} />
      {error.status !== 404 && (
        <button onClick={retry} disabled={blocked}>
          Try again
        </button>
      )}
      <a href="#products">Back to products</a>
    </section>
  );
}
export function useProduct(id: string, revision = 0) {
  const [state, setState] = useState<{ data?: Product; error?: ApiError }>({});
  useEffect(() => {
    let active = true;
    setState({});
    void session
      .request<unknown>(`/products/${encodeURIComponent(id)}`)
      .then(product)
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
  }, [id, revision]);
  return state;
}
function ProductDetail({ id, back }: { id: string; back: string }) {
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
  if (!state.data) return <p role="status">Loading product…</p>;
  const data = state.data;
  return (
    <>
      <a href={back}>← Back to products</a>
      <div className="row between" style={{ marginTop: '1.5rem' }}>
        <div>
          <p className="eyebrow">Product details</p>
          <h1 ref={heading} tabIndex={-1}>
            {data.name}
          </h1>
          <p className="muted">SKU {data.sku}</p>
        </div>
        <Status active={data.active} />
      </div>
      <div className="detail-grid">
        <section className="card">
          <h2>Description</h2>
          <p className="description">
            {data.description ?? 'No description provided.'}
          </p>
        </section>
        <section className="card">
          <h2>Price</h2>
          <p className="price">{formatPrice(data.priceMinor)}</p>
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
}: {
  page: Page;
  back: string;
  remember: (back: string) => void;
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
    window.location.hash = listLink(next);
  }
  return (
    <>
      <div className="row between">
        <div>
          <p className="eyebrow">Workspace / Catalog</p>
          <h1 tabIndex={-1}>Products</h1>
          <p className="muted">A clear view of your catalog.</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="status">Product status</label>
          <select
            id="status"
            value={page.status}
            onChange={(event) =>
              change({
                ...page,
                status: event.target.value as Page['status'],
                offset: 0,
              })
            }
          >
            <option value="active">Active products</option>
            <option value="archived">Archived products</option>
            <option value="all">All products</option>
          </select>
        </div>
        <div className="field">
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
      <p className="help mobile-hint">
        Scroll the table horizontally to see all columns.
      </p>
      {state.error ? (
        <ReadError
          error={state.error}
          retry={() => setRevision((value) => value + 1)}
        />
      ) : !state.data ? (
        <p role="status">Loading products…</p>
      ) : (
        <>
          {state.data.items.length ? (
            <div
              className="table-scroll"
              role="region"
              aria-label="Product catalog"
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">
                  Products in the selected status and page
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">SKU</th>
                    <th scope="col">Price (ARS)</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((data) => (
                    <tr key={data.id}>
                      <td>
                        <a
                          className="product-name"
                          href={`#products/${data.id}`}
                          onClick={() => remember(back)}
                        >
                          {data.name}
                        </a>
                      </td>
                      <td>{data.sku}</td>
                      <td className="price">{formatPrice(data.priceMinor)}</td>
                      <td>
                        <Status active={data.active} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <section className="card empty">
              <h2>No products to show</h2>
              <p className="muted">
                Try another status filter or refresh the catalog.
              </p>
            </section>
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
              <p className="notice">
                The catalog navigation limit has been reached. Choose a status
                filter to narrow the list.
              </p>
            )}
        </>
      )}
    </>
  );
}
export function Catalog({ user }: { user: Identity }) {
  void user;
  const hash = useHash();
  const container = useRef<HTMLDivElement>(null);
  const [back, remember] = useState('#products');
  useEffect(() => {
    document.title = 'Products · OrderFlow';
    container.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [hash]);
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  let content;
  try {
    if (path === 'products')
      content = (
        <ProductList page={pageFrom(query)} back={hash} remember={remember} />
      );
    else if (/^products\/[0-9a-f-]{36}$/i.test(path ?? ''))
      content = (
        <ProductDetail key={path} id={path!.split('/')[1]!} back={back} />
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
