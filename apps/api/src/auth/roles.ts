import { SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/enums.js';

export const REQUIRED_ROLES = 'orderflow:roles';
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);
