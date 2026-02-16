import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CartService } from './cart.service';
import { AddToCartDto, UpdateCartItemDto } from './dto/cart.dto';

@Controller('cart')
@UseGuards(AuthGuard('jwt'))
export class CartController {
  constructor(private cartService: CartService) {}

  @Get()
  getCart(@Request() req: any) {
    return this.cartService.getCart(req.user._id);
  }

  @Post()
  addToCart(@Request() req: any, @Body() dto: AddToCartDto) {
    return this.cartService.addToCart(req.user._id, dto);
  }

  @Patch(':productId')
  updateItem(@Request() req: any, @Param('productId') productId: string, @Body() dto: UpdateCartItemDto) {
    return this.cartService.updateCartItem(req.user._id, productId, dto);
  }

  @Delete(':productId')
  removeItem(@Request() req: any, @Param('productId') productId: string) {
    return this.cartService.removeFromCart(req.user._id, productId);
  }

  @Delete()
  clearCart(@Request() req: any) {
    return this.cartService.clearCart(req.user._id);
  }

  // Wishlist
  @Get('wishlist')
  getWishlist(@Request() req: any) {
    return this.cartService.getWishlist(req.user._id);
  }

  @Post('wishlist/:productId')
  addToWishlist(@Request() req: any, @Param('productId') productId: string) {
    return this.cartService.addToWishlist(req.user._id, productId);
  }

  @Delete('wishlist/:productId')
  removeFromWishlist(@Request() req: any, @Param('productId') productId: string) {
    return this.cartService.removeFromWishlist(req.user._id, productId);
  }
}
