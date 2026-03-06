import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Offer, OfferDocument } from './schemas/offer.schema';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

@Injectable()
export class OffersService {
  constructor(@InjectModel(Offer.name) private offerModel: Model<OfferDocument>) {}

  async create(dto: CreateOfferDto): Promise<Offer> {
    return this.offerModel.create(dto);
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
    const offer = await this.offerModel.findByIdAndUpdate(id, dto, { returnDocument: 'after' });
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  async remove(id: string): Promise<void> {
    const result = await this.offerModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Offer not found');
  }

  async applyDiscount(code: string, subtotal: number): Promise<{ discount: number; offer: Offer }> {
    const now = new Date();
    const offer = await this.offerModel.findOne({
      code: code.toUpperCase(),
      isActive: true,
      $or: [
        { startDate: { $exists: false }, endDate: { $exists: false } },
        { startDate: { $lte: now }, endDate: { $gte: now } },
      ],
    });

    if (!offer) throw new BadRequestException('Invalid or expired discount code');

    if (offer.usageLimit && offer.usageCount >= offer.usageLimit) {
      throw new BadRequestException('This discount code has reached its usage limit');
    }

    if (offer.minOrder && subtotal < offer.minOrder) {
      throw new BadRequestException(`Minimum order amount is ${offer.minOrder} QAR`);
    }

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
        discount = 0; // Handled at order level
        break;
    }

    // Increment usage
    await this.offerModel.findByIdAndUpdate(offer._id, { $inc: { usageCount: 1 } });

    return { discount, offer };
  }

  async getStats(): Promise<any> {
    const [total, active, totalUsage] = await Promise.all([
      this.offerModel.countDocuments(),
      this.offerModel.countDocuments({ isActive: true }),
      this.offerModel.aggregate([
        { $group: { _id: null, totalUsage: { $sum: '$usageCount' } } },
      ]),
    ]);

    return {
      total,
      active,
      totalUsage: totalUsage[0]?.totalUsage || 0,
    };
  }
}
