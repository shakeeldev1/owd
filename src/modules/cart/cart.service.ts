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

  private toDateOnlyString(value?: string | Date | null): string | null {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private isOfferActiveForDate(
    offerStartDate?: string | Date | null,
    offerEndDate?: string | Date | null,
    referenceDate: Date = new Date(),
  ) {
    const today = this.toDateOnlyString(referenceDate);
    const startDate = this.toDateOnlyString(offerStartDate);
    const endDate = this.toDateOnlyString(offerEndDate);

    if (!today) return false;
    if (startDate && startDate > today) return false;
    if (endDate && endDate < today) return false;
    return true;
  }

  private resolveDisplayPrice(product: any) {
    const unit = product?.unit || 'Grams';
    const regularPrice = unit === 'Quarter Tola' && Number(product?.pricePerQuarterTola || 0) > 0
      ? Number(product.pricePerQuarterTola)
      : ((unit === 'Tola' || unit === 'kg') && Number(product?.pricePerTola || 0) > 0)
        ? Number(product.pricePerTola)
        : unit === 'Piece' && Number(product?.pricePerPiece || 0) > 0
          ? Number(product.pricePerPiece)
          : Number(product?.price || 0);

    const offerPrice = Number(product?.offerPrice || 0);
    const hasActiveOffer = product?.isOnOffer === true
      && this.isOfferActiveForDate(product?.offerStartDate, product?.offerEndDate)
      && offerPrice > 0
      && regularPrice > 0
      && offerPrice < regularPrice;

    if (hasActiveOffer) {
      const effectiveOfferPrice = Math.round(offerPrice * 100) / 100;
      return {
        price: effectiveOfferPrice,
        originalPrice: regularPrice,
        offerPrice: effectiveOfferPrice,
        offerDiscountPercent: Math.round(((regularPrice - effectiveOfferPrice) / regularPrice) * 100),
        isOnOffer: true,
        unit,
      };
    }

    return {
      price: regularPrice,
      originalPrice: Number(product?.originalPrice || 0) > regularPrice ? Number(product.originalPrice) : undefined,
      offerPrice: offerPrice > 0 && offerPrice < regularPrice ? Math.round(offerPrice * 100) / 100 : undefined,
      offerDiscountPercent: Number(product?.offerDiscountPercent || 0) > 0 ? Number(product.offerDiscountPercent) : undefined,
      isOnOffer: false,
      unit,
    };
  }

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
    const productIds = cart.items.map((item) => item.product).filter(Boolean);
    const products = productIds.length > 0
      ? await this.productModel.find({ _id: { $in: productIds } }).lean()
      : [];
    const productMap = new Map(products.map((product: any) => [String(product._id), product]));

    const normalizedItems = cart.items.map((item) => {
      const product = productMap.get(String(item.product));
      const pricing = product ? this.resolveDisplayPrice(product) : { price: item.price, originalPrice: undefined, offerPrice: undefined, offerDiscountPercent: undefined, isOnOffer: false, unit: (item as any).unit || 'Grams' };

      return {
        product: item.product,
        productId: item.product,
        name: product?.name || item.name,
        nameAr: product?.nameAr || item.nameAr,
        price: pricing.price,
        originalPrice: pricing.originalPrice,
        offerPrice: pricing.offerPrice,
        offerDiscountPercent: pricing.offerDiscountPercent,
        isOnOffer: pricing.isOnOffer,
        quantity: item.quantity,
        image: product?.image || item.image,
        slug: product?.slug || item.slug,
        unit: pricing.unit || (item as any).unit || 'Grams',
        subtotal: pricing.price * item.quantity,
      };
    });

    const subtotal = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shipping = 0;
    const total = subtotal + shipping;
    return {
      items: normalizedItems,
      subtotal,
      shipping,
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
    const pricing = this.resolveDisplayPrice(product as any);
    const displayPrice = pricing.price;

    if (existingIndex >= 0) {
      cart.items[existingIndex].quantity += dto.quantity;
      cart.items[existingIndex].price = displayPrice;
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
      price: this.resolveDisplayPrice(p as any).price,
      originalPrice: this.resolveDisplayPrice(p as any).originalPrice,
      offerPrice: this.resolveDisplayPrice(p as any).offerPrice,
      offerDiscountPercent: this.resolveDisplayPrice(p as any).offerDiscountPercent,
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
