import { SetMetadata } from '@nestjs/common';
export const PUBLIC_ROUTE = 'orderflow:public';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
