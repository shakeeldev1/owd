import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, CategoryDocument } from '../src/modules/categories/schemas/category.schema';

/**
 * Migration script: Add displayOrder field to categories
 *
 * This script:
 * 1. Adds displayOrder field to all categories (default to 999)
 * 2. Replaces categories with the 7 required ones with proper displayOrder
 *
 * Run from `server` folder:
 * npm exec ts-node ./scripts/add-category-display-order.ts
 */

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const categoryModel = app.get<Model<CategoryDocument>>(getModelToken(Category.name));

  try {
    console.log('Starting category display order migration...');

    // Update all existing categories to have displayOrder field (if not already set)
    await categoryModel.updateMany(
      { displayOrder: { $exists: false } },
      { $set: { displayOrder: 999 } }
    );
    console.log('✓ Added displayOrder field to existing categories');

    // Replace all categories with the 7 required ones
    await categoryModel.deleteMany({});
    console.log('✓ Cleared existing categories');

    const categoriesData = [
      {
        name: 'Oud',
        nameAr: 'عود',
        description: 'Premium pure oud selections',
        descriptionAr: 'مختارات العود النقي الفاخرة',
        image: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?w=800&q=80',
        slug: 'oud',
        productCount: 0,
        featured: true,
        isActive: true,
        displayOrder: 1,
      },
      {
        name: 'Oud Oil & Musk',
        nameAr: 'دهن العود ومسك',
        description: 'Concentrated oud oils and musk blends',
        descriptionAr: 'دهون العود المركزة ومزيج المسك',
        image: 'https://images.unsplash.com/photo-1615634260167-c8cdede054de?w=800&q=80',
        slug: 'oud-oil-musk',
        productCount: 0,
        featured: true,
        isActive: true,
        displayOrder: 2,
      },
      {
        name: 'Perfumes & Sprays',
        nameAr: 'عطور ومرشات',
        description: 'Fine perfumes and fragrance sprays',
        descriptionAr: 'العطور الفاخرة ومرشات العطر',
        image: 'https://images.unsplash.com/photo-1595425964071-2c1ecb10b52d?w=800&q=80',
        slug: 'perfumes-sprays',
        productCount: 0,
        featured: true,
        isActive: true,
        displayOrder: 3,
      },
      {
        name: 'Incense & Scented Oud',
        nameAr: 'بخور وعود مطيب',
        description: 'Traditional incense and scented oud products',
        descriptionAr: 'البخور التقليدي ومنتجات العود المطيب',
        image: 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=800&q=80',
        slug: 'incense-scented-oud',
        productCount: 0,
        featured: true,
        isActive: true,
        displayOrder: 4,
      },
      {
        name: 'Burners & Lighters',
        nameAr: 'مباخر وولاعات',
        description: 'Premium burners and lighters for oud',
        descriptionAr: 'المباخر والولاعات الفاخرة للعود',
        image: 'https://images.unsplash.com/photo-1608528577891-eb055944f2e7?w=800&q=80',
        slug: 'burners-lighters',
        productCount: 0,
        featured: false,
        isActive: true,
        displayOrder: 5,
      },
      {
        name: 'Gift Boxes & Giveaways',
        nameAr: 'بوكسات هدايا وتوزيعات',
        description: 'Beautiful gift boxes and promotional sets',
        descriptionAr: 'صناديق الهدايا الجميلة والمجموعات الترويجية',
        image: 'https://images.unsplash.com/photo-1549439602-43ebca2327af?w=800&q=80',
        slug: 'gift-boxes-giveaways',
        productCount: 0,
        featured: false,
        isActive: true,
        displayOrder: 6,
      },
      {
        name: 'Others',
        nameAr: 'أخرى',
        description: 'Other oud-related products',
        descriptionAr: 'منتجات أخرى متعلقة بالعود',
        image: 'https://images.unsplash.com/photo-1542294148-19e06b0d6e25?w=800&q=80',
        slug: 'others',
        productCount: 0,
        featured: false,
        isActive: true,
        displayOrder: 7,
      },
    ];

    const created = await categoryModel.insertMany(categoriesData);
    console.log(`✓ Created ${created.length} categories with proper displayOrder`);

    console.log('\nMigration completed successfully!');
    console.log('Categories:');
    created.forEach((cat: any) => {
      console.log(`  ${cat.displayOrder}. ${cat.name} (${cat.nameAr})`);
    });

    await app.close();
  } catch (error) {
    console.error('Migration failed:', error);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
