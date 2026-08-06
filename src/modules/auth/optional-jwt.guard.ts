import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Resolves req.user from a JWT when present, but never rejects the request when the
// token is missing or invalid — used by endpoints that must work for both logged-in
// customers and guests (guest cart, guest checkout).
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // No/invalid token — proceed as an anonymous request.
    }
    return true;
  }

  handleRequest(_err: any, user: any) {
    return user || null;
  }
}
