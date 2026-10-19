import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Body,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionRuntime } from './session.runtime.js';
import { RequestProtection } from './request-protection.js';
import { AuthenticationService } from './authentication.service.js';
import { Public } from './public.js';
import './identity.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly sessions: SessionRuntime,
    private readonly protection: RequestProtection,
  ) {}
  @Public()
  @Get('csrf')
  async csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!req.session.csrfToken) {
      const csrfToken = this.protection.csrf.generateToken(req);
      await this.sessions.save(req);
      return { csrfToken };
    }
    if (!(await this.sessions.touch(req))) {
      await this.sessions.destroy(req, res);
      throw new UnauthorizedException();
    }
    return { csrfToken: this.protection.csrf.generateToken(req) };
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Req() req: Request, @Body() body: unknown) {
    return this.authentication.login(req, body);
  }
  @Get('me')
  me(@Req() req: Request) {
    return { user: req.authenticatedUser };
  }
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(req, res);
  }
}
