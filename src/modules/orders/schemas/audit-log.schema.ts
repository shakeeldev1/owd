import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ enum: ['delete', 'restore', 'modify', 'create', 'export'], required: true })
  action!: string;

  @Prop({ enum: ['order', 'user', 'product', 'category'], required: true })
  entityType!: string;

  @Prop({ type: Types.ObjectId, required: true })
  entityId!: Types.ObjectId;

  @Prop({ required: false })
  entityNumber?: string; // e.g., order number

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  performedBy?: Types.ObjectId;

  @Prop({ required: false })
  performedByName?: string; // Full name or system identifier

  @Prop({ type: Object, required: false })
  changes?: Record<string, any>; // Before/after changes for modify operations

  @Prop({ required: false })
  details?: string; // Additional context

  @Prop({ required: false })
  ipAddress?: string;

  @Prop({ required: false })
  userAgent?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt?: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ entityType: 1, entityId: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ performedBy: 1 });
AuditLogSchema.index({ createdAt: -1 });
