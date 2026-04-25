import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Offer, OfferDocument } from './schemas/offer.schema';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

@Injectable()
export class OffersService {
  constructor(@InjectModel(Offer.name) private offerModel: Model<OfferDocument>) {}

  private normalizeCode(code?: string): string {
    return String(code || '').trim().toUpperCase();
  }

  private async resolveValidOffer(code: string, subtotal: number): Promise<OfferDocument> {
    const now = new Date();
    const normalizedCode = this.normalizeCode(code);
    if (!normalizedCode) throw new BadRequestException('Discount code is required');

    const offer = await this.offerModel.findOne({
      code: normalizedCode,
      isActive: true,
      $or: [
        { startDate: { $exists: false }, endDate: { $exists: false } },
        { startDate: { $lte: now }, endDate: { $gte: now } },
        { startDate: { $lte: now }, endDate: { $exists: false } },
        { startDate: { $exists: false }, endDate: { $gte: now } },
      ],
    });

    if (!offer) throw new BadRequestException('Invalid or expired discount code');

    if (offer.usageLimit && offer.usageCount >= offer.usageLimit) {
      throw new BadRequestException('This discount code has reached its usage limit');
    }

    if (offer.minOrder && subtotal < offer.minOrder) {
      throw new BadRequestException(`Minimum order amount is ${offer.minOrder} QAR`);
    }

    return offer;
  }

  private calculateDiscountAmount(offer: OfferDocument, subtotal: number): number {
    let discount = 0;
    switch (offer.type) {
      case 'percentage':
        discount = (subtotal * offer.value) / 100;
        if (offer.maxDiscount) discount = Math.min(discount, offer.maxDiscount);
        break;
      case 'fixed':
        discount = offer.value;
        break;
      case 'shipping':
        discount = 0;
        break;
      default:
        discount = 0;
        break;
    }
    return Math.max(0, Math.min(discount, subtotal));
  }

  async create(dto: CreateOfferDto): Promise<Offer> {
    const normalizedCode = this.normalizeCode(dto.code);
    if (!normalizedCode) {
      throw new BadRequestException('Coupon code is required');
    }

    const existing = await this.offerModel.findOne({ code: normalizedCode }).lean();
    if (existing) {
      throw new BadRequestException('Coupon code already exists');
    }

    return this.offerModel.create({ ...dto, code: normalizedCode });
  }

  async findAll(query: any = {}): Promise<{ offers: Offer[]; total: number }> {
    const { page = 1, limit = 20, active, featured } = query;

    const filter: any = {};
    if (active !== undefined) filter.isActive = active === 'true';
    if (featured !== undefined) filter.isFeatured = featured === 'true';

    const [offers, total] = await Promise.all([
      this.offerModel
        .find(filter)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.offerModel.countDocuments(filter),
    ]);

    return { offers, total };
  }

  async findActive(): Promise<Offer[]> {
    const now = new Date();
    return this.offerModel
      .find({
        isActive: true,
        $or: [
          { startDate: { $exists: false }, endDate: { $exists: false } },
          { startDate: { $lte: now }, endDate: { $gte: now } },
          { startDate: { $lte: now }, endDate: { $exists: false } },
          { startDate: { $exists: false }, endDate: { $gte: now } },
        ],
      })
      .sort({ sortOrder: 1 })
      .exec();
  }

  async findFeatured(): Promise<Offer[]> {
    return this.offerModel
      .find({ isActive: true, isFeatured: true })
      .sort({ sortOrder: 1 })
      .limit(6)
      .exec();
  }

  async findOne(id: string): Promise<Offer> {
    const offer = await this.offerModel.findById(id);
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  async update(id: string, dto: UpdateOfferDto): Promise<Offer> {
    const next: any = { ...dto };
    if (dto.code !== undefined) {
      const normalizedCode = this.normalizeCode(dto.code);
      if (!normalizedCode) {
        throw new BadRequestException('Coupon code cannot be empty');
      }

      const existing = await this.offerModel.findOne({ code: normalizedCode, _id: { $ne: id } }).lean();
      if (existing) {
        throw new BadRequestException('Coupon code already exists');
      }
      next.code = normalizedCode;
    }

    const offer = await this.offerModel.findByIdAndUpdate(id, next, { returnDocument: 'after' });
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  async remove(id: string): Promise<void> {
    const result = await this.offerModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Offer not found');
  }

  async applyDiscount(code: string, subtotal: number): Promise<{ discount: number; offer: Offer }> {
    const offer = await this.resolveValidOffer(code, subtotal);
    const discount = this.calculateDiscountAmount(offer, subtotal);

    return { discount, offer };
  }

  async redeemDiscountCode(code: string, subtotal: number): Promise<{ discount: number; offer: Offer }> {
    const offer = await this.resolveValidOffer(code, subtotal);
    const discount = this.calculateDiscountAmount(offer, subtotal);
    await this.offerModel.findByIdAndUpdate(offer._id, { $inc: { usageCount: 1 } });
    return { discount, offer };
  }

  async getStats(): Promise<any> {
    const [total, activeOffers, totals] = await Promise.all([
      this.offerModel.countDocuments(),
      this.offerModel.countDocuments({ isActive: true }),
      this.offerModel.aggregate([
        {
          $group: {
            _id: null,
            totalRedemptions: { $sum: '$usageCount' },
            totalSavings: { $sum: { $multiply: ['$usageCount', '$value'] } },
            uniqueUsers: { $sum: '$usageCount' },
          },
        },
      ]),
    ]);

    const aggregate = totals[0] || { totalRedemptions: 0, totalSavings: 0, uniqueUsers: 0 };

    return {
      total,
      active: activeOffers,
      activeOffers,
      totalRedemptions: aggregate.totalRedemptions || 0,
      totalSavings: Math.round((aggregate.totalSavings || 0) * 100) / 100,
      uniqueUsers: aggregate.uniqueUsers || 0,
    };
  }
}
