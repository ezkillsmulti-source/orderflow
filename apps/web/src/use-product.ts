import { useEffect, useState } from 'react';
import { ApiError, Cancelled, session } from './api';
import { product, type Product } from './catalog-data';
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
