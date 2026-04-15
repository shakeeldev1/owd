import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cart, CartDocument } from './schemas/cart.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { AddToCartDto, UpdateCartItemDto } from './dto/cart.dto';
import { convertToGrams } from '../../utils/unitConversion';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

  private async getOrCreateCart(userId: string): Promise<CartDocument> {
    const cart = await this.cartModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId) },
      { $setOnInsert: { items: [], wishlist: [] } },
      { upsert: true, returnDocument: 'after' },
    );
    return cart;
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    // Calculate total with proper unit conversion
    const total = cart.items.reduce((sum, item) => {
      const unit = (item as any).unit || 'Grams';
      // Price is already the correct unit price (pricePerTola if Tola unit)
      // Just multiply by quantity
      return sum + item.price * item.quantity;
    }, 0);
    return {
      items: cart.items.map((item) => ({
        product: item.product,
        productId: item.product,
        name: item.name,
        nameAr: item.nameAr,
        price: item.price,
        quantity: item.quantity,
        image: item.image,
        slug: item.slug,
        unit: (item as any).unit || 'Grams',
        subtotal: item.price * item.quantity,
      })),
      total,
      itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }

  async addToCart(userId: string, dto: AddToCartDto) {
    const product = await this.productModel.findById(dto.productId);
    if (!product) throw new NotFoundException('Product not found');

    const cart = await this.getOrCreateCart(userId);
    const existingIndex = cart.items.findIndex(
      (item) => item.product.toString() === dto.productId,
    );

    // Determine the correct price based on unit
    const unit = (product as any).unit || 'Grams';
    const displayPrice = unit === 'Quarter Tola' && (product as any).pricePerQuarterTola
      ? (product as any).pricePerQuarterTola
      : (unit === 'Tola' || unit === 'kg') && (product as any).pricePerTola 
      ? (product as any).pricePerTola 
      : unit === 'Piece' && (product as any).pricePerPiece
      ? (product as any).pricePerPiece
      : product.price;

    if (existingIndex >= 0) {
      cart.items[existingIndex].quantity += dto.quantity;
    } else {
      cart.items.push({
        product: new Types.ObjectId(dto.productId),
        name: product.name,
        nameAr: product.nameAr,
        price: displayPrice,
        quantity: dto.quantity,
        image: product.image,
        slug: product.slug,
        unit: unit,
        pricePerUnit: product.price,
      } as any);
    }

    await cart.save();
    return { message: 'Added to cart', cart: await this.getCart(userId) };
  }

  async updateCartItem(userId: string, productId: string, dto: UpdateCartItemDto) {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items.find((i) => i.product.toString() === productId);
    if (!item) throw new NotFoundException('Item not in cart');

    item.quantity = dto.quantity;
    await cart.save();
    return { message: 'Cart updated', cart: await this.getCart(userId) };
  }

  async removeFromCart(userId: string, productId: string) {
    const cart = await this.getOrCreateCart(userId);
    cart.items = cart.items.filter((i) => i.product.toString() !== productId);
    await cart.save();
    return { message: 'Removed from cart', cart: await this.getCart(userId) };
  }

  async clearCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    cart.items = [];
    await cart.save();
    return { message: 'Cart cleared' };
  }

  // Wishlist
  async getWishlist(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    const products = await this.productModel.find({
      _id: { $in: cart.wishlist },
      status: 'active',
    });

    return products.map((p) => ({
      _id: p._id,
      name: p.name,
      nameAr: p.nameAr,
      price: p.price,
      originalPrice: p.originalPrice,
      image: p.image,
      slug: p.slug,
      rating: p.rating,
      stock: p.stock,
    }));
  }

  async addToWishlist(userId: string, productId: string) {
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    const cart = await this.getOrCreateCart(userId);
    const pid = new Types.ObjectId(productId);
    if (!cart.wishlist.some((id) => id.toString() === productId)) {
      cart.wishlist.push(pid);
      await cart.save();
    }
    return { message: 'Added to wishlist' };
  }

  async removeFromWishlist(userId: string, productId: string) {
    const cart = await this.getOrCreateCart(userId);
    cart.wishlist = cart.wishlist.filter((id) => id.toString() !== productId);
    await cart.save();
    return { message: 'Removed from wishlist' };
  }
}
