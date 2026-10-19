import {
  BadRequestException,
  HttpException,
  Injectable,
  PayloadTooLargeException,
  RequestTimeoutException,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { diskStorage } from 'multer';
import type { Request, Response } from 'express';
import { Transform, type Writable } from 'node:stream';
import { from, lastValueFrom } from 'rxjs';
import { productId } from '../product.validation.js';
import { ImagesService } from './images.service.js';
import { ImageStorage } from './image.storage.js';
import { ImageCleanup } from './image.cleanup.js';
import { IMAGE_FILE_LIMIT, IMAGE_MULTIPART_LIMIT } from './image.processor.js';
import { filesystemError } from './image.errors.js';

export interface ImageUploadRequest extends Request {
  imageVersion?: string;
}

@Injectable()
export class ImageUploadInterceptor implements NestInterceptor {
  private inFlight = 0;
  constructor(
    private readonly images: ImagesService,
    private readonly storage: ImageStorage,
    private readonly cleanup: ImageCleanup,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    return from(this.receive(context, next));
  }

  private async receive(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<ImageUploadRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    if (Object.keys(req.query).length || !req.is('multipart/form-data'))
      throw new BadRequestException();
    const length = req.headers['content-length'];
    if (
      length !== undefined &&
      (!/^\d+$/.test(length) || BigInt(length) > BigInt(IMAGE_MULTIPART_LIMIT))
    )
      throw new PayloadTooLargeException();
    // Guards have already authenticated and authorized the current user. No queue
    // keeps unbounded buffered requests or native jobs alive under load.
    if (this.inFlight >= 2) throw new HttpException({ retryAfter: 1 }, 429);
    this.inFlight++;
    let version: string | undefined;
    let stopStreams: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new BadRequestException();
      const candidate = await this.images.prepare(productId(id));
      version = candidate.id;
      req.imageVersion = version;
      const folder = await this.storage.folder(version, true);
      const options: MulterOptions & {
        streamHandler: (request: Request, parser: Writable) => void;
      } = {
        storage: diskStorage({
          destination: folder,
          filename: (_request, _file, callback) => callback(null, 'source'),
        }),
        limits: {
          fileSize: IMAGE_FILE_LIMIT,
          files: 1,
          fields: 0,
          parts: 1,
          fieldNameSize: 32,
          headerPairs: 16,
        },
        streamHandler: (request, parser) => {
          let received = 0;
          const budget = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              received += chunk.length;
              callback(
                received > IMAGE_MULTIPART_LIMIT
                  ? new PayloadTooLargeException()
                  : null,
                chunk,
              );
            },
          });
          budget.on('error', (error) => {
            request.unpipe(budget);
            parser.destroy(error);
            request.resume();
          });
          const abort = () => {
            request.unpipe(budget);
            budget.destroy();
            parser.destroy();
          };
          request.once('aborted', abort);
          stopStreams = () => {
            request.off('aborted', abort);
            request.unpipe(budget);
            budget.unpipe(parser);
            budget.destroy();
          };
          request.pipe(budget).pipe(parser);
        },
      };
      if (req.destroyed || req.aborted) throw new BadRequestException();
      const interceptor = new (FileInterceptor('image', options))();
      // Cancels the parser on slow/incomplete requests. Native transforms have
      // their own supported sharp timeout and are awaited before releasing slots.
      timer = setTimeout(() => {
        // Multer drains rejected bodies before completing. Terminate the receive
        // connection after the fixed timeout response, including stalled drains.
        res.once('finish', () => req.destroy(new RequestTimeoutException()));
        res.setHeader('Connection', 'close');
        res.setHeader('Cache-Control', 'no-store');
        res.status(408).json({ statusCode: 408, message: 'Request timeout.' });
      }, 10_000);
      const observable = await interceptor.intercept(context, next);
      clearTimeout(timer);
      timer = undefined;
      if (!req.file) throw new BadRequestException();
      return await lastValueFrom(observable);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (
        error instanceof Error &&
        [
          'Unexpected end of form',
          'Malformed part header',
          'Multipart: Boundary not found',
        ].includes(error.message)
      )
        throw new BadRequestException();
      return filesystemError(error);
    } finally {
      if (timer) clearTimeout(timer);
      stopStreams?.();
      if (version) await this.cleanup.abandon(version);
      this.inFlight--;
    }
  }
}
