import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RecipientDocument = Recipient & Document;

@Schema({ timestamps: true })
export class Recipient {
  @Prop({ required: true, type: String })
  userId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: false })
  email?: string;

  @Prop({ required: true })
  phone!: string;

  @Prop({ required: true })
  address!: string;

  @Prop({ required: true })
  city!: string;

  @Prop({ required: false })
  postalCode?: string;

  @Prop({ default: 'Qatar' })
  country!: string;

  @Prop({ default: false })
  isPrimary!: boolean;
}

export const RecipientSchema = SchemaFactory.createForClass(Recipient);
RecipientSchema.index({ userId: 1 });
RecipientSchema.index({ isPrimary: 1 });
