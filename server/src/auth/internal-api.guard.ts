import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { IS_PUBLIC_ROUTE } from './public.decorator';

@Injectable()
export class InternalApiGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers['x-internal-api-key'];
    const supplied = Array.isArray(header) ? header[0] : header;

    if (!supplied || !this.matches(supplied, this.config.internalApiKey)) {
      throw new UnauthorizedException('Invalid internal API key');
    }
    return true;
  }

  private matches(supplied: string, expected: string): boolean {
    const suppliedDigest = createHash('sha256').update(supplied).digest();
    const expectedDigest = createHash('sha256').update(expected).digest();
    return timingSafeEqual(suppliedDigest, expectedDigest);
  }
}
