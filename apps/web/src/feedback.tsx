import { useEffect, useState } from 'react';
import { ApiError } from './api';
export function ErrorNotice({ error }: { error: ApiError | null }) {
  return error ? (
    <div className="error" role="alert">
      {error.message}
      {error.retryAfter > 0 && (
        <span> Please wait {error.retryAfter} seconds.</span>
      )}
    </div>
  ) : null;
}
export function useCooldown(error: ApiError | null) {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setBlocked(Boolean(error?.retryAfter));
    if (!error?.retryAfter) return;
    const timer = setTimeout(() => setBlocked(false), error.retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [error]);
  return blocked;
}
