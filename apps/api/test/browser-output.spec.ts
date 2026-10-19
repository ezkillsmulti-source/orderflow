import { expect, it } from '@jest/globals';
import { browserOutput } from './support/browser-output.js';
it('redacts HTTP credential headers and ephemeral secrets while retaining failure context', () => {
  const output = browserOutput(
    'PUT /api/products/id/image\nCookie: private-cookie\n- x-csrf-token: private-token\n"Authorization": "private-auth"\nSet-Cookie: private-new-cookie\npassword=private-password\nError: connection failed',
    ['private-password'],
  );
  expect(output).not.toMatch(/private-/);
  expect(output).toContain('PUT /api/products/id/image');
  expect(output).toContain('Error: connection failed');
});
