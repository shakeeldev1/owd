import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ContactDocument = Contact & Document;

@Schema({ timestamps: true })
export class Contact {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop()
  phone: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  message: string;

  @Prop({ enum: ['new', 'read', 'replied', 'archived'], default: 'new' })
  status: string;

  @Prop()
  adminReply: string;

  @Prop({ type: Date })
  repliedAt: Date;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
