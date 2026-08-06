import { BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, Headers } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';
import { CartService, CartIdentity } from './cart.service';
import { AddToCartDto, UpdateCartItemDto } from './dto/cart.dto';

@Controller('cart')
export class CartController {
  constructor(private cartService: CartService) {}

  // Resolves the logged-in user, or the anonymous guest cart identified by the
  // X-Guest-Id header the storefront generates for anonymous shoppers.
  private resolveIdentity(req: any, guestId?: string): CartIdentity {
    if (req.user?._id) return { userId: req.user._id };
    if (!guestId) {
      throw new BadRequestException('Missing guest cart identity');
    }
    return { guestId };
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  getCart(@Request() req: any, @Headers('x-guest-id') guestId?: string) {
    return this.cartService.getCart(this.resolveIdentity(req, guestId));
  }

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  addToCart(@Request() req: any, @Body() dto: AddToCartDto, @Headers('x-guest-id') guestId?: string) {
    return this.cartService.addToCart(this.resolveIdentity(req, guestId), dto);
  }

  @Patch(':productId')
  @UseGuards(OptionalJwtAuthGuard)
  updateItem(
    @Request() req: any,
    @Param('productId') productId: string,
    @Body() dto: UpdateCartItemDto,
    @Headers('x-guest-id') guestId?: string,
  ) {
    return this.cartService.updateCartItem(this.resolveIdentity(req, guestId), productId, dto);
  }

  @Delete(':productId')
  @UseGuards(OptionalJwtAuthGuard)
  removeItem(@Request() req: any, @Param('productId') productId: string, @Headers('x-guest-id') guestId?: string) {
    return this.cartService.removeFromCart(this.resolveIdentity(req, guestId), productId);
  }

  @Delete()
  @UseGuards(OptionalJwtAuthGuard)
  clearCart(@Request() req: any, @Headers('x-guest-id') guestId?: string) {
    return this.cartService.clearCart(this.resolveIdentity(req, guestId));
  }

  // Wishlist requires an account — it's a save-for-later feature tied to a real profile.
  @Get('wishlist')
  @UseGuards(AuthGuard('jwt'))
  getWishlist(@Request() req: any) {
    return this.cartService.getWishlist(req.user._id);
  }

  @Post('wishlist/:productId')
  @UseGuards(AuthGuard('jwt'))
  addToWishlist(@Request() req: any, @Param('productId') productId: string) {
    return this.cartService.addToWishlist(req.user._id, productId);
  }

  @Delete('wishlist/:productId')
  @UseGuards(AuthGuard('jwt'))
  removeFromWishlist(@Request() req: any, @Param('productId') productId: string) {
    return this.cartService.removeFromWishlist(req.user._id, productId);
  }
}
