import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Contact, ContactDocument } from './schemas/contact.schema';
import { CreateContactDto, ReplyContactDto } from './dto/contact.dto';

@Injectable()
export class ContactService {
  constructor(@InjectModel(Contact.name) private contactModel: Model<ContactDocument>) {}

  async create(dto: CreateContactDto): Promise<Contact> {
    return this.contactModel.create(dto);
  }

  async findAll(query: any = {}): Promise<{ messages: Contact[]; total: number }> {
    const { page = 1, limit = 20, status, search } = query;

    const filter: any = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } },
      ];
    }

    const [messages, total] = await Promise.all([
      this.contactModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.contactModel.countDocuments(filter),
    ]);

    return { messages, total };
  }

  async findOne(id: string): Promise<Contact> {
    const msg = await this.contactModel.findById(id);
    if (!msg) throw new NotFoundException('Message not found');
    return msg;
  }

  async markAsRead(id: string): Promise<Contact> {
    const msg = await this.contactModel.findByIdAndUpdate(id, { status: 'read' }, { new: true });
    if (!msg) throw new NotFoundException('Message not found');
    return msg;
  }

  async reply(id: string, dto: ReplyContactDto): Promise<Contact> {
    const msg = await this.contactModel.findByIdAndUpdate(
      id,
      { adminReply: dto.adminReply, status: 'replied', repliedAt: new Date() },
      { new: true },
    );
    if (!msg) throw new NotFoundException('Message not found');
    return msg;
  }

  async archive(id: string): Promise<Contact> {
    const msg = await this.contactModel.findByIdAndUpdate(id, { status: 'archived' }, { new: true });
    if (!msg) throw new NotFoundException('Message not found');
    return msg;
  }

  async remove(id: string): Promise<void> {
    const result = await this.contactModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Message not found');
  }

  async getStats(): Promise<any> {
    const [total, unread, replied, read, archived] = await Promise.all([
      this.contactModel.countDocuments(),
      this.contactModel.countDocuments({ status: 'new' }),
      this.contactModel.countDocuments({ status: 'replied' }),
      this.contactModel.countDocuments({ status: 'read' }),
      this.contactModel.countDocuments({ status: 'archived' }),
    ]);
    const pending = Math.max(0, total - replied - archived);
    return { total, unread, replied, read, archived, pending };
  }
}
