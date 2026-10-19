import type { Role } from '../generated/prisma/enums.js';
import type {} from 'express';
export interface Identity {
  id: string;
  email: string;
  role: Role;
}
declare module 'express' {
  interface Request {
    authenticatedUser?: Identity;
  }
}
